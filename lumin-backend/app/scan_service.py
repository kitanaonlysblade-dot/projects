"""Scan a video: fingerprint every uploaded shop video, then look recordings up against them.

  fingerprint_video_post(post_id)   background task, run after a video is uploaded or replaced (same pattern as
                                    app/video_optimize.py). Stores the fingerprints, then checks whether another
                                    poster already uploaded a matching video and, if so, opens a review flag.
  match_clip(db, path, user)        look a recording up. Returns the matched post (or nothing) and logs the scan.

Backfill existing posts:  python -m app.scan_service --backfill
"""
import hashlib
import logging
import os
import sys
import tempfile
import threading
import time
import uuid
from dataclasses import dataclass

from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from app import scan_fp, storage
from app.database import SessionLocal
from app.models import PayoutStatus, VideoFeed, VideoFingerprint, VideoMatchFlag, VideoPost, VideoScan
from app.models.scan import FINGERPRINT_FAILED, FINGERPRINT_OK, FLAG_CONFIRMED, FLAG_OPEN

log = logging.getLogger(__name__)

# Duplicate check: either video can be the longer one, so don't require a start-time order.
_ANY_OFFSET = -1e9


def _eligible_clauses():
    """Which stored fingerprints count: the post still plays the file that was fingerprinted, and it is an original
    shop video with products (reposts, retwins and discover posts have nothing of their own to scan)."""
    return (
        VideoFingerprint.status == FINGERPRINT_OK,
        VideoFingerprint.version.in_(scan_fp.FP_COMPATIBLE),
        VideoFingerprint.video_url == VideoPost.video_url,
        VideoPost.feed == VideoFeed.shop,
        VideoPost.repost_of_id.is_(None),
        VideoPost.retwin_of_id.is_(None),
        VideoPost.products.any(),
    )


def is_scannable(post: VideoPost) -> bool:
    return (
        post.feed == VideoFeed.shop
        and post.repost_of_id is None
        and post.retwin_of_id is None
        and bool(post.video_url)
        and len(post.products) > 0
    )


# ------------------------------------------------------------------ the searchable library (cached)
_LOCK = threading.Lock()
_CACHE: dict = {"key": None, "ix": None}


def _library_key(db: Session):
    rows = (
        db.query(VideoFingerprint.video_post_id, VideoFingerprint.updated_at, VideoFingerprint.dup_of_id)
        .select_from(VideoFingerprint)
        .join(VideoPost, VideoPost.id == VideoFingerprint.video_post_id)
        .filter(*_eligible_clauses())
        .all()
    )
    return tuple(sorted((str(i), t.isoformat() if t else "", str(d or "")) for i, t, d in rows))


def _build(db: Session, exclude: uuid.UUID | None = None):
    rows = (
        db.query(VideoFingerprint)
        .join(VideoPost, VideoPost.id == VideoFingerprint.video_post_id)
        .filter(*_eligible_clauses())
        .order_by(VideoFingerprint.created_at)
        .all()
    )
    # A whole-video copy is not searched itself (two identical entries would make every scan of that video
    # "ambiguous"): the scan finds its original. A copy whose original is no longer searchable stays in.
    present = {r.video_post_id for r in rows}
    kept, seen = [], set()
    for r in rows:
        if not r.data or r.video_post_id == exclude:
            continue
        if r.dup_of_id is not None and r.dup_of_id in present and r.dup_of_id != exclude:
            continue
        # Byte-identical fingerprints are the same file uploaded again (even if nobody linked them yet, e.g. videos
        # uploaded before copies were grouped): only the earliest is searched.
        digest = hashlib.sha1(r.data).digest()
        if digest in seen:
            continue
        seen.add(digest)
        kept.append(r)
    return scan_fp.build_index((r.video_post_id, scan_fp.unpack(r.data)) for r in kept)


def get_index(db: Session, exclude: uuid.UUID | None = None):
    """The library as a scan_fp.Index (None when empty). Rebuilt only when a fingerprint was added, changed or
    removed. Each web worker keeps its own copy, so memory scales with workers x library size."""
    key = _library_key(db)
    with _LOCK:
        if _CACHE["key"] != key:
            _CACHE["ix"], _CACHE["key"] = _build(db), key
        ix = _CACHE["ix"]
    if exclude is not None and ix is not None and exclude in ix.ids:
        return _build(db, exclude)  # re-checking a post that is already in the library: leave it out of its own search
    return ix


