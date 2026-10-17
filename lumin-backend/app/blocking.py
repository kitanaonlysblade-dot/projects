"""Blocking: one place that answers "are these two people hidden from each other?".

A block hides both ways - the person who blocked sees nothing of the blocked account, and the blocked account
sees nothing of the blocker (so they cannot reply, follow or find them). Admins are never hidden from anyone.
"""
import uuid

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from app.models import UserBlock, UserRole, follows


def _i_blocked(user_id):
    return select(UserBlock.blocked_id).where(UserBlock.blocker_id == user_id)


def _blocked_me(user_id):
    return select(UserBlock.blocker_id).where(UserBlock.blocked_id == user_id)


def not_hidden(col, user_id):
    """SQL condition: `col` (a user-id column) is neither someone `user_id` blocked nor someone who blocked them."""
    return and_(col.notin_(_i_blocked(user_id)), col.notin_(_blocked_me(user_id)))


def hidden(col, user_id):
    """The opposite of not_hidden."""
    return or_(col.in_(_i_blocked(user_id)), col.in_(_blocked_me(user_id)))


def is_blocked_between(db: Session, a, b) -> bool:
    if a is None or b is None or a == b:
        return False
    return (
        db.query(UserBlock.blocker_id)
        .filter(
            ((UserBlock.blocker_id == a) & (UserBlock.blocked_id == b))
            | ((UserBlock.blocker_id == b) & (UserBlock.blocked_id == a))
        )
        .first()
        is not None
    )


def applies_to(viewer) -> bool:
    return viewer is not None and viewer.role != UserRole.admin


def add_block(db: Session, blocker, blocked) -> None:
    """Idempotent. Also ends any follow in either direction."""
    if not db.get(UserBlock, (blocker.id, blocked.id)):
        db.add(UserBlock(blocker_id=blocker.id, blocked_id=blocked.id))
    db.execute(
        follows.delete().where(
            ((follows.c.follower_id == blocker.id) & (follows.c.followee_id == blocked.id))
            | ((follows.c.follower_id == blocked.id) & (follows.c.followee_id == blocker.id))
        )
    )
    db.commit()


def remove_block(db: Session, blocker, blocked_id) -> None:
    row = db.get(UserBlock, (blocker.id, blocked_id))
    if row is not None:
        db.delete(row)
        db.commit()
