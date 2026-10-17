"""Content moderation: the word filter, picture checks, report thresholds, and the admin review queue.

Four layers, all feeding one queue (ModerationItem) that admins work through in the admin console:

1. WORD FILTER (instant, in the request). Admin-managed terms (ModerationTerm). "block" refuses the text with a
   clear message; "flag" lets it through and queues it. Whole-word matching on normalised text (accents, letter
   swaps like "sh1t", stretched letters), so innocent words that merely contain a bad one are not caught.
2. PICTURE CHECKS (background job "moderate_media"). Frames of a video, thumbnails, avatars and product photos go to
   an image-safety service (app/image_safety.py). A clear hit on a video hides it from everyone but its owner at once
   (moderation_hold); a clear hit on an avatar removes the avatar; anything borderline just joins the queue and stays up.
3. REPORTS. A video reported by MODERATION_REPORT_HOLD different people (default 3) is held for review.
4. THE QUEUE. Approve = restore it and never flag the same content again. Remove = delete it and tell the owner why.

Limits, plainly: the word filter is only as good as the list, and can't catch every disguise (f.u.c.k, other
languages) unless listed; the picture service is a screen, not a judge: it makes mistakes both ways, which is why
people review what it flags, and reports remain the backstop.
"""
from app.brand import APP_NAME
import hashlib
import logging
import os
import re
import tempfile
import time
import unicodedata
import uuid
from typing import NamedTuple

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app import image_safety, jobs, storage
from app.database import SessionLocal
from app.models import (
    Comment,
    ModerationItem,
    ModerationTerm,
    Notification,
    NotificationType,
    Product,
    Report,
    ReportTargetType,
    User,
    VideoPost,
)
from app.models.screening import SEVERITY_HELD, SEVERITY_REVIEW, STATUS_APPROVED, STATUS_PENDING, STATUS_REMOVED

log = logging.getLogger(__name__)

MODERATE_MEDIA = "moderate_media"


# ------------------------------------------------------------------ text filter
_DIGIT_SWAPS = str.maketrans({"0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s"})
_TOKEN = re.compile(r"[\w@$]+")


def tokens(text: str | None) -> list[str]:
    t = unicodedata.normalize("NFKD", text or "").lower()
    t = "".join(c for c in t if not unicodedata.combining(c))
    t = re.sub(r"(.)\1{2,}", r"\1", t)  # "fuuuck" -> "fuck"; a double letter ("ass") is left alone
    out = []
    for tok in _TOKEN.findall(t):
        # Only words with letters get the swaps, so a plain number stays a number.
        out.append(tok.translate(_DIGIT_SWAPS) if re.search(r"[a-z@$]", tok) else tok)
    return out


def normalize_term(term: str) -> str:
    return " ".join(tokens(term))


class Verdict(NamedTuple):
    action: str | None  # None, "flag" or "block"
    term: str | None


_terms_cache: dict = {"at": 0.0, "terms": []}
TERMS_TTL = 60.0


def reset_terms_cache() -> None:
    _terms_cache["at"] = 0.0


def _terms(db: Session) -> list[tuple[tuple[str, ...], str, str]]:
    if time.time() - _terms_cache["at"] > TERMS_TTL:
        rows = db.query(ModerationTerm.term, ModerationTerm.action).all()
        _terms_cache["terms"] = [(tuple(t.split()), a, t) for t, a in rows if t]
        _terms_cache["at"] = time.time()
    return _terms_cache["terms"]


def _contains(words: list[str], phrase: tuple[str, ...]) -> bool:
    n = len(phrase)
    return n > 0 and any(tuple(words[i : i + n]) == phrase for i in range(len(words) - n + 1))


def check_text(db: Session, *texts: str | None) -> Verdict:
    words: list[str] = []
    for t in texts:
        words += tokens(t) + ["|"]  # a separator, so a phrase can't straddle two fields
    flagged: str | None = None
    for phrase, action, raw in _terms(db):
        if _contains(words, phrase):
            if action == "block":
                return Verdict("block", raw)
            flagged = flagged or raw
    return Verdict("flag", flagged) if flagged else Verdict(None, None)


def enforce_text(db: Session, *texts: str | None) -> str | None:
    """Refuses (400) text containing a blocked term; returns the matched term if it should merely be flagged."""
    v = check_text(db, *texts)
    if v.action == "block":
        raise HTTPException(status_code=400, detail=f"That contains language that isn't allowed on {APP_NAME}. Please change it and try again.")
    return v.term if v.action == "flag" else None


