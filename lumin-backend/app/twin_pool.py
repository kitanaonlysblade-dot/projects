"""Which moments of a shop video are taken.

A retwin plays the original's timeline with the original poster's products
plus its own — never other retwinners'. So:

* a retwinner can only claim moments the ORIGINAL poster hasn't twinned; other
  retwinners' moments don't count, any number of people can tag the same free
  moment on their own retwins;
* the original poster can twin anywhere, any time. Twins they add after a
  retwin exists show only on the original post, never on that retwin (see
  `_resolve_video_post_for_read`), so a retwin never shows two products at once.

Flagged twins (an admin said the product isn't there) give their moment back.
"""
import uuid
from typing import Iterable, Protocol

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import TwinReviewStatus, VideoPost, VideoPostTwin


class _Range(Protocol):
    start_ms: int
    end_ms: int


def overlaps(a_start: int, a_end: int, b_start: int, b_end: int) -> bool:
    return a_start < b_end and b_start < a_end


def family_root_id(post: VideoPost) -> uuid.UUID:
    """The root original this post's moments belong to."""
    return post.retwin_of_id if post.retwin_of_id is not None else post.id


def taken_twins(
    db: Session,
    root_id: uuid.UUID,
    exclude_post_id: uuid.UUID | None = None,
) -> list[VideoPostTwin]:
    """Live (non-flagged) twins on the root original, optionally leaving out
    one post's own twins (the one being edited)."""
    ids = [root_id]
    if exclude_post_id is not None:
        ids = [i for i in ids if i != exclude_post_id]
    if not ids:
        return []
    return (
        db.query(VideoPostTwin)
        .filter(VideoPostTwin.video_post_id.in_(ids), VideoPostTwin.review_status != TwinReviewStatus.flagged)
        .order_by(VideoPostTwin.start_ms)
        .all()
    )


def check_free(
    db: Session,
    root_id: uuid.UUID,
    wanted: Iterable[_Range],
    exclude_post_id: uuid.UUID | None = None,
) -> None:
    """409 if any wanted range overlaps a moment somebody else already holds."""
    held = taken_twins(db, root_id, exclude_post_id)
    for w in wanted:
        for t in held:
            if overlaps(w.start_ms, w.end_ms, t.start_ms, t.end_ms):
                raise HTTPException(
                    status_code=409,
                    detail="That moment is already taken — pick a stretch nobody has twinned yet.",
                )
