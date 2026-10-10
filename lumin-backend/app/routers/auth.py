import hashlib
import logging
import os
import re
import secrets
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
from sqlalchemy.orm import Session

from app.auth import create_access_token, get_current_user, hash_password, verify_password
from app.database import get_db
from app.email import send_email
from app.email_templates import password_reset_email
from app.models import PasswordResetToken, User
from app.rate_limit import limiter
from app.schemas import ForgotPasswordRequest, GoogleAuthRequest, ResetPasswordRequest, UserCreate, UserRead
from app.schemas.auth import TokenWithUser

router = APIRouter(prefix="/auth", tags=["auth"])

logger = logging.getLogger(__name__)

# Same required-at-startup convention as the other provider keys
# (PAYSTACK_SECRET_KEY, etc.) — this is the OAuth client ID from Google
# Cloud Console, used as the expected `aud` claim below so a token
# issued for some other app can't be replayed against this one.
GOOGLE_CLIENT_ID = os.environ["GOOGLE_CLIENT_ID"]
# Lower stakes than the hard-required keys above — this only ever
# builds a link inside an email, so a wrong value just makes an
# obviously-broken link in dev rather than silently misdirecting money
# or auth the way a wrong payment/OAuth config could. Defaults to the
# local Next.js dev server.
FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:3000")
PASSWORD_RESET_TOKEN_TTL = timedelta(minutes=30)


