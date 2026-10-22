import time

import pytest

from app import totp
from app.auth.security import create_access_token, hash_password
from app.models import UserRole
from tests.conftest import auth, make_user

PASSWORD = "correct horse battery"


@pytest.fixture(autouse=True)
def _mfa_on(monkeypatch):
    monkeypatch.setenv("REQUIRE_ADMIN_MFA", "true")


def make_admin(db):
    admin = make_user(db, "boss")
    admin.role = UserRole.admin
    admin.hashed_password = hash_password(PASSWORD)
    db.commit()
    return admin


def login(client, email, password=PASSWORD):
    return client.post("/auth/login", data={"username": email, "password": password})


def current_code(secret):
    return totp.code_at(secret, int(time.time() // totp.STEP))


def enrol(client, admin):
    """Sign in, set up, enable. Returns (secret, mfa_headers)."""
    token = login(client, admin.email).json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    secret = client.post("/auth/mfa/setup", headers=headers).json()["secret"]
    done = client.post("/auth/mfa/enable", json={"code": current_code(secret)}, headers=headers)
    assert done.status_code == 200
    return secret, {"Authorization": f"Bearer {done.json()['access_token']}"}


def test_admin_route_needs_setup_first(client, db):
    admin = make_admin(db)
    r = client.get("/admin/counters/check", headers=auth(admin))
    assert r.status_code == 403 and r.json()["detail"] == "mfa_setup_required"
    s = client.get("/auth/mfa/status", headers=auth(admin)).json()
    assert s == {"enabled": False, "required": True, "session_ok": False}


def test_setup_then_enable_gives_an_mfa_session(client, db):
    admin = make_admin(db)
    secret, mfa = enrol(client, admin)
    assert client.get("/admin/counters/check", headers=mfa).status_code == 200
    r = client.get("/admin/counters/check", headers=auth(admin))
    assert r.status_code == 403 and r.json()["detail"] == "mfa_required"
    assert client.get("/auth/mfa/status", headers=mfa).json()["session_ok"] is True


def test_secret_is_stored_encrypted(client, db):
    admin = make_admin(db)
    secret, _ = enrol(client, admin)
    db.refresh(admin)
    assert admin.totp_secret and secret not in admin.totp_secret
    assert totp.decrypt(admin.totp_secret) == secret


def test_verify_step_and_replay_refused(client, db):
    admin = make_admin(db)
    secret, _ = enrol(client, admin)
    headers = {"Authorization": f"Bearer {login(client, admin.email).json()['access_token']}"}
    db.refresh(admin)
    step = admin.totp_last_step  # the window the enrolment code used
    # The enrolment code was already used: replaying it is refused.
    assert client.post("/auth/mfa/verify", json={"code": totp.code_at(secret, step)}, headers=headers).status_code == 400
    nxt = totp.code_at(secret, step + 1)
    ok = client.post("/auth/mfa/verify", json={"code": nxt}, headers=headers)
    assert ok.status_code == 200
    mfa = {"Authorization": f"Bearer {ok.json()['access_token']}"}
    assert client.get("/admin/counters/check", headers=mfa).status_code == 200
    assert client.post("/auth/mfa/verify", json={"code": nxt}, headers=headers).status_code == 400


def test_wrong_codes_lock_the_account(client, db):
    admin = make_admin(db)
    enrol(client, admin)
    headers = {"Authorization": f"Bearer {login(client, admin.email).json()['access_token']}"}
    for _ in range(5):
        assert client.post("/auth/mfa/verify", json={"code": "000000"}, headers=headers).status_code == 400
    assert client.post("/auth/mfa/verify", json={"code": "000000"}, headers=headers).status_code == 429
    assert login(client, admin.email).status_code == 429


def test_enable_with_wrong_code_does_not_turn_it_on(client, db):
    admin = make_admin(db)
    headers = {"Authorization": f"Bearer {login(client, admin.email).json()['access_token']}"}
    client.post("/auth/mfa/setup", headers=headers)
    assert client.post("/auth/mfa/enable", json={"code": "123456"}, headers=headers).status_code == 400
    db.refresh(admin)
    assert admin.totp_enabled is False


def test_setup_twice_refused_once_enabled(client, db):
    admin = make_admin(db)
    _, mfa = enrol(client, admin)
    assert client.post("/auth/mfa/setup", headers=mfa).status_code == 400


def test_non_admins_cannot_use_it(client, db):
    fan = make_user(db, "fan")
    assert client.post("/auth/mfa/setup", headers=auth(fan)).status_code == 403
    assert client.get("/admin/counters/check", headers=auth(fan)).status_code == 403
    assert client.get("/auth/mfa/status", headers=auth(fan)).json()["required"] is False


def test_escape_hatch_env_flag(client, db, monkeypatch):
    admin = make_admin(db)
    monkeypatch.setenv("REQUIRE_ADMIN_MFA", "false")
    assert client.get("/admin/counters/check", headers=auth(admin)).status_code == 200


def test_enabled_admin_still_needs_code_even_if_flag_off(client, db, monkeypatch):
    admin = make_admin(db)
    enrol(client, admin)
    monkeypatch.setenv("REQUIRE_ADMIN_MFA", "false")
    assert client.get("/admin/counters/check", headers=auth(admin)).status_code == 403


def test_wrong_passwords_lock(client, db):
    user = make_user(db, "someone")
    user.hashed_password = hash_password(PASSWORD)
    db.commit()
    for _ in range(8):
        assert login(client, user.email, "nope").status_code == 401
    r = login(client, user.email)
    assert r.status_code == 429 and "Try again" in r.json()["detail"]


def test_a_correct_login_resets_the_counter(client, db):
    user = make_user(db, "someone")
    user.hashed_password = hash_password(PASSWORD)
    db.commit()
    for _ in range(7):
        login(client, user.email, "nope")
    assert login(client, user.email).status_code == 200
    for _ in range(7):
        assert login(client, user.email, "nope").status_code == 401
    assert login(client, user.email).status_code == 200


def test_unknown_email_is_just_401(client):
    assert login(client, "nobody@t.test").status_code == 401


def test_plain_token_is_not_an_mfa_session(client, db):
    admin = make_admin(db)
    plain = create_access_token(str(admin.id))
    assert client.get("/admin/counters/check", headers={"Authorization": f"Bearer {plain}"}).status_code == 403