def forget_cache() -> None:
    with _LOCK:
        _CACHE["key"], _CACHE["ix"] = None, None


# ------------------------------------------------------------------ fingerprint an upload
def _save(db: Session, post: VideoPost, status: str, features=None, error: str | None = None) -> None:
    row = db.query(VideoFingerprint).filter(VideoFingerprint.video_post_id == post.id).first()
    if row is None:
        row = VideoFingerprint(video_post_id=post.id)
        db.add(row)
    if row.video_url and row.video_url != post.video_url:
        # A replaced video is a different video: it is no longer a copy, and nothing is a copy of it any more.
        row.dup_of_id = None
        db.query(VideoFingerprint).filter(VideoFingerprint.dup_of_id == post.id).update({VideoFingerprint.dup_of_id: None})
    row.video_url = post.video_url
    row.version = scan_fp.FP_VERSION
    row.status = status
    row.error = (error or None) and error[:300]
    row.duration_s = features.duration if features is not None else None
    row.data = scan_fp.pack(features) if features is not None else None
    db.commit()
    refresh_verified(db, [post.id])  # a failed or replaced fingerprint must also drop the badge


# A whole-video copy: starts at the same moment and is about as long. Anything less (an excerpt, a longer cut) is
# still reported for review but is a different video as far as a scan is concerned.
_COPY_OFFSET_S = 1.5


def _find_existing(db: Session, post: VideoPost, features: "scan_fp.VideoFeatures"):
    """-> (identify result, the other post) for the closest earlier-or-later upload, else None."""
    ix = get_index(db, exclude=post.id)
    if ix is None or not features.f_hash.size:
        return None
    res = scan_fp.identify(ix, scan_fp.query_from_video(features), min_offset=_ANY_OFFSET, audio_alone=False)
    if res["id"] is None:
        return None
    other = db.get(VideoPost, res["id"])
    if other is None or other.id == post.id:
        return None
    return res, other


def _is_whole_copy(db: Session, res: dict, other: VideoPost, features: "scan_fp.VideoFeatures") -> bool:
    if abs(res.get("offset") or 0.0) > _COPY_OFFSET_S:
        return False
    dur = (
        db.query(VideoFingerprint.duration_s).filter(VideoFingerprint.video_post_id == other.id).scalar()
    )
    if not dur or not features.duration:
        return False
    return abs(dur - features.duration) <= max(1.0, 0.03 * max(dur, features.duration))


def link_copy(db: Session, post: VideoPost, features: "scan_fp.VideoFeatures", found=None) -> uuid.UUID | None:
    """If this upload is a whole-video copy of another post (the same poster again, or someone else), record it on its
    fingerprint row so a scan finds ONE result: the earliest post (only its products are shown).
    Call after the fingerprint row is saved. -> the id of the post that is now the original, or None."""
    found = found if found is not None else _find_existing(db, post, features)
    if found is None:
        return None
    res, other = found
    if not _is_whole_copy(db, res, other, features):
        return None
    rows = {
        r.video_post_id: r
        for r in db.query(VideoFingerprint).filter(VideoFingerprint.video_post_id.in_([post.id, other.id]))
    }
    mine, theirs = rows.get(post.id), rows.get(other.id)
    if mine is None or theirs is None:
        return None
    root_id = theirs.dup_of_id or other.id
    root = db.get(VideoPost, root_id) or other
    if post.created_at >= root.created_at:
        mine.dup_of_id = root.id
        original = root.id
    else:  # backfills can see a later upload first: the earlier post becomes the original of the whole family
        db.query(VideoFingerprint).filter(VideoFingerprint.dup_of_id == root.id).update({VideoFingerprint.dup_of_id: post.id})
        root_fp = rows.get(root.id) or db.query(VideoFingerprint).filter(VideoFingerprint.video_post_id == root.id).first()
        if root_fp is not None:
            root_fp.dup_of_id = post.id
        mine.dup_of_id = None
        original = post.id
    db.commit()
    forget_cache()
    return original


