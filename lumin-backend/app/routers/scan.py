"""Scan a video: "what is this video, and what is in it?"

POST /scan/match            upload a short screen recording -> the uploaded video it matches, or "not found"
POST /scan/link             a pasted link (Lumin link, or a direct video-file link) -> the same answer
GET  /scan/video/{id}       the public page for one video (its products, when we first saw it, any open review)
GET  /scan/mine             how many times each of my videos was scanned
GET  /scan/flags            (admin) uploads that look like another poster's earlier video
POST /scan/flags/{id}/resolve (admin)

The recording is read from a temporary file, matched, and deleted straight away - only the result is kept (one
row per scan: whether it was found, which video, how long it was). It is never stored.
"""
from app.brand import APP_NAME
import logging
import os
import tempfile
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Body, Depends, File, HTTPException, Query, Request, UploadFile, status
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app import scan_fp, scan_link as scan_link_mod, scan_service
from app.escrow import sweep_auto_releases
from app.auth import get_current_active_user, get_current_admin, get_optional_user
from app.database import get_db
from app.models import Order, PayoutStatus, User, VideoFeed, VideoFingerprint, VideoMatchFlag, VideoPost, VideoScan
from app.models.scan import FLAG_OPEN
from app.rate_limit import limiter
from app.routers.video_posts import _VIDEO_POST_LOAD_OPTIONS, _held_from, _resolve_video_post_for_read
from app.schemas import ScanSuggestion, ScanFlagRead, ScanFlagResolve, ScanLinkRequest, ScanMatchRead, ScanMineItem, ScanPostBrief, ScanVideoPageRead
from app.visibility import is_hidden_from

log = logging.getLogger(__name__)

router = APIRouter(prefix="/scan", tags=["scan"])

MAX_CLIP_BYTES = int(os.environ.get("SCAN_MAX_CLIP_MB", "30")) * 1024 * 1024
MAX_CLIP_SECONDS = float(os.environ.get("SCAN_MAX_CLIP_SECONDS", "20"))
MIN_CLIP_SECONDS = float(os.environ.get("SCAN_MIN_CLIP_SECONDS", "2"))
SHORT_CLIP_SECONDS = 6.0  # shorter recordings match less often

NOT_FOUND_PICTURE = (
    "We couldn't tell from that link's preview picture. That doesn't mean anything is wrong with it. "
    "For a more reliable check, screen-record the video and upload the recording."
)
NOT_FOUND = f"We couldn't find this on {APP_NAME}. That doesn't mean anything is wrong with it - most videos aren't here, and we never guess."
NOT_FOUND_SHORT = NOT_FOUND + " Recordings of 6-8 seconds match more often, so try recording a few seconds longer."


def _save_upload(clip: UploadFile, tmp_dir: str) -> str:
    suffix = os.path.splitext(clip.filename or "")[1].lower()
    if suffix not in {".mp4", ".mov", ".webm", ".mkv", ".3gp", ".m4v"}:
        suffix = ".mp4"  # ffmpeg identifies the real format from the content anyway
    path = os.path.join(tmp_dir, "clip" + suffix)
    size = 0
    with open(path, "wb") as out:
        while chunk := clip.file.read(1 << 20):
            size += len(chunk)
            if size > MAX_CLIP_BYTES:
                raise HTTPException(status_code=413, detail=f"That recording is too large (max {MAX_CLIP_BYTES // (1024 * 1024)} MB).")
            out.write(chunk)
    return path


def _result(db: Session, post, result, current_user) -> ScanMatchRead:
    if post is not None and is_hidden_from(post.poster, post.poster_id, current_user):
        post = None  # looks exactly like "not found" for a hidden poster's video
    if post is None:
        short = result.clip_s is not None and result.clip_s < SHORT_CLIP_SECONDS
        sp = getattr(result, "suggest_post", None)
        if sp is not None and is_hidden_from(sp.poster, sp.poster_id, current_user):
            sp = None
        return ScanMatchRead(
            found=False,
            clip_s=result.clip_s,
            message=NOT_FOUND_SHORT if short else NOT_FOUND,
            suggestion=ScanSuggestion(video_post_id=sp.id, at_s=result.suggest_at_s) if sp is not None else None,
        )
    return ScanMatchRead(
        found=True,
        video_post_id=post.id,
        at_s=result.at_s,
        stage=result.stage,
        clip_s=result.clip_s,
        covered=result.covered,
        disputed=scan_service.is_disputed(db, post.id),
        verified_original=post.verified_original,
    )


