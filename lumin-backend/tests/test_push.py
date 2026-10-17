import json

import pytest

from app import push
from app.models import Notification, NotificationType, PushDevice, PushSubscription
from tests.conftest import auth, make_user

SUB = {"endpoint": "https://push.example/abc123", "keys": {"p256dh": "k" * 20, "auth": "a" * 8}}


@pytest.fixture()
def on(monkeypatch):
    monkeypatch.setenv("VAPID_PUBLIC_KEY", "pub")
    monkeypatch.setenv("VAPID_PRIVATE_KEY", "priv")


def test_config_off_by_default(client):
    assert client.get("/push/config").json() == {"enabled": False, "public_key": None, "native": False}


def test_config_on(client, on):
    assert client.get("/push/config").json() == {"enabled": True, "public_key": "pub", "native": False}


def test_subscribe_needs_login_and_config(client, db, on, monkeypatch):
    assert client.post("/push/subscribe", json=SUB).status_code == 401
    me = make_user(db)
    monkeypatch.delenv("VAPID_PUBLIC_KEY")
    assert client.post("/push/subscribe", json=SUB, headers=auth(me)).status_code == 503


def test_subscribe_is_idempotent_and_moves_between_people(client, db, on):
    a, b = make_user(db, "a"), make_user(db, "b")
    assert client.post("/push/subscribe", json=SUB, headers=auth(a)).status_code == 204
    assert client.post("/push/subscribe", json=SUB, headers=auth(a)).status_code == 204
    assert db.query(PushSubscription).count() == 1
    client.post("/push/subscribe", json=SUB, headers=auth(b))
    db.expire_all()
    assert db.query(PushSubscription).one().user_id == b.id


def test_rejects_non_https_endpoint(client, db, on):
    me = make_user(db)
    bad = {**SUB, "endpoint": "http://push.example/abc123"}
    assert client.post("/push/subscribe", json=bad, headers=auth(me)).status_code == 400


def test_unsubscribe_only_own(client, db, on):
    a, b = make_user(db, "a"), make_user(db, "b")
    client.post("/push/subscribe", json=SUB, headers=auth(a))
    client.post("/push/unsubscribe", json={"endpoint": SUB["endpoint"]}, headers=auth(b))
    assert db.query(PushSubscription).count() == 1
    client.post("/push/unsubscribe", json={"endpoint": SUB["endpoint"]}, headers=auth(a))
    assert db.query(PushSubscription).count() == 0


def test_device_cap(client, db, on):
    me = make_user(db)
    for i in range(12):
        client.post("/push/subscribe", json={**SUB, "endpoint": f"https://push.example/{i:04d}xxxx"}, headers=auth(me))
    assert db.query(PushSubscription).filter(PushSubscription.user_id == me.id).count() == 10


def test_payload_shape():
    data = json.loads(push.payload_for(NotificationType.post_like, "Ada liked your video", "abc"))
    assert data["url"] == "/?post=abc" and data["title"] == "New like" and data["body"] == "Ada liked your video"
    assert json.loads(push.payload_for(NotificationType.order, "x" * 500, None))["url"] == "/?open=notifications"
    assert len(json.loads(push.payload_for(NotificationType.order, "x" * 500, None))["body"]) == 200


def test_deliver_sends_and_removes_dead_subscriptions(db, on, monkeypatch):
    me = make_user(db)
    db.add_all([
        PushSubscription(user_id=me.id, endpoint="https://push.example/live0000", p256dh="p" * 20, auth="a" * 8),
        PushSubscription(user_id=me.id, endpoint="https://push.example/dead0000", p256dh="p" * 20, auth="a" * 8),
    ])
    db.commit()
    sent = []

    def fake(sub, data):
        sent.append(sub.endpoint)
        return "gone" if "dead" in sub.endpoint else "ok"

    monkeypatch.setattr(push, "_send_one", fake)
    assert push.deliver(db, me.id, NotificationType.order, "Shipped", None) == 1
    assert len(sent) == 2
    assert [s.endpoint for s in db.query(PushSubscription).all()] == ["https://push.example/live0000"]