def open_flag_for_report(db: Session, report) -> VideoMatchFlag | None:
    """A \"copied\" report against a video: if that video is a known whole copy of an earlier upload by someone else,
    open the review (verified badge off, payout of orders from the copy held until an admin decides). Reports on the
    first upload, on a poster's own repeat, or on a video with no known original open nothing: they are ordinary
    reports. Never raises. The caller commits."""
    try:
        fp = db.query(VideoFingerprint).filter(VideoFingerprint.video_post_id == report.target_id).first()
        if fp is None or fp.dup_of_id is None:
            return None
        later, earlier = db.get(VideoPost, report.target_id), db.get(VideoPost, fp.dup_of_id)
        if later is None or earlier is None or later.poster_id == earlier.poster_id:
            return None
        flag = (
            db.query(VideoMatchFlag)
            .filter(VideoMatchFlag.video_post_id == later.id, VideoMatchFlag.earlier_post_id == earlier.id)
            .first()
        )
        if flag is None:
            flag = VideoMatchFlag(video_post_id=later.id, earlier_post_id=earlier.id, stage="reported", status=FLAG_OPEN)
            db.add(flag)
            db.flush()
        return flag
    except Exception:
        log.exception("copy report could not open a review")
        return None


def check_duplicates(db: Session, post: VideoPost, features: "scan_fp.VideoFeatures", found=None) -> list[VideoMatchFlag]:
    """Is this upload a copy of another poster's earlier video? If so, open a flag for review. Nothing is
    blocked or removed. Only finds copies of a whole video (or a large part of one): short excerpts are not caught."""
    found = found if found is not None else _find_existing(db, post, features)
    if found is None:
        return []
    res, other = found
    if other.poster_id == post.poster_id:
        return []  # the same person re-uploading their own video is not a conflict
    later, earlier = (post, other) if post.created_at >= other.created_at else (other, post)
    existing = (
        db.query(VideoMatchFlag)
        .filter(VideoMatchFlag.video_post_id == later.id, VideoMatchFlag.earlier_post_id == earlier.id)
        .first()
    )
    if existing is not None:
        return [existing]
    flag = VideoMatchFlag(video_post_id=later.id, earlier_post_id=earlier.id, stage=res["stage"], status=FLAG_OPEN)
    db.add(flag)
    db.commit()
    return [flag]


def refresh_verified(db: Session, post_ids) -> None:
    """Recompute VideoPost.verified_original for these posts and commit. Verified = a good fingerprint of the
    CURRENT video, and no flag against it: an open flag on either side (someone is disputing it, or it is itself
    the disputed copy) or a confirmed flag where it is the later upload (confirmed copy). A confirmed flag does not
    take the badge from the earlier, genuine original."""
    for post_id in {pid for pid in post_ids if pid is not None}:
        post = db.get(VideoPost, post_id)
        if post is None:
            continue
        fp_ok = (
            db.query(VideoFingerprint.id)
            .filter(
                VideoFingerprint.video_post_id == post.id,
                VideoFingerprint.video_url == post.video_url,
                VideoFingerprint.status == FINGERPRINT_OK,
            )
            .first()
            is not None
        )
        blocked = (
            db.query(VideoMatchFlag.id)
            .filter(
                or_(
                    and_(VideoMatchFlag.video_post_id == post.id, VideoMatchFlag.status.in_([FLAG_OPEN, FLAG_CONFIRMED])),
                    and_(VideoMatchFlag.earlier_post_id == post.id, VideoMatchFlag.status == FLAG_OPEN),
                )
            )
            .first()
            is not None
        )
        verified = fp_ok and not blocked
        if post.verified_original != verified:
            post.verified_original = verified
    db.commit()


