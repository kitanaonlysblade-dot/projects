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


class AppleAuthRequest(BaseModel):
    """Body for POST /auth/apple. `id_token` is Apple's signed token (verified server-side; it alone decides who
    the person is). `nonce` is the random value the app generated before asking Apple (replay protection).
    `name` is only used to fill the display name on a brand-new account: Apple gives the name to the app, not in
    the token, and only the first time, so it is never trusted for anything but that."""

    id_token: str
    nonce: str | None = None
    name: str | None = None


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


class VerifyEmailRequest(BaseModel):
    email: EmailStr
    code: str = Field(min_length=4, max_length=10)


class ResendCodeRequest(BaseModel):
    email: EmailStr


class PendingVerification(BaseModel):
    """What signup answers while the email is still unproven: no login yet, just 'enter the code we sent'."""

    verification_required: bool = True
    email: str
