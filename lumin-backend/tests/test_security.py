"""Signup needs a password, a password reset signs out older sessions, and uploads have a size limit."""
import hashlib
import time
from datetime import datetime, timedelta, timezone

import pytest

from app import storage
from app.auth import create_access_token, hash_password
from app.models import PasswordResetToken
from tests.conftest import auth, make_user

SIGNUP = {"email": "new@t.test", "username": "newperson", "display_name": "New Person"}


def test_signup_needs_a_real_password(client, monkeypatch):
    monkeypatch.setenv("REQUIRE_EMAIL_VERIFICATION", "false")  # the code step has its own tests
    assert client.post("/auth/signup", json=SIGNUP).status_code == 422  # none at all
    assert client.post("/auth/signup", json={**SIGNUP, "password": "short"}).status_code == 422
    assert client.post("/auth/signup", json={**SIGNUP, "password": "x" * 200}).status_code == 422
    ok = client.post("/auth/signup", json={**SIGNUP, "password": "long-enough-1"})
    assert ok.status_code == 201 and "access_token" in ok.json()
    login = client.post("/auth/login", data={"username": SIGNUP["email"], "password": "long-enough-1"})
    assert login.status_code == 200


def test_a_password_reset_signs_out_older_sessions(client, db):
    user = make_user(db, "reset")
    user.hashed_password = hash_password("old-password-1")
    db.commit()
    old = {"Authorization": f"Bearer {create_access_token(str(user.id))}"}
    assert client.get("/auth/me", headers=old).status_code == 200

    raw = "reset-token-for-test"
    db.add(PasswordResetToken(user_id=user.id, token_hash=hashlib.sha256(raw.encode()).hexdigest(),
                              expires_at=datetime.now(timezone.utc) + timedelta(minutes=10)))
    db.commit()
    assert client.post("/auth/reset-password", json={"token": raw, "new_password": "brand-new-pass-2"}).status_code == 204

    assert client.get("/auth/me", headers=old).status_code == 401  # the old session is over
    time.sleep(1.1)  # token times are whole seconds
    new = client.post("/auth/login", data={"username": user.email, "password": "brand-new-pass-2"})
    assert new.status_code == 200
    fresh = {"Authorization": f"Bearer {new.json()['access_token']}"}
    assert client.get("/auth/me", headers=fresh).status_code == 200


def test_tokens_still_work_for_accounts_that_never_reset(client, db):
    user = make_user(db, "plain")
    assert client.get("/auth/me", headers=auth(user)).status_code == 200


@pytest.fixture()
def captured(monkeypatch):
    seen = {}

    def fake(ClientMethod, Params, ExpiresIn):
        seen.update(Params)
        return "https://upload.test/signed"

    monkeypatch.setattr(storage._s3, "generate_presigned_url", fake)
    return seen


def test_the_signed_url_is_locked_to_the_declared_size(captured):
    storage.create_presigned_upload("video/mp4", 5_000_000)
    assert captured["ContentLength"] == 5_000_000 and captured["ContentType"] == "video/mp4"


def test_oversized_files_are_refused_before_anything_is_signed(captured):
    with pytest.raises(storage.TooLarge):
        storage.create_presigned_upload("video/mp4", storage.MAX_VIDEO_BYTES + 1)
    with pytest.raises(storage.TooLarge):
        storage.create_presigned_upload("image/png", storage.MAX_IMAGE_BYTES + 1)
    assert captured == {}


def test_the_upload_route_answers_413_and_415(client, db, captured):
    user = make_user(db, "up")
    h = auth(user)
    big = client.post("/uploads/presigned-url", json={"file_type": "image/png", "file_size": storage.MAX_IMAGE_BYTES + 1}, headers=h)
    assert big.status_code == 413
    bad = client.post("/uploads/presigned-url", json={"file_type": "application/x-msdownload", "file_size": 10}, headers=h)
    assert bad.status_code == 415
    ok = client.post("/uploads/presigned-url", json={"file_type": "image/png", "file_size": 1000}, headers=h)
    assert ok.status_code == 200 and ok.json()["upload_url"] == "https://upload.test/signed"
    assert client.post("/uploads/presigned-url", json={"file_type": "image/png", "file_size": 1000}).status_code == 401