def payout_hold_ids(db: Session, orders) -> set:
    """Ids of the orders (of those given) whose payout must wait: still held, came from a video the SELLER posted,
    and that video is the later upload in a copy review that is still open. Nothing else is affected - a creator's
    flagged video never holds a seller who merely tagged their product on it, and the original poster is never held."""
    held = [o for o in orders if o.payout_status == PayoutStatus.held and o.source_video_post_id is not None]
    if not held:
        return set()
    source_ids = {o.source_video_post_id for o in held}
    flagged = {
        r[0]
        for r in db.query(VideoMatchFlag.video_post_id).filter(
            VideoMatchFlag.video_post_id.in_(source_ids), VideoMatchFlag.status == FLAG_OPEN
        )
    }
    if not flagged:
        return set()
    poster = {r[0]: r[1] for r in db.query(VideoPost.id, VideoPost.poster_id).filter(VideoPost.id.in_(flagged))}
    out = set()
    for o in held:
        merchant = o.product.merchant if o.product is not None else None
        if merchant is not None and o.source_video_post_id in flagged and poster.get(o.source_video_post_id) == merchant.user_id:
            out.add(o.id)
    return out


def fingerprint_video_post(post_id: uuid.UUID) -> None:
    """Background task: never raises. A video that can't be read is recorded as failed and simply isn't searchable."""
    db = SessionLocal()
    try:
        post = db.get(VideoPost, post_id)
        if post is None or not is_scannable(post):
            return
        key = storage.key_from_view_url(post.video_url)
        if key is None:
            return  # external / mock URL: nothing of ours to download
        have = db.query(VideoFingerprint).filter(VideoFingerprint.video_post_id == post.id).first()
        if have is not None and have.video_url == post.video_url and have.version == scan_fp.FP_VERSION and have.status == FINGERPRINT_OK:
            return  # already fingerprinted (e.g. products were added to an older video)
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "video" + os.path.splitext(key)[1].lower())
            storage.download_object(key, path)
            try:
                features = scan_fp.extract_video(path)
            except Exception as e:  # unreadable / unsupported file
                log.exception("fingerprinting failed for %s", key)
                _save(db, post, FINGERPRINT_FAILED, error=str(e))
                return
        if not features.f_hash.size:
            _save(db, post, FINGERPRINT_FAILED, error="no frames could be read")
            return
        # Nothing is flagged here: a similar video is normal on a shopping app. It is only grouped (so a scan finds
        # the first upload) and a review opens only when someone reports it as copied (open_flag_for_report).
        found = None
        try:
            found = _find_existing(db, post, features)  # before saving, so the video isn't compared with itself
        except Exception:
            db.rollback()
            log.exception("duplicate check failed for %s", post_id)
        _save(db, post, FINGERPRINT_OK, features)
        try:
            if found is not None:
                link_copy(db, post, features, found)
            db.query(VideoFingerprint).filter(VideoFingerprint.video_post_id == post.id).update({VideoFingerprint.copy_checked: True})
            db.commit()
        except Exception:
            db.rollback()
            log.exception("copy link failed for %s", post_id)
        refresh_verified(db, [post.id])
    except Exception:
        log.exception("fingerprint_video_post failed for %s", post_id)
    finally:
        db.close()


# ------------------------------------------------------------------ look a recording up
@dataclass
class ClipMatch:
    post: VideoPost | None
    at_s: float | None
    stage: str | None
    clip_s: float | None
    covered: float | None
    # "Did you mean": only when nothing was sure enough but one video was close (see scan_fp.closest).
    suggest_post: VideoPost | None = None
    suggest_at_s: float | None = None


def is_disputed(db: Session, post_id: uuid.UUID) -> bool:
    return (
        db.query(VideoMatchFlag.id)
        .filter(
            VideoMatchFlag.status == FLAG_OPEN,
            (VideoMatchFlag.video_post_id == post_id) | (VideoMatchFlag.earlier_post_id == post_id),
        )
        .first()
        is not None
    )


def match_clip(db: Session, path: str, user_id: uuid.UUID | None, log_miss: bool = True) -> ClipMatch:
    """The whole recording first; when that finds nothing and the video clearly plays in only PART of the screen (a
    desktop browser with the video in the middle), once more on just that rectangle."""
    rect = scan_fp.detect_rect(path)
    if rect is None:
        return match_query(db, scan_fp.extract_query(path), user_id, log_miss, clip_path=path)
    whole = match_query(db, scan_fp.extract_query(path), user_id, False, clip_path=path)
    if whole.post is not None:
        return whole
    return match_query(db, scan_fp.extract_query(path, crop=rect), user_id, log_miss, clip_path=path)


