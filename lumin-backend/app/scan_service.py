"""Scan a video: fingerprint every uploaded shop video, then look recordings up against them.

  fingerprint_video_post(post_id)   background task, run after a video is uploaded or replaced (same pattern as
                                    app/video_optimize.py). Stores the fingerprints, then checks whether another
                                    poster already uploaded a matching video and, if so, opens a review flag.
  match_clip(db, path, user)        look a recording up. Returns the matched post (or nothing) and logs the scan.

Backfill existing posts:  python -m app.scan_service --backfill
"""
import logging
import os
import sys
import tempfile
import threading
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
        db.query(VideoFingerprint.video_post_id, VideoFingerprint.updated_at)
        .select_from(VideoFingerprint)
        .join(VideoPost, VideoPost.id == VideoFingerprint.video_post_id)
        .filter(*_eligible_clauses())
        .all()
    )
    return tuple(sorted((str(i), t.isoformat() if t else "") for i, t in rows))


def _build(db: Session, exclude: uuid.UUID | None = None):
    rows = (
        db.query(VideoFingerprint)
        .join(VideoPost, VideoPost.id == VideoFingerprint.video_post_id)
        .filter(*_eligible_clauses())
        .all()
    )
    return scan_fp.build_index(
        (r.video_post_id, scan_fp.unpack(r.data)) for r in rows if r.data and r.video_post_id != exclude
    )


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
    row.video_url = post.video_url
    row.version = scan_fp.FP_VERSION
    row.status = status
    row.error = (error or None) and error[:300]
    row.duration_s = features.duration if features is not None else None
    row.data = scan_fp.pack(features) if features is not None else None
    db.commit()
    refresh_verified(db, [post.id])  # a failed or replaced fingerprint must also drop the badge


def check_duplicates(db: Session, post: VideoPost, features: "scan_fp.VideoFeatures") -> list[VideoMatchFlag]:
    """Is this upload a copy of another poster's earlier video? If so, open a flag for review. Nothing is
    blocked or removed. Only finds copies of a whole video (or a large part of one): short excerpts are not caught."""
    ix = get_index(db, exclude=post.id)
    if ix is None or not features.f_hash.size:
        return []
    res = scan_fp.identify(ix, scan_fp.query_from_video(features), min_offset=_ANY_OFFSET, audio_alone=False)
    if res["id"] is None:
        return []
    other = db.get(VideoPost, res["id"])
    if other is None or other.id == post.id or other.poster_id == post.poster_id:
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
        flags: list[VideoMatchFlag] = []
        try:
            flags = check_duplicates(db, post, features)  # before saving, so the video isn't compared with itself
        except Exception:
            db.rollback()
            log.exception("duplicate check failed for %s", post_id)
        _save(db, post, FINGERPRINT_OK, features)
        refresh_verified(db, [post.id] + [f.video_post_id for f in flags] + [f.earlier_post_id for f in flags])
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


def upgrade_one() -> bool:
    """Rebuild ONE stored fingerprint that was made by an older version (it stays searchable meanwhile). Called by the
    job loop when it is idle, so old videos get the stronger matching without anyone running --backfill.
    -> True when it did some work. Each post is tried once per process, so a broken file can't loop."""
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
    else:
        print(__doc__)
