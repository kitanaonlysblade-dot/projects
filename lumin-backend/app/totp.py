"""Time-based one-time passwords (RFC 6238) for admin two-step login - the 6-digit code in an authenticator app.

Standard library only. The secret is stored encrypted (Fernet, key derived from JWT_SECRET_KEY), so a database leak
alone does not hand out admin codes.
"""
from app.brand import APP_NAME
import base64
import hashlib
import hmac
import os
import secrets
import struct
import time
from urllib.parse import quote

from cryptography.fernet import Fernet, InvalidToken

STEP = 30
DIGITS = 6


def new_secret() -> str:
    """A fresh random secret, base32 (what authenticator apps expect)."""
    return base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")


def _key(secret_b32: str) -> bytes:
    return base64.b32decode(secret_b32 + "=" * (-len(secret_b32) % 8), casefold=True)


def code_at(secret_b32: str, step: int) -> str:
    digest = hmac.new(_key(secret_b32), struct.pack(">Q", step), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    value = (struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF) % (10**DIGITS)
    return f"{value:0{DIGITS}d}"


def verify(secret_b32: str, code: str, last_step: int | None = None, now: float | None = None) -> int | None:
    """The accepted time step when `code` is valid (this 30 s window or one either side, for clock drift), else
    None. A step at or before `last_step` is refused: each code works once, so a shoulder-surfed or intercepted
    code cannot be replayed."""
    code = (code or "").strip().replace(" ", "")
    if len(code) != DIGITS or not code.isdigit():
        return None
    current = int((time.time() if now is None else now) // STEP)
    for step in (current - 1, current, current + 1):
        if last_step is not None and step <= last_step:
            continue
        if hmac.compare_digest(code_at(secret_b32, step), code):
            return step
    return None


def provisioning_uri(secret_b32: str, account: str, issuer: str = f"{APP_NAME} Admin") -> str:
    return f"otpauth://totp/{quote(issuer)}:{quote(account)}?secret={secret_b32}&issuer={quote(issuer)}&digits={DIGITS}&period={STEP}"


def _fernet() -> Fernet:
    seed = hashlib.sha256(("totp-secret:" + os.environ["JWT_SECRET_KEY"]).encode()).digest()
    return Fernet(base64.urlsafe_b64encode(seed))


def encrypt(secret_b32: str) -> str:
    return _fernet().encrypt(secret_b32.encode()).decode()


def decrypt(token: str) -> str | None:
    try:
        return _fernet().decrypt(token.encode()).decode()
    except InvalidToken:
        return None