def _confirmed_by_pixels(post: VideoPost, clip_path: str | None, offset: float | None = None) -> bool:
    """A match to a template-like video (see scan_fp.is_template_like) is only believed after the recording's pictures
    are laid over the original's. Needs the recording itself (clip_path): a fingerprint from the phone cannot show it,
    so that case answers "not sure" and the app then sends the recording for the full check."""
    if not clip_path:
        return False
    key = storage.key_from_view_url(post.video_url)
    if key is None:
        return False
    try:
        with tempfile.TemporaryDirectory() as tmp:
            orig = os.path.join(tmp, "original" + (os.path.splitext(key)[1] or ".mp4"))
            storage.download_object(key, orig)
            return scan_fp.confirm_recording(orig, clip_path, offset)
    except Exception:
        log.exception("pixel check failed for %s", post.id)
        return False


def match_query(
    db: Session,
    q: "scan_fp.QueryFeatures",
    user_id: uuid.UUID | None,
    log_miss: bool = True,
    clip_path: str | None = None,
) -> ClipMatch:
    """Look up a recording that has already been turned into features (here from a file, or computed on the phone)."""
    _LAST_SCAN["t"] = time.monotonic()
    ix = get_index(db)
    res = scan_fp.identify(ix, q) if ix is not None else dict(id=None, stage=None, offset=None, clip_s=q.clip_s)
    post = db.get(VideoPost, res["id"]) if res["id"] is not None else None
    if post is not None and post.moderation_hold:
        post = None  # held by moderation: never point anyone at it
    if post is not None and res.get("templ") and not _confirmed_by_pixels(post, clip_path, res.get("offset")):
        # Same app / same background as the uploaded video, but the details differ (or cannot be checked): not an
        # answer. With the recording in hand the pictures were compared and differ, so nothing is suggested either.
        # From a bare fingerprint nothing could be compared: say "not sure" (the app then sends the recording).
        post = None
    if post is not None or log_miss:  # a live scan checks every few seconds: only the hit is worth a row
        db.add(
            VideoScan(
                video_post_id=post.id if post else None,
                user_id=user_id,
                found=post is not None,
                stage=res["stage"] if post else None,
                clip_s=res["clip_s"],
            )
        )
        db.commit()
    sug = res.get("suggest") if post is None else None
    sug_post = db.get(VideoPost, sug["id"]) if sug else None
    if sug_post is not None and sug_post.moderation_hold:
        sug_post = None
    return ClipMatch(
        post=post,
        at_s=round(max(0.0, res["offset"] or 0.0), 1) if post else None,
        stage=res["stage"] if post else None,
        clip_s=res["clip_s"],
        covered=res.get("covered") if post else None,
        suggest_post=sug_post,
        suggest_at_s=round(max(0.0, sug["offset"]), 1) if sug_post is not None else None,
    )


def match_still(db: Session, image_bytes: bytes, user_id: uuid.UUID | None) -> ClipMatch:
    """Look up ONE picture (a link's preview image). Much weaker than a recording, so a miss only means
    'could not tell from the picture'."""
    import cv2
    import numpy as np

    arr = np.frombuffer(image_bytes, np.uint8)
    g = cv2.imdecode(arr, cv2.IMREAD_GRAYSCALE)
    ix = get_index(db)
    if g is None or ix is None:
        return ClipMatch(post=None, at_s=None, stage=None, clip_s=None, covered=None)
    res = scan_fp.identify_still(ix, g)
    post = db.get(VideoPost, res["id"]) if res["id"] is not None else None
    if post is not None and post.moderation_hold:
        post = None  # held by moderation: never point anyone at it
    if post is not None:
        db.add(VideoScan(video_post_id=post.id, user_id=user_id, found=True, stage="still"))
        db.commit()
    return ClipMatch(post=post, at_s=None, stage="still" if post else None, clip_s=None, covered=None)


_UPGRADE_TRIED: set = set()

