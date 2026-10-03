from pydantic import BaseModel, EmailStr, Field

from .user import UserRead


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class TokenWithUser(Token):
    """Signup/login return this instead of a bare Token so the frontend
    gets the full profile in the same round trip — matches how
    CreateAccountScreen.tsx's onCreate expects a complete UserProfile
    immediately, not a token it then has to exchange for one."""

    user: UserRead


class GoogleAuthRequest(BaseModel):
    """Body for POST /auth/google — the ID token Google Identity
    Services hands back to GoogleSignInButton.tsx's callback, forwarded
    here as-is. Everything about the person (email, name, picture) comes
    from verifying this token server-side, never from anything else the
    client sends — same reasoning as payments.py never trusting a
    client-supplied amount.
    """

    id_token: str


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str
    # A floor, not full password-strength rules — signup's own
    # UserCreate.password has never enforced anything at all (see that
    # field's own comment), so this is already stricter than the
    # account could have started out with, not a retrofit of a rule
    # that was previously enforced everywhere.
    new_password: str = Field(min_length=8)