def text_key(*texts: str | None) -> str:
    return "t:" + hashlib.sha1("\n".join(t or "" for t in texts).encode()).hexdigest()


# ------------------------------------------------------------------ queue
def notify(db: Session, user_id: uuid.UUID | None, body: str) -> None:
    if user_id is not None:
        db.add(Notification(user_id=user_id, body=body, type=NotificationType.moderation))


def queue(
    db: Session,
    target_type: str,
    target_id: uuid.UUID,
    owner_id: uuid.UUID | None,
    source: str,
    category: str,
    severity: str,
    content_key: str,
    score: float | None = None,
    detail: str | None = None,
) -> ModerationItem | None:
    """Adds an item unless this exact content is already queued or was already approved. Returns the new item, or
    None when nothing new was added. Flushes; the caller commits."""
    existing = (
        db.query(ModerationItem)
        .filter(
            ModerationItem.target_type == target_type,
            ModerationItem.target_id == target_id,
            ModerationItem.content_key == content_key,
            ModerationItem.status.in_([STATUS_PENDING, STATUS_APPROVED]),
        )
        .first()
    )
    if existing is not None:
        if existing.status == STATUS_PENDING and severity == SEVERITY_HELD and existing.severity != SEVERITY_HELD:
            existing.severity = SEVERITY_HELD
        return None
    item = ModerationItem(
        target_type=target_type,
        target_id=target_id,
        owner_id=owner_id,
        source=source,
        category=category[:40],
        score=score,
        detail=(detail or "")[:500] or None,
        content_key=content_key[:300],
        severity=severity,
    )
    db.add(item)
    db.flush()
    return item


def flag_text(db: Session, target_type: str, target_id: uuid.UUID, owner_id: uuid.UUID | None, field: str, term: str, *texts: str | None) -> None:
    """A 'flag' word matched: queue it for review (the text stays up). detail starts with the field name."""
    queue(db, target_type, target_id, owner_id, "text", "word filter", SEVERITY_REVIEW, text_key(field, *texts), detail=f"{field}: matched '{term}'")


def hold_post(db: Session, post: VideoPost, body: str) -> None:
    post.moderation_hold = True
    notify(db, post.poster_id, body)


HELD_BODY = "Your video is hidden while we check it against our community rules. If it follows the rules it will be restored."


# ------------------------------------------------------------------ picture checks
def _thresholds() -> tuple[float, float]:
    return float(os.environ.get("MODERATION_HOLD_SCORE", "0.8")), float(os.environ.get("MODERATION_REVIEW_SCORE", "0.5"))


def decide(scores: dict[str, float]) -> tuple[str | None, str | None, float | None]:
    """(severity, category, score) for the worst thing in `scores`, or (None, None, None) when it is fine.
    Anything possibly involving minors is held on a much lower score. Plain 'violence' (films, sport, games) never
    holds on its own, it only asks for a look."""
    hold, review = _thresholds()
    rules = [("sexual/minors", 0.3, 0.1), ("sexual", hold, review), ("violence/graphic", hold, review), ("violence", None, max(review, 0.8))]
    best_review = None
    for cat, h, r in rules:
        s = scores.get(cat, 0.0)
        if h is not None and s >= h:
            return SEVERITY_HELD, cat, s
        if s >= r and (best_review is None or s > best_review[2]):
            best_review = (SEVERITY_REVIEW, cat, s)
    return best_review or (None, None, None)


def _combine(all_scores: list[dict[str, float]]) -> dict[str, float]:
    out: dict[str, float] = {}
    for sc in all_scores:
        for k, v in sc.items():
            out[k] = max(out.get(k, 0.0), v)
    return out


def _fetch(url: str | None, tmp: str, name: str) -> str | None:
    key = storage.key_from_view_url(url)
    if key is None:
        return None  # not one of ours (external link / demo data): nothing to download
    path = os.path.join(tmp, name + os.path.splitext(key)[1].lower())
    storage.download_object(key, path)
    return path


