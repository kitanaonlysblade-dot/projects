"""Lock an account for a while after too many wrong passwords (or wrong two-step codes) in a row.

The per-address rate limit (app/rate_limit.py) slows one machine down; this stops a spread-out guessing attempt
against one account. A lock lasts LOCK_MINUTES and clears itself; a correct login or a password reset clears the
counter. Trade-off: someone can deliberately lock another person out for 15 minutes - an acceptable price, and
the lock never reveals more than "try again later".
"""
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import User

MAX_FAILURES = 8
MAX_MFA_FAILURES = 5
LOCK_MINUTES = 15


def _now() -> datetime:
    return datetime.now(timezone.utc)


def raise_if_locked(user: User) -> None:
    if user.locked_until is not None and user.locked_until > _now():
        minutes = max(1, int((user.locked_until - _now()).total_seconds() // 60) + 1)
        raise HTTPException(status_code=429, detail=f"Too many attempts. Try again in {minutes} minute{'s' if minutes != 1 else ''}.")


def record_failure(db: Session, user: User, limit: int = MAX_FAILURES) -> None:
    user.failed_logins = (user.failed_logins or 0) + 1
    if user.failed_logins >= limit:
        user.locked_until = _now() + timedelta(minutes=LOCK_MINUTES)
        user.failed_logins = 0
    db.commit()


def clear(db: Session, user: User) -> None:
    if user.failed_logins or user.locked_until is not None:
        user.failed_logins = 0
        user.locked_until = None
        db.commit()