def _match_file(db: Session, path: str, current_user, *, trim: bool = False, log_miss: bool = True) -> ScanMatchRead:
    """Validate the length of a video file and look it up. trim=True (links) cuts a long video down to its
    first MAX_CLIP_SECONDS instead of refusing it."""
    seconds = scan_fp.clip_seconds(path)
    if seconds is None:
        raise HTTPException(status_code=400, detail="We couldn't read that video. Try a normal video file (MP4 or MOV).")
    if seconds < MIN_CLIP_SECONDS:
        raise HTTPException(status_code=400, detail=f"That video is too short. It needs at least {MIN_CLIP_SECONDS:g} seconds.")
    if seconds > MAX_CLIP_SECONDS:
        if not trim:
            raise HTTPException(status_code=400, detail=f"That recording is too long. Keep it under {MAX_CLIP_SECONDS:g} seconds.")
        cut = os.path.join(os.path.dirname(path), "first_seconds.mp4")
        try:
            scan_fp._sh(["ffmpeg", "-y", "-v", "error", "-i", path, "-t", f"{MAX_CLIP_SECONDS:g}", "-c", "copy", cut])
            path = cut
        except Exception:
            raise HTTPException(status_code=400, detail="We couldn't process that video. Try screen-recording it instead.")
    try:
        result = scan_service.match_clip(db, path, current_user.id if current_user else None, log_miss=log_miss)
    except Exception:
        raise HTTPException(status_code=400, detail="We couldn't process that video. Try recording it again.")
    return _result(db, result.post, result, current_user)