@router.post("/signup", response_model=TokenWithUser, status_code=status.HTTP_201_CREATED)
@limiter.limit("5/minute")
def signup(request: Request, payload: UserCreate, db: Session = Depends(get_db)):
    """Maps to CreateAccountScreen.tsx's manual form. The Google button
    on that same screen (GoogleSignInButton.tsx) calls POST /auth/google
    below instead — a different flow entirely, since there's no password
    to collect and the account may already exist under that email.

    Rate-limited (like login/google below) — an account-creation or
    login endpoint with no limit is an open invitation to script against
    it, whether that's spinning up spam accounts here or brute-forcing
    a password on login.
    """
    if db.query(User).filter(User.email == payload.email).first() is not None:
        raise HTTPException(status_code=400, detail="Email already registered")
    if db.query(User).filter(User.username == payload.username).first() is not None:
        raise HTTPException(status_code=400, detail="Username already taken")

    user = User(
        email=payload.email,
        hashed_password=hash_password(payload.password) if payload.password else None,
        username=payload.username,
        display_name=payload.display_name,
        bio=payload.bio,
        avatar_url=payload.avatar_url,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    return TokenWithUser(access_token=create_access_token(subject=str(user.id)), user=UserRead.model_validate(user))


@router.post("/login", response_model=TokenWithUser)
@limiter.limit("5/minute")
def login(request: Request, form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    """form_data.username is actually the user's email — the OAuth2
    password-flow form field is always called 'username' regardless of
    what field you're actually authenticating with."""
    user = db.query(User).filter(User.email == form_data.username).first()
    if (
        user is None
        or user.hashed_password is None
        or not verify_password(form_data.password, user.hashed_password)
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return TokenWithUser(access_token=create_access_token(subject=str(user.id)), user=UserRead.model_validate(user))


@router.get("/me", response_model=UserRead)
def read_current_user(current_user: User = Depends(get_current_user)):
    """Lets the frontend restore a session on load — call this with the
    stored token to get the profile back without asking the person to
    log in again."""
    return current_user


def _unique_username_from_email(db: Session, email: str) -> str:
    """Google doesn't hand back a username, only an email/name — this
    derives one the same way a person typing their own would (lowercase,
    alphanumeric-plus-underscore, the local part of the address), then
    appends a number if that's already taken. Matches the manual
    signup form's own cleanedUsername stripping (CreateAccountScreen.tsx)
    in spirit, just with nobody around to ask if a collision happens.
    """
    base = re.sub(r"[^a-z0-9_]", "", email.split("@", 1)[0].lower())[:40] or "user"
    candidate = base
    suffix = 1
    while db.query(User).filter(User.username == candidate).first() is not None:
        suffix += 1
        candidate = f"{base}{suffix}"
    return candidate


@router.post("/google", response_model=TokenWithUser)
@limiter.limit("10/minute")
def google_auth(request: Request, payload: GoogleAuthRequest, db: Session = Depends(get_db)):
    """Maps to GoogleSignInButton.tsx, used from both CreateAccountScreen
    and LoginScreen — this one endpoint covers "sign up with Google" and
    "log in with Google" both, since from the server's side those are
    the same operation: find the account this Google identity belongs
    to, or create one if this is the first time. id_token is verified
    against Google's own public keys (fetched over HTTPS by the
    google-auth library, not anything hardcoded here) and checked
    against GOOGLE_CLIENT_ID as the audience, so a token minted for a
    different app can't be replayed here.

    A looser limit than signup/login above — a valid id_token already
    proves Google authenticated this person, so this isn't guessable the
    way a password is; the cap here is just against someone hammering
    the endpoint, not a brute-force concern.
    """
    try:
        claims = google_id_token.verify_oauth2_token(
            payload.id_token, google_requests.Request(), GOOGLE_CLIENT_ID
        )
    except ValueError as exc:
        raise HTTPException(status_code=401, detail="Invalid Google token") from exc

    email = claims.get("email")
    if not email or not claims.get("email_verified"):
        raise HTTPException(status_code=401, detail="Google account has no verified email")

    user = db.query(User).filter(User.email == email).first()
    if user is None:
        user = User(
            email=email,
            hashed_password=None,
            username=_unique_username_from_email(db, email),
            display_name=claims.get("name") or email.split("@", 1)[0],
            avatar_url=claims.get("picture"),
        )
        db.add(user)
        db.commit()
        db.refresh(user)

    return TokenWithUser(access_token=create_access_token(subject=str(user.id)), user=UserRead.model_validate(user))


@router.post("/forgot-password", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("5/minute")
def forgot_password(request: Request, payload: ForgotPasswordRequest, db: Session = Depends(get_db)):
    """Maps to a "Forgot password?" link — no such link exists on
    LoginScreen.tsx yet, so nothing calls this today; added so the
    backend side of the flow exists ahead of that frontend piece.

    Always 204, whether or not the email belongs to an account, and
    whether or not sending the email actually succeeds. Responding
    differently for "no such account" vs "reset email sent" would let
    this endpoint be used to check which emails are registered — a real
    privacy leak for something meant to be usable while logged out by
    design. A Google-only account (hashed_password is None — see that
    column's own comment) is treated the same as "no such account" for
    the same reason: there's no password on file to reset.
    """
    user = db.query(User).filter(User.email == payload.email).first()
    if user is not None and user.hashed_password is not None:
        raw_token = secrets.token_urlsafe(32)
        db.add(
            PasswordResetToken(
                user_id=user.id,
                token_hash=hashlib.sha256(raw_token.encode()).hexdigest(),
                expires_at=datetime.now(timezone.utc) + PASSWORD_RESET_TOKEN_TTL,
            )
        )
        db.commit()
        reset_url = f"{FRONTEND_URL}/reset-password?token={raw_token}"
        try:
            send_email(user.email, *password_reset_email(reset_url))
        except httpx.HTTPError:
            # Best-effort — the token row above is already committed and
            # still valid even if the email itself failed to send.
            # Logged, not raised: raising here would turn into a
            # different response than the "no such account" path above,
            # which is exactly the enumeration leak this route's whole
            # design is trying to avoid.
            logger.exception("Failed to send password reset email to %s", user.email)


@router.post("/reset-password", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("5/minute")
def reset_password(request: Request, payload: ResetPasswordRequest, db: Session = Depends(get_db)):
    """The other half of forgot_password above. token is the raw value
    from the email's link — hashed the same way here as it was before
    storing, so this only ever compares hashes, never a raw token
    against anything stored in the clear.
    """
    token_hash = hashlib.sha256(payload.token.encode()).hexdigest()
    token = db.query(PasswordResetToken).filter(PasswordResetToken.token_hash == token_hash).first()
    if token is None or token.used_at is not None or token.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="This reset link is invalid or has expired")

    token.user.hashed_password = hash_password(payload.new_password)
    token.used_at = datetime.now(timezone.utc)
    db.commit()
