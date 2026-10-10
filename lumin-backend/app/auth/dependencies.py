import uuid

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User, UserRole

from .security import decode_access_token

# tokenUrl just tells /docs where to send the "Authorize" button's login
# request — it has to match the actual path of the login route in
# routers/auth.py, but doesn't otherwise affect how tokens are verified.
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")
# auto_error=False — a missing/malformed Authorization header returns
# None here instead of raising, which is exactly what an "attach the
# user if we happen to know who they are, but don't require it" route
# needs. Only routers/traffic.py uses this today (see that route's own
# comment on why most of what it receives is pre-login).
_optional_oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login", auto_error=False)


def get_current_user(
    token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)
) -> User:
    """Add `current_user: User = Depends(get_current_user)` to a route
    that needs a logged-in user, active OR banned — that's a short list
    on purpose: GET /auth/me (so a banned person's session-restore still
    tells them they're banned instead of just failing) and the
    appeal routes in routers/admin.py (filing one, checking its status).
    Every other protected route should use get_current_active_user
    below instead, which additionally blocks a banned account.

    Raises 401 for a missing/invalid/expired token, or one whose user
    was deleted since it was issued — there's no way to revoke a single
    still-valid token early yet (no refresh-token/session-list flow), so
    a compromised token stays valid until it expires on its own.
    """
    credentials_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    user_id = decode_access_token(token)
    if user_id is None:
        raise credentials_error
    user = db.get(User, uuid.UUID(user_id))
    if user is None:
        raise credentials_error
    return user


def get_current_active_user(current_user: User = Depends(get_current_user)) -> User:
    """The dependency almost every protected route should actually use —
    everything get_current_user already does, plus rejecting a banned
    account. A 403 with a clear reason here rather than a generic 401,
    since "your token is invalid" and "your account is suspended" are
    different problems needing different responses from whoever's
    calling this — the frontend can tell them apart and show the right
    screen (login again, vs. the suspension/appeal screen) instead of
    guessing from a bare 401.

    Deliberately still lets a banned account through get_current_user
    itself (this wraps it rather than folding the check into it) — see
    that function's own comment on why a banned person still needs to
    authenticate at all: they can't file or check an appeal otherwise.
    """
    if not current_user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This account has been suspended.",
        )
    return current_user


def get_current_admin(current_user: User = Depends(get_current_active_user)) -> User:
    """Every route in routers/admin.py depends on this instead of
    get_current_active_user. There is no route anywhere that promotes a
    user to admin — the only way this check can ever pass is if the
    role column was set directly in the database, never through this
    API. Keeping that entirely outside the app's own reachable surface
    is deliberate, not an oversight to fix later.
    """
    if current_user.role != UserRole.admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return current_user


def get_optional_user(
    token: str | None = Depends(_optional_oauth2_scheme), db: Session = Depends(get_db)
) -> User | None:
    """Never raises — a missing, malformed, expired, or otherwise
    invalid token all just resolve to None here rather than a 401,
    unlike get_current_user. For routes where knowing who's logged in
    is a nice-to-have, not a requirement: POST /traffic is the only
    caller right now, attaching user_id when a session happens to
    already be authenticated but not requiring it (most traffic events
    fire before anyone's logged in at all).
    """
    if token is None:
        return None
    user_id = decode_access_token(token)
    if user_id is None:
        return None
    return db.get(User, uuid.UUID(user_id))