def _image_scores(provider, urls: list[str | None], video_url: str | None = None) -> list[dict[str, float]]:
    scores = []
    with tempfile.TemporaryDirectory() as tmp:
        for i, u in enumerate(urls):
            p = _fetch(u, tmp, f"img{i}")
            jpeg = image_safety.jpeg_from_image_file(p) if p else None
            if jpeg:
                scores.append(provider.score(jpeg))
        if video_url:
            p = _fetch(video_url, tmp, "video")
            for jpeg in (image_safety.sample_frames(p) if p else []):
                scores.append(provider.score(jpeg))
    return scores


def request_media_check(db: Session, target_type: str, target_id: uuid.UUID) -> None:
    """Queue a picture check in the caller's transaction. Does nothing when no image service is configured."""
    if image_safety.enabled():
        jobs.enqueue(db, MODERATE_MEDIA, {"target_type": target_type, "target_id": str(target_id)})


def moderate_media(payload: dict, provider=None) -> None:
    """Background job handler. Errors propagate so the job is retried (and shows under Background jobs if it keeps failing)."""
    provider = provider or image_safety.get_provider()
    if provider is None:
        return
    kind, tid = payload["target_type"], uuid.UUID(payload["target_id"])
    db = SessionLocal()
    try:
        {"video_post": _check_video, "user": _check_avatar, "product": _check_product}[kind](db, provider, tid)
    finally:
        db.close()


def _check_video(db: Session, provider, post_id: uuid.UUID) -> None:
    post = db.get(VideoPost, post_id)
    if post is None or post.repost_of_id is not None or post.retwin_kind == "product":
        return  # reposts and product retwins show the original's media, which is checked on its own
    video_url, thumb = post.video_url, post.thumbnail_url
    key = f"m:{video_url}|{thumb}"
    if _already_cleared(db, "video_post", post_id, key):
        return
    scores = _combine(_image_scores(provider, [thumb], video_url))
    db.refresh(post)
    if (post.video_url, post.thumbnail_url) != (video_url, thumb):
        return  # replaced while we were checking; the new one has its own job
    severity, cat, score = decide(scores)
    if severity is None:
        return
    item = queue(db, "video_post", post_id, post.poster_id, "media", cat, severity, key, score, f"video: {cat} {score:.2f}")
    if item is not None and severity == SEVERITY_HELD and not post.moderation_hold:
        hold_post(db, post, HELD_BODY)
    db.commit()


def _check_avatar(db: Session, provider, user_id: uuid.UUID) -> None:
    user = db.get(User, user_id)
    if user is None or not user.avatar_url:
        return
    url = user.avatar_url
    key = f"m:{url}"
    if _already_cleared(db, "user", user_id, key):
        return
    severity, cat, score = decide(_combine(_image_scores(provider, [url])))
    db.refresh(user)
    if severity is None or user.avatar_url != url:
        return
    item = queue(db, "user", user_id, user_id, "media", cat, severity, key, score, f"avatar: {cat} {score:.2f}")
    if item is not None and severity == SEVERITY_HELD:
        user.avatar_url = None
        notify(db, user_id, "Your profile picture was removed because it may break our community rules.")
    db.commit()


def _check_product(db: Session, provider, product_id: uuid.UUID) -> None:
    product = db.get(Product, product_id)
    if product is None or not product.images:
        return
    urls = [i.url for i in sorted(product.images, key=lambda i: i.position)]
    key = "m:" + hashlib.sha1("|".join(urls).encode()).hexdigest()
    if _already_cleared(db, "product", product_id, key):
        return
    severity, cat, score = decide(_combine(_image_scores(provider, urls)))
    if severity is None:
        return
    owner = product.merchant.user_id if product.merchant is not None else None
    # A listing can't be hidden the way a video is: it joins the queue for an admin to remove or clear.
    queue(db, "product", product_id, owner, "media", cat, severity, key, score, f"product photo: {cat} {score:.2f}")
    db.commit()


def _already_cleared(db: Session, target_type: str, target_id: uuid.UUID, key: str) -> bool:
    return (
        db.query(ModerationItem.id)
        .filter(ModerationItem.target_type == target_type, ModerationItem.target_id == target_id, ModerationItem.content_key == key, ModerationItem.status == STATUS_APPROVED)
        .first()
        is not None
    )


