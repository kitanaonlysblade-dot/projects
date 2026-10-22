"""Two-step login for admin accounts (authenticator-app codes, app/totp.py).

Flow: sign in with email + password as usual (that token cannot call admin routes yet) -> GET /auth/mfa/status ->
  not set up: POST /auth/mfa/setup (secret + otpauth link), then POST /auth/mfa/enable with the first code
  set up:     POST /auth/mfa/verify with the current code
Both enable and verify answer with a new login token that carries the `mfa` claim, which admin routes require.
"""
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app import lockout, totp
from app.auth import create_access_token, get_current_active_user
from app.auth.dependencies import admin_mfa_required, oauth2_scheme
from app.auth.security import token_has_mfa
from app.database import get_db
from app.models import User, UserRole
from app.rate_limit import limiter
from app.schemas import UserRead
from app.schemas.auth import TokenWithUser

router = APIRouter(prefix="/auth/mfa", tags=["auth"])
log = logging.getLogger("lumin")


class MfaStatus(BaseModel):
    enabled: bool
    required: bool  # this account must use two-step login (an admin while REQUIRE_ADMIN_MFA is on)
    session_ok: bool  # this session already passed it (or none is needed)


class MfaSetup(BaseModel):
    secret: str
    uri: str


class MfaCode(BaseModel):
    code: str = Field(min_length=6, max_length=10)


def _admin_only(user: User) -> User:
    if user.role != UserRole.admin:
        raise HTTPException(status_code=403, detail="Two-step login is for admin accounts.")
    return user


def _check_code(db: Session, user: User, secret: str, code: str) -> None:
    lockout.raise_if_locked(user)
    step = totp.verify(secret, code, user.totp_last_step)
    if step is None:
        lockout.record_failure(db, user, lockout.MAX_MFA_FAILURES)
        log.warning("admin two-step code rejected for %s", user.email)
        raise HTTPException(status_code=400, detail="That code is wrong or has already been used. Wait for the next one and try again.")
    user.totp_last_step = step
    lockout.clear(db, user)


def _token(user: User) -> TokenWithUser:
    return TokenWithUser(access_token=create_access_token(subject=str(user.id), mfa=True), user=UserRead.model_validate(user))


@router.get("/status", response_model=MfaStatus)
def mfa_status(
    user: User = Depends(get_current_active_user),
    token: str = Depends(oauth2_scheme),
):
    needed = user.role == UserRole.admin and (user.totp_enabled or admin_mfa_required())
    return MfaStatus(enabled=bool(user.totp_enabled), required=needed, session_ok=(not needed) or token_has_mfa(token))


@router.post("/setup", response_model=MfaSetup)
@limiter.limit("10/minute")
def mfa_setup(request: Request, user: User = Depends(get_current_active_user), db: Session = Depends(get_db)):
    """Start (or restart) enrolment: a new secret to put into an authenticator app. Not active until /enable."""
    _admin_only(user)
    if user.totp_enabled:
        raise HTTPException(status_code=400, detail="Two-step login is already set up for this account.")
    secret = totp.new_secret()
    user.totp_secret = totp.encrypt(secret)
    user.totp_last_step = None
    db.commit()
    return MfaSetup(secret=secret, uri=totp.provisioning_uri(secret, user.email))


@router.post("/enable", response_model=TokenWithUser)
@limiter.limit("10/minute")
def mfa_enable(request: Request, payload: MfaCode, user: User = Depends(get_current_active_user), db: Session = Depends(get_db)):
    """Finish enrolment with the first code from the app; turns two-step login on and returns an mfa session."""
    _admin_only(user)
    secret = totp.decrypt(user.totp_secret) if user.totp_secret else None
    if user.totp_enabled or secret is None:
        raise HTTPException(status_code=400, detail="Start set-up first.")
    _check_code(db, user, secret, payload.code)
    user.totp_enabled = True
    db.commit()
    log.info("admin two-step login enabled for %s", user.email)
    return _token(user)


@router.post("/verify", response_model=TokenWithUser)
@limiter.limit("10/minute")
def mfa_verify(request: Request, payload: MfaCode, user: User = Depends(get_current_active_user), db: Session = Depends(get_db)):
    """Second step of signing in: the current code from the authenticator app."""
    _admin_only(user)
    secret = totp.decrypt(user.totp_secret) if (user.totp_enabled and user.totp_secret) else None
    if secret is None:
        raise HTTPException(status_code=400, detail="Two-step login is not set up for this account.")
    _check_code(db, user, secret, payload.code)
    db.commit()
    return _token(user)
