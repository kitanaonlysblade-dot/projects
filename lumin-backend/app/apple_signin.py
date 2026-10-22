"""Sign in with Apple: checks the identity token Apple hands the app.

Apple signs the token with one of its published keys (RS256). We check: the signature (against Apple's key list,
cached an hour), the issuer, that it is meant for *this* app (the audience is one of APPLE_CLIENT_IDS), that it has
not expired, and the nonce the app generated (so a captured token can't be replayed). Nothing the client says
alongside the token is trusted for identity.

APPLE_CLIENT_IDS is a comma-separated list: the iPhone app's bundle id (native sign-in) and, for the website, the
"Services ID" you create at developer.apple.com. Sign in with Apple is off (returns 503) while it is empty.
"""
import hashlib
import hmac
import os
import threading
import time

import httpx
from jose import JWTError, jwt

ISSUER = "https://appleid.apple.com"
KEYS_URL = "https://appleid.apple.com/auth/keys"
KEYS_TTL = 3600

_lock = threading.Lock()
_keys: dict = {"fetched": 0.0, "by_kid": {}}


class AppleTokenError(Exception):
    """The token is not a valid Apple sign-in for this app."""


def client_ids() -> list[str]:
    return [x.strip() for x in os.environ.get("APPLE_CLIENT_IDS", "").split(",") if x.strip()]


def enabled() -> bool:
    return bool(client_ids())


def _fetch_keys() -> dict:
    resp = httpx.get(KEYS_URL, timeout=10)
    resp.raise_for_status()
    return {k["kid"]: k for k in resp.json().get("keys", []) if k.get("kid")}


def _key_for(kid: str) -> dict | None:
    with _lock:
        stale = time.time() - _keys["fetched"] > KEYS_TTL
        # Re-fetch when stale, and also once when the key id is unknown (Apple rotates keys).
        if stale or kid not in _keys["by_kid"]:
            try:
                _keys["by_kid"] = _fetch_keys()
                _keys["fetched"] = time.time()
            except httpx.HTTPError:
                if kid not in _keys["by_kid"]:
                    raise AppleTokenError("Could not reach Apple to check the sign-in. Please try again.")
        return _keys["by_kid"].get(kid)


def _nonce_ok(claim: str | None, sent: str | None) -> bool:
    if not claim:
        # The app didn't use a nonce: acceptable only if it sent none either.
        return not sent
    if not sent:
        return False
    # The iPhone sign-in sends Apple the SHA-256 of the nonce; the web sign-in sends it as is. Accept either.
    hashed = hashlib.sha256(sent.encode()).hexdigest()
    return hmac.compare_digest(claim, sent) or hmac.compare_digest(claim, hashed)


def verify(id_token: str, nonce: str | None) -> dict:
    """Returns {"sub", "email", "email_verified"} or raises AppleTokenError."""
    ids = client_ids()
    if not ids:
        raise AppleTokenError("Sign in with Apple is not set up.")
    try:
        header = jwt.get_unverified_header(id_token)
    except JWTError as exc:
        raise AppleTokenError("Invalid Apple token") from exc
    if header.get("alg") != "RS256" or not header.get("kid"):
        raise AppleTokenError("Invalid Apple token")
    key = _key_for(header["kid"])
    if key is None:
        raise AppleTokenError("Invalid Apple token")
    try:
        # jose checks one audience string, so audience is checked below against the whole list.
        claims = jwt.decode(id_token, key, algorithms=["RS256"], issuer=ISSUER, options={"verify_aud": False, "verify_at_hash": False})
    except JWTError as exc:
        raise AppleTokenError("Invalid Apple token") from exc
    aud = claims.get("aud")
    auds = aud if isinstance(aud, list) else [aud]
    if not any(a in ids for a in auds):
        raise AppleTokenError("Invalid Apple token")
    if not claims.get("sub"):
        raise AppleTokenError("Invalid Apple token")
    if not _nonce_ok(claims.get("nonce"), nonce):
        raise AppleTokenError("Invalid Apple token")
    verified = claims.get("email_verified")
    return {
        "sub": str(claims["sub"]),
        "email": (claims.get("email") or "").strip().lower() or None,
        # Apple sends the boolean as the string "true" in some tokens.
        "email_verified": verified is True or str(verified).lower() == "true",
    }