def test_new_notification_triggers_push_after_commit(db, on, monkeypatch):
    me = make_user(db)
    calls = []
    # Run the background step inline so the test can see it.
    monkeypatch.setattr(push, "_run", lambda items: calls.extend(items))
    monkeypatch.setattr(push.threading, "Thread", lambda target, args, daemon: type("T", (), {"start": lambda self: target(*args)})())
    db.add(Notification(user_id=me.id, body="Your order shipped", type=NotificationType.order))
    assert calls == []  # nothing before commit
    db.commit()
    assert [(c[0], c[2]) for c in calls] == [(me.id, "Your order shipped")]


def test_rollback_sends_nothing_and_birthdays_skipped(db, on, monkeypatch):
    me = make_user(db)
    calls = []
    monkeypatch.setattr(push, "_run", lambda items: calls.extend(items))
    monkeypatch.setattr(push.threading, "Thread", lambda target, args, daemon: type("T", (), {"start": lambda self: target(*args)})())
    db.add(Notification(user_id=me.id, body="x", type=NotificationType.order))
    db.flush()
    db.rollback()
    db.add(Notification(user_id=me.id, body="It's their birthday", type=NotificationType.birthday))
    db.commit()
    assert calls == []


def test_off_means_no_collection(db, monkeypatch):
    me = make_user(db)
    calls = []
    monkeypatch.setattr(push, "_run", lambda items: calls.extend(items))
    db.add(Notification(user_id=me.id, body="x", type=NotificationType.order))
    db.commit()
    assert calls == []


# ---------------------------------------------------------------- native app (Firebase)
TOKEN = "fcm-token-" + "x" * 40


@pytest.fixture()
def native(monkeypatch):
    monkeypatch.setenv("FIREBASE_SERVICE_ACCOUNT_JSON", "{}")


def test_native_config(client, native):
    assert client.get("/push/config").json()["native"] is True


def test_register_device_needs_config_login_and_valid_platform(client, db, native, monkeypatch):
    me = make_user(db)
    body = {"token": TOKEN, "platform": "android"}
    assert client.post("/push/device", json=body).status_code == 401
    assert client.post("/push/device", json={**body, "platform": "windows"}, headers=auth(me)).status_code == 422
    assert client.post("/push/device", json=body, headers=auth(me)).status_code == 204
    monkeypatch.delenv("FIREBASE_SERVICE_ACCOUNT_JSON")
    assert client.post("/push/device", json=body, headers=auth(me)).status_code == 503


def test_device_moves_to_the_latest_user_and_can_be_removed(client, db, native):
    a, b = make_user(db, "a"), make_user(db, "b")
    body = {"token": TOKEN, "platform": "ios"}
    client.post("/push/device", json=body, headers=auth(a))
    client.post("/push/device", json=body, headers=auth(b))
    db.expire_all()
    assert db.query(PushDevice).one().user_id == b.id
    client.post("/push/device/remove", json=body, headers=auth(a))  # not hers
    assert db.query(PushDevice).count() == 1
    client.post("/push/device/remove", json=body, headers=auth(b))
    assert db.query(PushDevice).count() == 0


def test_fcm_message_shape():
    msg = push.fcm_message(TOKEN, push.payload_for(NotificationType.post_like, "Ada liked your video", "abc"))["message"]
    assert msg["token"] == TOKEN and msg["notification"]["title"] == "New like"
    assert msg["data"] == {"url": "/?post=abc"}


def test_deliver_reaches_phones_and_drops_dead_tokens(db, native, monkeypatch):
    me = make_user(db)
    db.add_all([PushDevice(user_id=me.id, token="live-" + "x" * 30, platform="android"), PushDevice(user_id=me.id, token="dead-" + "x" * 30, platform="ios")])
    db.commit()
    monkeypatch.setattr(push, "_send_fcm", lambda device, data: "gone" if device.token.startswith("dead") else "ok")
    assert push.deliver(db, me.id, NotificationType.order, "Shipped", None) == 1
    assert [d.token[:4] for d in db.query(PushDevice).all()] == ["live"]


def test_notification_triggers_native_push_without_browser_keys(db, native, monkeypatch):
    me = make_user(db)
    calls = []
    monkeypatch.setattr(push, "_run", lambda items: calls.extend(items))
    monkeypatch.setattr(push.threading, "Thread", lambda target, args, daemon: type("T", (), {"start": lambda self: target(*args)})())
    db.add(Notification(user_id=me.id, body="Your order shipped", type=NotificationType.order))
    db.commit()
    assert len(calls) == 1
