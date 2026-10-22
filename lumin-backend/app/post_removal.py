"""Removing a video post: shared by the owner's "delete this video" route and by account
deletion, so both treat other people's retwins the same way."""
from sqlalchemy.orm import Session

from app.models import Notification, NotificationType, VideoPost


def remove_post(db: Session, post: VideoPost) -> None:
    """People's own videos must survive the original going away: a video retwin is
    detached and carries on as a post of its own. A product retwin has no media of its
    own (it only tags the original's), so it goes with it. Flushes; the caller commits."""
    for retwin in db.query(VideoPost).filter(VideoPost.retwin_of_id == post.id).all():
        if retwin.retwin_kind == "video":
            retwin.retwin_of_id = None
            retwin.retwin_kind = None
            retwin.sync_offset_ms = 0
            db.add(
                Notification(
                    user_id=retwin.poster_id,
                    body="The video you retwinned was removed. Your own video stays up.",
                    type=NotificationType.retwin,
                    target_id=retwin.id,
                )
            )
        else:
            db.delete(retwin)
    db.flush()
    db.delete(post)
    db.flush()
