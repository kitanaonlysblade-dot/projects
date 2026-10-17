"""Signup needs the emailed 6-digit code before the account works."""
import re
from datetime import datetime, timedelta, timezone

import pytest

from app import email_verification
from app.models import EmailVerificationCode, User

BODY = {"email": "pending@t.test", "username": "pendingperson", "display_name": "Pending", "password": "long-enough-1"}


@pytest.fixture()
def sent(monkeypatch):
    """Captures the mailed codes instead of sending them."""
    mails = []
    monkeypatch.setattr(email_verification.email_mod, "send_email", lambda to, subject, html: mails.append((to, subject, html)))
    return mails


def last_code(mails):
    return re.search(r"\b(\d{6})\b", mails[-1][1]).group(1)


def test_signup_sends_a_code_and_gives_no_login(client, sent):
    r = client.post("/auth/signup", json=BODY)
    assert r.status_code == 201
    assert r.json() == {"verification_required": True, "email": BODY["email"]}
    assert len(sent) == 1 and sent[0][0] == BODY["email"] and re.fullmatch(r"\d{6}", last_code(sent))


def test_the_right_code_opens_the_account(client, db, sent):
    client.post("/auth/signup", json=BODY)
    r = client.post("/auth/verify-email", json={"email": BODY["email"], "code": last_code(sent)})
    assert r.status_code == 200 and r.json()["access_token"]
    assert client.get("/auth/me", headers={"Authorization": f"Bearer {r.json()['access_token']}"}).status_code == 200
    assert client.post("/auth/login", data={"username": BODY["email"], "password": BODY["password"]}).status_code == 200
    # a code works once
    assert client.post("/auth/verify-email", json={"email": BODY["email"], "code": "000000"}).status_code == 400


def test_a_wrong_code_is_refused_and_five_wrong_guesses_kill_the_code(client, db, sent):
    client.post("/auth/signup", json=BODY)
    right = last_code(sent)
    wrong = "000000" if right != "000000" else "111111"
    for _ in range(email_verification.MAX_ATTEMPTS):
        assert client.post("/auth/verify-email", json={"email": BODY["email"], "code": wrong}).status_code == 400
    # even the right code no longer works: a new one is needed
    assert client.post("/auth/verify-email", json={"email": BODY["email"], "code": right}).status_code == 400


def test_an_expired_code_is_refused(client, db, sent):
    client.post("/auth/signup", json=BODY)
    user = db.query(User).filter(User.email == BODY["email"]).one()
    row = db.query(EmailVerificationCode).filter(EmailVerificationCode.user_id == user.id).one()
    row.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    db.commit()
    assert client.post("/auth/verify-email", json={"email": BODY["email"], "code": last_code(sent)}).status_code == 400


def test_login_is_blocked_until_verified_and_sends_a_fresh_code(client, db, sent):
    client.post("/auth/signup", json=BODY)
    user = db.query(User).filter(User.email == BODY["email"]).one()
    row = db.query(EmailVerificationCode).filter(EmailVerificationCode.user_id == user.id).one()
    row.created_at = datetime.now(timezone.utc) - timedelta(minutes=5)  # past the resend cooldown
    db.commit()
    r = client.post("/auth/login", data={"username": BODY["email"], "password": BODY["password"]})
    assert r.status_code == 403 and r.json()["detail"] == "email_not_verified"
    assert len(sent) == 2  # a new code went out
    assert client.post("/auth/login", data={"username": BODY["email"], "password": "wrong-password"}).status_code == 401


def test_resend_has_a_cooldown_and_never_reveals_accounts(client, db, sent):
    client.post("/auth/signup", json=BODY)
    assert client.post("/auth/resend-code", json={"email": BODY["email"]}).status_code == 204
    assert len(sent) == 1  # still inside the 60 second cooldown
    assert client.post("/auth/resend-code", json={"email": "nobody@t.test"}).status_code == 204
    assert len(sent) == 1


def test_an_unverified_signup_does_not_block_the_real_owner(client, db, sent):
    client.post("/auth/signup", json=BODY)  # someone typed an email they do not own
    mine = {**BODY, "username": "therealowner", "password": "another-pass-9"}
    assert client.post("/auth/signup", json=mine).status_code == 201  # the owner signs up with it
    assert client.post("/auth/verify-email", json={"email": BODY["email"], "code": last_code(sent)}).status_code == 200
    users = db.query(User).filter(User.email == BODY["email"]).all()
    assert len(users) == 1 and users[0].username == "therealowner"
    # and now the address is taken for good
    assert client.post("/auth/signup", json={**BODY, "username": "someoneelse"}).status_code == 400


def test_a_verified_username_cannot_be_taken(client, db, sent, monkeypatch):
    client.post("/auth/signup", json=BODY)
    client.post("/auth/verify-email", json={"email": BODY["email"], "code": last_code(sent)})
    other = {**BODY, "email": "second@t.test"}
    assert client.post("/auth/signup", json=other).status_code == 400  # same username


def test_verification_can_be_switched_off(client, db, sent, monkeypatch):
    monkeypatch.setenv("REQUIRE_EMAIL_VERIFICATION", "false")
    r = client.post("/auth/signup", json=BODY)
    assert r.status_code == 201 and r.json()["access_token"] and sent == []
