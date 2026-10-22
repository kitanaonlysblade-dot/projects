"""Email verification: mail a 6-digit code, check it. The account is not usable until the code is entered.

REQUIRE_EMAIL_VERIFICATION=false turns the whole thing off (signup returns a login straight away, as before) -
for a deployment whose email provider is not set up yet.
"""
import hashlib
import hmac
import logging
import os
import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app import email as email_mod
from app.email_templates import verification_code_email
from app.models import EmailVerificationCode, User

logger = logging.getLogger(__name__)

CODE_TTL = timedelta(minutes=15)
MAX_ATTEMPTS = 5
RESEND_COOLDOWN = timedelta(seconds=60)


def required() -> bool:
    return os.environ.get("REQUIRE_EMAIL_VERIFICATION", "true").lower() != "false"


def _hash(user_id, code: str) -> str:
    return hashlib.sha256(f"{user_id}:{code}".encode()).hexdigest()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def issue_code(db: Session, user: User, *, respect_cooldown: bool = False) -> bool:
    """Create and email a fresh code (replacing any earlier one). Returns False when skipped by the cooldown or
    when the email could not be sent (logged); the signup/resend answer never depends on it."""
    row = db.query(EmailVerificationCode).filter(EmailVerificationCode.user_id == user.id).first()
    if respect_cooldown and row is not None and _now() - row.created_at < RESEND_COOLDOWN:
        return False
    code = f"{secrets.randbelow(1_000_000):06d}"
    if row is None:
        row = EmailVerificationCode(user_id=user.id, code_hash="", expires_at=_now())
        db.add(row)
    row.code_hash = _hash(user.id, code)
    row.expires_at = _now() + CODE_TTL
    row.attempts = 0
    row.created_at = _now()
    db.commit()
    if not email_mod.RESEND_API_KEY and os.environ.get("ENVIRONMENT", "").lower() != "production":
        logger.warning("DEV ONLY - verification code for %s is %s (RESEND_API_KEY not set)", user.email, code)
    try:
        subject, html = verification_code_email(code, int(CODE_TTL.total_seconds() // 60))
        email_mod.send_email(user.email, subject, html)
    except Exception:  # noqa: BLE001 - a flaky provider must not break signup; they can resend
        logger.exception("Failed to send verification code to %s", user.email)
        return False
    return True


def check_code(db: Session, user: User, code: str) -> bool:
    """True and the account is marked verified when `code` is right, unexpired and not used up."""
    row = db.query(EmailVerificationCode).filter(EmailVerificationCode.user_id == user.id).first()
    if row is None or row.expires_at < _now() or row.attempts >= MAX_ATTEMPTS:
        return False
    if not hmac.compare_digest(row.code_hash, _hash(user.id, code.strip())):
        row.attempts += 1
        db.commit()
        return False
    user.email_verified_at = _now()
    db.delete(row)
    db.commit()
    return True


def mark_verified(db: Session, user: User) -> None:
    """For paths that already prove the email is theirs (Google sign-in, a completed password reset)."""
    if user.email_verified_at is None:
        user.email_verified_at = _now()
        db.query(EmailVerificationCode).filter(EmailVerificationCode.user_id == user.id).delete()
        db.commit()