# ------------------------------------------------------------------ reports
def on_report(db: Session, report: Report) -> None:
    """Enough different people reporting a video holds it for review. The caller commits."""
    threshold = int(os.environ.get("MODERATION_REPORT_HOLD", "3"))
    if threshold <= 0 or report.target_type != ReportTargetType.video_post:
        return
    from sqlalchemy import func

    n = (
        db.query(func.count(func.distinct(Report.reporter_id)))
        .filter(Report.target_type == ReportTargetType.video_post, Report.target_id == report.target_id, Report.reporter_id.isnot(None))
        .scalar()
    ) or 0
    if n < threshold:
        return
    post = db.get(VideoPost, report.target_id)
    if post is None or post.moderation_hold:
        return
    item = queue(db, "video_post", post.id, post.poster_id, "reports", "reports", SEVERITY_HELD, "reports", None, f"{n} people reported this video")
    if item is not None:
        hold_post(db, post, HELD_BODY)


# ------------------------------------------------------------------ admin decisions
def owner_removed_count(db: Session, owner_id: uuid.UUID | None) -> int:
    if owner_id is None:
        return 0
    return db.query(ModerationItem).filter(ModerationItem.owner_id == owner_id, ModerationItem.status == STATUS_REMOVED).count()


def _close(db: Session, item: ModerationItem, status: str, admin: User, note: str | None, also_same_target: bool) -> None:
    item.status, item.resolved_by_id, item.resolution_note = status, admin.id, (note or None)
    if also_same_target:
        for other in db.query(ModerationItem).filter(
            ModerationItem.target_type == item.target_type, ModerationItem.target_id == item.target_id, ModerationItem.status == STATUS_PENDING, ModerationItem.id != item.id
        ):
            other.status, other.resolved_by_id, other.resolution_note = status, admin.id, (note or "Handled together with another item")


def approve(db: Session, item: ModerationItem, admin: User, note: str | None = None) -> None:
    """It's fine: restore it (a held video comes back) and never flag this same content again. Commits."""
    _close(db, item, STATUS_APPROVED, admin, note, also_same_target=False)
    if item.target_type == "video_post":
        post = db.get(VideoPost, item.target_id)
        still_held = (
            db.query(ModerationItem)
            .filter(ModerationItem.target_type == "video_post", ModerationItem.target_id == item.target_id, ModerationItem.status == STATUS_PENDING, ModerationItem.severity == SEVERITY_HELD, ModerationItem.id != item.id)
            .first()
            is not None
        )
        if post is not None and post.moderation_hold and not still_held:
            post.moderation_hold = False
            notify(db, post.poster_id, "We checked your video and it follows our community rules. It's visible again.")
    db.commit()


def remove(db: Session, item: ModerationItem, admin: User, note: str | None = None) -> None:
    """Take the content down and tell the owner. Commits."""
    from app.counters import bump
    from app.post_removal import remove_post

    reason = f" Reason: {note}" if note else ""
    tt, tid = item.target_type, item.target_id
    if tt == "video_post":
        post = db.get(VideoPost, tid)
        if post is not None:
            notify(db, post.poster_id, "Your video was removed because it broke our community rules." + reason)
            remove_post(db, post)
    elif tt == "comment":
        comment = db.get(Comment, tid)
        if comment is not None:
            notify(db, comment.author_id, "Your comment was removed because it broke our community rules." + reason)
            post = comment.video_post
            if post is not None:
                bump(db, post, "comments_count", -(1 + len(comment.replies)))
            if comment.parent_id is not None:
                parent = db.get(Comment, comment.parent_id)
                if parent is not None:
                    bump(db, parent, "replies_count", -1)
            db.delete(comment)
    elif tt == "product":
        product = db.get(Product, tid)
        if product is not None:
            if product.merchant is not None:
                notify(db, product.merchant.user_id, f'Your listing "{product.name}" was removed because it broke our community rules.' + reason)
            db.delete(product)
    elif tt == "user":
        user = db.get(User, tid)
        if user is not None:
            field = (item.detail or "").split(":", 1)[0]
            if field == "avatar":
                user.avatar_url = None
            elif field == "bio":
                user.bio = ""
            elif field == "display_name":
                user.display_name = user.username
            elif field == "username":
                user.username = f"user{uuid.uuid4().hex[:8]}"
            notify(db, user.id, f"Part of your profile ({field or 'profile'}) was removed because it broke our community rules." + reason)
    _close(db, item, STATUS_REMOVED, admin, note, also_same_target=True)
    db.commit()