# When a person last scanned. The idle housekeeping below (rebuilding old fingerprints, re-checking copies) is heavy:
# it re-reads the whole library and runs ffmpeg. When it shares a process with the web server it steals the CPU from a
# scan that is waiting for its answer, so it steps aside while someone is scanning.
_QUIET_AFTER_SCAN_S = 20.0
_LAST_SCAN = {"t": 0.0}


def _scan_is_busy() -> bool:
    return time.monotonic() - _LAST_SCAN["t"] < _QUIET_AFTER_SCAN_S


def upgrade_one() -> bool:
    """Rebuild ONE stored fingerprint that was made by an older version (it stays searchable meanwhile). Called by the
    job loop when it is idle, so old videos get the stronger matching without anyone running --backfill.
    -> True when it did some work. Each post is tried once per process, so a broken file can't loop."""
    if _scan_is_busy():
        return False
    db = SessionLocal()
    try:
        row = (
            db.query(VideoFingerprint.video_post_id)
            .select_from(VideoFingerprint)
            .join(VideoPost, VideoPost.id == VideoFingerprint.video_post_id)
            .filter(VideoFingerprint.version != scan_fp.FP_VERSION, *_eligible_clauses()[:1], *_eligible_clauses()[2:])
            .filter(~VideoFingerprint.video_post_id.in_(list(_UPGRADE_TRIED) or [uuid.UUID(int=0)]))
            .first()
        )
        post_id = row[0] if row else None
    finally:
        db.close()
    if post_id is None:
        return False
    _UPGRADE_TRIED.add(post_id)
    fingerprint_video_post(post_id)
    return True


def relink_one() -> bool:
    """Check ONE fingerprint made before copies were grouped: is it a whole copy of another post? Links it and refreshes
    its verified badge. Called by the job loop when idle (after fingerprint upgrades), so videos uploaded twice before
    this existed start scanning and show their badge again without anyone running anything. -> True when it did work."""
    if _scan_is_busy():
        return False
    db = SessionLocal()
    try:
        fp = (
            db.query(VideoFingerprint)
            .filter(VideoFingerprint.copy_checked.is_(False), VideoFingerprint.status == FINGERPRINT_OK)
            .order_by(VideoFingerprint.created_at)
            .first()
        )
        if fp is None:
            return False
        post = db.get(VideoPost, fp.video_post_id)
        try:
            if post is not None and fp.data and is_scannable(post) and fp.video_url == post.video_url:
                features = scan_fp.unpack(fp.data)
                link_copy(db, post, features)
        except Exception:
            db.rollback()
            log.exception("copy re-check failed for %s", fp.video_post_id)
        fp = db.get(VideoFingerprint, fp.id)
        fp.copy_checked = True
        db.commit()
        refresh_verified(db, [fp.video_post_id, fp.dup_of_id])
        return True
    except Exception:
        db.rollback()
        log.exception("relink_one failed")
        return False
    finally:
        db.close()


def relink_all() -> None:
    n = 0
    while relink_one():
        n += 1
        print(f"re-checked {n}", flush=True)


def backfill() -> None:
    db = SessionLocal()
    try:
        done = {r[0] for r in db.query(VideoFingerprint.video_post_id).filter(VideoFingerprint.version == scan_fp.FP_VERSION)}
        ids = [
            p.id
            for p in db.query(VideoPost)
            .filter(
                VideoPost.feed == VideoFeed.shop,
                VideoPost.repost_of_id.is_(None),
                VideoPost.retwin_of_id.is_(None),
                VideoPost.video_url.isnot(None),
                VideoPost.products.any(),
            )
            .order_by(VideoPost.created_at)
            if p.id not in done
        ]
    finally:
        db.close()
    for i, post_id in enumerate(ids, 1):
        print(f"[{i}/{len(ids)}] {post_id}", flush=True)
        fingerprint_video_post(post_id)


if __name__ == "__main__":
    if "--backfill" in sys.argv:
        backfill()
    elif "--relink" in sys.argv:
        relink_all()  # group videos uploaded twice before copies were grouped (the worker also does this when idle)
    else:
        print(__doc__)
