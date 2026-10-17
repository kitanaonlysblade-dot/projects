import logging
import os
from datetime import datetime, timedelta, timezone

from jose import JWTError, jwt
from passlib.context import CryptContext

SECRET_KEY = os.environ["JWT_SECRET_KEY"]
if len(SECRET_KEY) < 32:
    logging.getLogger("lumin").warning(
        "JWT_SECRET_KEY is shorter than 32 characters - use a long random value (e.g. `openssl rand -hex 32`)"
    )
ALGORITHM = "HS256"
# A week, with no refresh-token flow yet — see the note on that in
# dependencies.py. Short-lived-access-token-plus-refresh-token is the
# more correct long-term setup; this is the simplest thing that works
# for now.
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def create_access_token(subject: str, mfa: bool = False) -> str:
    """subject is the user's id, as a string — decoded back out by
    decode_access_token below."""
    now = datetime.now(timezone.utc)
    expire = now + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    # iat lets a password reset end every session issued before it (see User.sessions_valid_after).
    payload = {"sub": subject, "exp": expire, "iat": int(now.timestamp())}
    if mfa:
        payload["mfa"] = True  # this session also passed the two-step code (admin routes need it)
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_access_payload(token: str) -> tuple[str, int | None] | None:
    """(user id, issued-at seconds) or None for a missing/malformed/expired token. Tokens issued before
    `iat` existed return None for the second value."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        return None
    sub = payload.get("sub")
    if not sub:
        return None
    iat = payload.get("iat")
    return sub, int(iat) if isinstance(iat, (int, float)) else None


def token_has_mfa(token: str) -> bool:
    try:
        return bool(jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM]).get("mfa"))
    except JWTError:
        return False


def decode_access_token(token: str) -> str | None:
    """Returns the user id encoded in the token, or None if it's missing,
    malformed, or expired — decode_access_token never raises on a bad
    token, since "invalid" and "expired" are both just "not logged in"
    from the caller's perspective."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        return None
    return payload.get("sub")
