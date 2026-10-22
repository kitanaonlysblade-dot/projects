import hashlib
import time

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from jose import jwt

from app import apple_signin
from app.models import User

_private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
PRIVATE_PEM = _private.private_bytes(
    serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
).decode()
PUBLIC_PEM = _private.public_key().public_bytes(
    serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
).decode()


@pytest.fixture(autouse=True)
def apple_keys(monkeypatch):
    monkeypatch.setattr(apple_signin, "_key_for", lambda kid: PUBLIC_PEM if kid == "k1" else None)


def token(sub="001.abc", email="Jo@Example.com", verified="true", aud="com.test.app", nonce=None, exp=3600, iss="https://appleid.apple.com", kid="k1"):
    claims = {"iss": iss, "aud": aud, "sub": sub, "iat": int(time.time()), "exp": int(time.time()) + exp}
    if email is not None:
        claims["email"] = email
        claims["email_verified"] = verified
    if nonce is not None:
        claims["nonce"] = nonce
    return jwt.encode(claims, PRIVATE_PEM, algorithm="RS256", headers={"kid": kid})


def sign_in(client, tok, **extra):
    return client.post("/auth/apple", json={"id_token": tok, **extra})


def test_first_sign_in_creates_an_account(client, db):
    r = sign_in(client, token(), name="Jo Ade")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["access_token"]
    u = db.query(User).filter(User.email == "jo@example.com").one()
    assert u.apple_sub == "001.abc" and u.hashed_password is None and u.email_verified_at is not None
    assert u.display_name == "Jo Ade"
    assert client.get("/auth/me", headers={"Authorization": f"Bearer {body['access_token']}"}).status_code == 200


def test_second_sign_in_finds_the_same_account_even_with_no_email(client, db):
    sign_in(client, token())
    r = sign_in(client, token(email=None))  # Apple only sends the email some of the time
    assert r.status_code == 200
    assert db.query(User).count() == 1


def test_links_to_an_existing_account_with_the_same_verified_email(client, db):
    existing = User(email="jo@example.com", hashed_password="x", username="jo", display_name="Jo")
    db.add(existing)
    db.commit()
    assert sign_in(client, token()).status_code == 200
    db.expire_all()
    assert db.query(User).count() == 1
    assert db.query(User).one().apple_sub == "001.abc"


def test_a_new_account_needs_a_verified_email(client, db):
    assert sign_in(client, token(email=None)).status_code == 401
    assert sign_in(client, token(verified="false")).status_code == 401
    assert db.query(User).count() == 0


def test_rejects_wrong_audience_issuer_expiry_key_and_garbage(client):
    assert sign_in(client, token(aud="com.other.app")).status_code == 401
    assert sign_in(client, token(iss="https://evil.example")).status_code == 401
    assert sign_in(client, token(exp=-10)).status_code == 401
    assert sign_in(client, token(kid="unknown")).status_code == 401
    assert sign_in(client, "not-a-token").status_code == 401


def test_accepts_the_website_audience(client):
    assert sign_in(client, token(aud="com.test.web")).status_code == 200


def test_rejects_a_token_signed_with_someone_elses_key(client):
    other = rsa.generate_private_key(public_exponent=65537, key_size=2048).private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
    ).decode()
    forged = jwt.encode(
        {"iss": "https://appleid.apple.com", "aud": "com.test.app", "sub": "x", "exp": int(time.time()) + 600, "email": "a@b.com", "email_verified": "true"},
        other, algorithm="RS256", headers={"kid": "k1"},
    )
    assert sign_in(client, forged).status_code == 401


def test_nonce_rules(client):
    assert sign_in(client, token(nonce="abc"), nonce="abc").status_code == 200  # web: as is
    hashed = hashlib.sha256(b"def").hexdigest()
    assert sign_in(client, token(sub="2", email="b@example.com", nonce=hashed), nonce="def").status_code == 200  # iPhone: hashed
    assert sign_in(client, token(sub="3", email="c@example.com", nonce="abc"), nonce="wrong").status_code == 401
    assert sign_in(client, token(sub="4", email="d@example.com", nonce="abc")).status_code == 401  # replay with no nonce sent


def test_off_when_not_configured(client, monkeypatch):
    monkeypatch.setenv("APPLE_CLIENT_IDS", "")
    assert sign_in(client, token()).status_code == 503


def test_a_disabled_account_cannot_sign_in(client, db):
    sign_in(client, token())
    u = db.query(User).one()
    u.is_active = False
    db.commit()
    assert sign_in(client, token()).status_code == 403