@router.post("/match", response_model=ScanMatchRead)
@limiter.limit("30/minute")
def scan_match(
    request: Request,
    clip: UploadFile = File(...),
    live: bool = Query(default=False, description="True for the rolling checks of a live scan: misses are not logged"),
    current_user: User | None = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    with tempfile.TemporaryDirectory() as tmp:
        path = _save_upload(clip, tmp)
        return _match_file(db, path, current_user, log_miss=not live)


MAX_FEATURES_BYTES = 3 * 1024 * 1024
NOT_FOUND_FEATURES = (
    f"We couldn't find this on {APP_NAME} from the fingerprint alone. That doesn't mean anything is wrong with it. "
    "You can send the recording itself for a deeper check."
)


@router.post("/match-features", response_model=ScanMatchRead)
@limiter.limit("60/minute")
def scan_match_features(
    request: Request,
    payload: dict = Body(...),
    live: bool = Query(default=False, description="True for the rolling checks of a live scan: misses are not logged"),
    current_user: User | None = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    """The same lookup as /scan/match, but the phone (or browser) did the heavy part itself: it sends a small
    fingerprint (sound + picture hashes, tens of KB) instead of the recording, which then never leaves the device.
    The fingerprint is built by lumin-app/lib/fingerprint, which mirrors app/scan_fp.py."""
    if int(request.headers.get("content-length") or 0) > MAX_FEATURES_BYTES:
        raise HTTPException(status_code=413, detail="That fingerprint is too large.")
    try:
        q = scan_fp.query_from_wire(payload)
    except (ValueError, KeyError, TypeError) as e:
        raise HTTPException(status_code=400, detail=str(e) if isinstance(e, ValueError) else "That fingerprint isn't valid.")
    if q.clip_s is not None and q.clip_s < MIN_CLIP_SECONDS:
        raise HTTPException(status_code=400, detail=f"That recording is too short. It needs at least {MIN_CLIP_SECONDS:g} seconds.")
    if q.clip_s is not None and q.clip_s > MAX_CLIP_SECONDS + 1:
        raise HTTPException(status_code=400, detail=f"That recording is too long. Keep it under {MAX_CLIP_SECONDS:g} seconds.")
    try:
        result = scan_service.match_query(db, q, current_user.id if current_user else None, log_miss=not live)
    except Exception:
        log.exception("match-features failed")
        raise HTTPException(status_code=400, detail="We couldn't process that. Try recording it again.")
    res = _result(db, result.post, result, current_user)
    if not res.found:
        res.message = NOT_FOUND_FEATURES
        res.deeper_check = True
    return res


@router.post("/link", response_model=ScanMatchRead)
@limiter.limit("10/minute")
def scan_link(
    request: Request,
    payload: ScanLinkRequest,
    current_user: User | None = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    """Scan from a pasted link: a Lumin link goes straight to its video; a direct video-file link is
    downloaded (safely, see app/scan_link.py) and matched; social-app pages are declined with a clear message."""
    try:
        parsed = scan_link_mod.parse_url(payload.url)
        post_id = scan_link_mod.lumin_post_id(parsed)
        if post_id is not None:
            post = db.get(VideoPost, post_id)
            if post is None or is_hidden_from(post.poster, post.poster_id, current_user):
                return ScanMatchRead(found=False, message=f"We couldn't find that video on {APP_NAME}.")
            db.add(VideoScan(video_post_id=post.id, user_id=current_user.id if current_user else None, found=True, stage="link"))
            db.commit()
            return ScanMatchRead(found=True, video_post_id=post.id, stage="link", disputed=scan_service.is_disputed(db, post.id), verified_original=post.verified_original)
        if scan_link_mod.is_social(parsed.hostname):
            # We never take the video itself from a social app. Its public preview picture (oEmbed) can still
            # show that this is a Lumin video; if not, say so honestly and point to screen-recording.
            image = scan_link_mod.fetch_thumbnail(payload.url)
            if image is not None:
                try:
                    still = scan_service.match_still(db, image, current_user.id if current_user else None)
                except Exception:
                    still = None
                if still is not None and still.post is not None:
                    return _result(db, still.post, still, current_user)
                return ScanMatchRead(found=False, message=NOT_FOUND_PICTURE)
            raise scan_link_mod.LinkError(scan_link_mod.SOCIAL_MESSAGE)
        with tempfile.TemporaryDirectory() as tmp:
            path = scan_link_mod.fetch_video(payload.url if "://" in payload.url else "https://" + payload.url.strip(), tmp)
            return _match_file(db, path, current_user, trim=True)
    except scan_link_mod.LinkError as e:
        raise HTTPException(status_code=e.status, detail=e.message)


@router.get("/video/{video_post_id}", response_model=ScanVideoPageRead)
def scan_video_page(
    video_post_id: uuid.UUID,
    current_user: User | None = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    post = (
        db.query(VideoPost)
        .options(*_VIDEO_POST_LOAD_OPTIONS)
        .filter(VideoPost.id == video_post_id)
        .first()
    )
    if post is None or is_hidden_from(post.poster, post.poster_id, current_user) or _held_from(post, current_user):
        raise HTTPException(status_code=404, detail="Video not found")
    registered = (
        db.query(VideoFingerprint.created_at)
        .filter(VideoFingerprint.video_post_id == post.id, VideoFingerprint.video_url == post.video_url)
        .scalar()
    )
    return ScanVideoPageRead(
        post=_resolve_video_post_for_read(post),
        registered_at=registered,
        disputed=scan_service.is_disputed(db, post.id),
        verified_original=post.verified_original,
    )


@router.get("/mine", response_model=list[ScanMineItem])
def my_scans(current_user: User = Depends(get_current_active_user), db: Session = Depends(get_db)):
    week_ago = datetime.now(timezone.utc) - timedelta(days=7)
    posts = (
        db.query(VideoPost.id, VideoPost.product_taps_count)
        .filter(VideoPost.poster_id == current_user.id, VideoPost.feed == VideoFeed.shop, VideoPost.repost_of_id.is_(None))
        .all()
    )
    counts = {
        pid: (total, recent)
        for pid, total, recent in db.query(
            VideoScan.video_post_id, func.count(), func.count().filter(VideoScan.created_at >= week_ago)
        )
        .filter(VideoScan.video_post_id.in_([p.id for p in posts]), VideoScan.found.is_(True))
        .group_by(VideoScan.video_post_id)
        .all()
    }
    items = [
        ScanMineItem(video_post_id=p.id, scans=counts.get(p.id, (0, 0))[0], scans_7d=counts.get(p.id, (0, 0))[1], product_taps=p.product_taps_count)
        for p in posts
    ]
    return sorted(items, key=lambda i: (-i.scans, str(i.video_post_id)))


def _flag_read(f: VideoMatchFlag, db: Session) -> ScanFlagRead:
    later, earlier = db.get(VideoPost, f.video_post_id), db.get(VideoPost, f.earlier_post_id)
    return ScanFlagRead(
        id=f.id, stage=f.stage, status=f.status, note=f.note, created_at=f.created_at, resolved_at=f.resolved_at,
        later=ScanPostBrief.model_validate(later), earlier=ScanPostBrief.model_validate(earlier),
    )


@router.get("/flags", response_model=list[ScanFlagRead])
def list_flags(
    flag_status: str = Query(FLAG_OPEN, alias="status", pattern="^(open|dismissed|confirmed)$"),
    _admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    flags = (
        db.query(VideoMatchFlag).filter(VideoMatchFlag.status == flag_status).order_by(VideoMatchFlag.created_at.desc()).limit(200).all()
    )
    return [_flag_read(f, db) for f in flags]


@router.post("/flags/{flag_id}/resolve", response_model=ScanFlagRead)
def resolve_flag(
    flag_id: uuid.UUID,
    payload: ScanFlagResolve,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    flag = db.get(VideoMatchFlag, flag_id)
    if flag is None:
        raise HTTPException(status_code=404, detail="Flag not found")
    flag.status = payload.status
    flag.note = payload.note
    flag.resolved_at = datetime.now(timezone.utc)
    flag.resolved_by = admin.id
    db.commit()
    scan_service.refresh_verified(db, [flag.video_post_id, flag.earlier_post_id])
    # Orders whose payout was paused by this review can move on now (if it was dismissed, or confirmed - once
    # the review is closed nothing holds them; the admin deals with a confirmed copy by removing it).
    try:
        waiting = db.query(Order).filter(Order.source_video_post_id == flag.video_post_id, Order.payout_status == PayoutStatus.held).all()
        sweep_auto_releases(db, waiting)
    except Exception:
        db.rollback()
        log.exception("could not release payouts after closing flag %s", flag_id)
    db.refresh(flag)
    return _flag_read(flag, db)
