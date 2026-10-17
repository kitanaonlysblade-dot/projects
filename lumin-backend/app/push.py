"""Push notifications (Web Push): a banner on the phone or desktop when something happens and the app is closed.

How it fits: every in-app notification is a `Notification` row, created in a dozen places. Rather than touching each,
a session listener (below) notices new Notification rows and, once the transaction commits, sends one push per device the
person subscribed (`PushSubscription`). Sending runs on a background thread, never raises into the request, and
removes subscriptions the push service says are gone (404/410).

Off until configured. Generate keys once (`python -c "from py_vapid import Vapid; v=Vapid(); v.generate_keys();
print(v.private_pem().decode()); print(v.public_key)"`, or `npx web-push generate-vapid-keys`) and set:
  VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY (the base64url pair from web-push, or a PEM), VAPID_SUBJECT (mailto:you@domain).
Native apps (Android/iPhone, see ../NATIVE.md) register an FCM token (`PushDevice`); pushes to them go through Firebase Cloud
Messaging (HTTP v1) when FIREBASE_SERVICE_ACCOUNT_JSON is set (the whole service-account JSON file, as one variable).
Browser delivery stays behind `_send_one`, native delivery behind `_send_fcm`.
"""
from app.brand import APP_NAME
import json
import logging
import os
import threading
import uuid

from sqlalchemy import event
from sqlalchemy.orm import Session

from app.models import Notification, NotificationType, PushDevice, PushSubscription

log = logging.getLogger("lumin")

# The birthday reminders are created when the notifications screen opens, so a push for one would arrive while the
# person is already looking at it.
_NO_PUSH = {NotificationType.birthday}
_TITLES = {
    NotificationType.order: "Your order",
    NotificationType.product: "New from a store you follow",
    NotificationType.moderation: "Account notice",
    NotificationType.follow: "New follower",
    NotificationType.post_like: "New like",
}


def public_key() -> str | None:
    return os.environ.get("VAPID_PUBLIC_KEY") or None


def enabled() -> bool:
    """Browser push is configured."""
    return bool(os.environ.get("VAPID_PUBLIC_KEY") and os.environ.get("VAPID_PRIVATE_KEY"))


def native_enabled() -> bool:
    """Native-app push (Firebase) is configured."""
    return bool(os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON", "").strip())


def any_enabled() -> bool:
    return enabled() or native_enabled()


def _url_for(kind, target_id) -> str:
    if kind == NotificationType.post_like and target_id:
        return f"/?post={target_id}"
    return "/?open=notifications"


def payload_for(kind, body: str, target_id) -> str:
    return json.dumps(
        {
            "title": _TITLES.get(kind, APP_NAME),
            "body": (body or "")[:200],
            "url": _url_for(kind, target_id),
            "tag": f"{getattr(kind, 'value', 'n')}-{target_id or ''}",
        }
    )


def _send_one(sub: PushSubscription, data: str) -> str:
    """'ok', 'gone' (remove the subscription) or 'error'."""
    try:
        from pywebpush import WebPushException, webpush
    except ImportError:  # library not installed: behave as off
        return "error"
    try:
        webpush(
            subscription_info={"endpoint": sub.endpoint, "keys": {"p256dh": sub.p256dh, "auth": sub.auth}},
            data=data,
            vapid_private_key=os.environ["VAPID_PRIVATE_KEY"],
            vapid_claims={"sub": os.environ.get("VAPID_SUBJECT", "mailto:support@example.com")},
            ttl=86400,
        )
        return "ok"
    except WebPushException as exc:
        status = getattr(getattr(exc, "response", None), "status_code", None)
        return "gone" if status in (404, 410) else "error"
    except Exception:  # never let a push problem surface anywhere
        log.exception("push send failed")
        return "error"


_fcm = {"session": None, "project": None}


def _fcm_session():
    """An authorised HTTP session for the Firebase API, built once from FIREBASE_SERVICE_ACCOUNT_JSON."""
    if _fcm["session"] is None:
        from google.auth.transport.requests import AuthorizedSession
        from google.oauth2 import service_account

        info = json.loads(os.environ["FIREBASE_SERVICE_ACCOUNT_JSON"])
        creds = service_account.Credentials.from_service_account_info(
            info, scopes=["https://www.googleapis.com/auth/firebase.messaging"]
        )
        _fcm["session"], _fcm["project"] = AuthorizedSession(creds), info["project_id"]
    return _fcm["session"], _fcm["project"]


def fcm_message(token: str, data: str) -> dict:
    """The FCM HTTP v1 request body for one device. `url` rides along as data so a tap can open the right screen."""
    payload = json.loads(data)
    return {
        "message": {
            "token": token,
            "notification": {"title": payload["title"], "body": payload["body"]},
            "data": {"url": payload["url"]},
            "android": {"priority": "HIGH", "notification": {"tag": payload.get("tag") or ""}},
            "apns": {"headers": {"apns-priority": "10"}, "payload": {"aps": {"sound": "default"}}},
        }
    }


def _send_fcm(device: PushDevice, data: str) -> str:
    """'ok', 'gone' (token no longer valid: remove it) or 'error'."""
    try:
        session, project = _fcm_session()
        resp = session.post(
            f"https://fcm.googleapis.com/v1/projects/{project}/messages:send", json=fcm_message(device.token, data), timeout=10
        )
        if resp.status_code == 200:
            return "ok"
        if resp.status_code in (404, 410) or (resp.status_code == 400 and "INVALID_ARGUMENT" in resp.text and "token" in resp.text.lower()):
            return "gone"
        log.warning("FCM refused a push (%s): %s", resp.status_code, resp.text[:200])
        return "error"
    except Exception:  # never let a push problem surface anywhere
        log.exception("fcm send failed")
        return "error"


def deliver(db: Session, user_id: uuid.UUID, kind, body: str, target_id) -> int:
    """Send one notification to all of a person's devices. Returns how many were sent."""
    data = payload_for(kind, body, target_id)
    sent = 0
    if enabled():
        for sub in db.query(PushSubscription).filter(PushSubscription.user_id == user_id).all():
            result = _send_one(sub, data)
            if result == "ok":
                sent += 1
            elif result == "gone":
                db.delete(sub)
    if native_enabled():
        for device in db.query(PushDevice).filter(PushDevice.user_id == user_id).all():
            result = _send_fcm(device, data)
            if result == "ok":
                sent += 1
            elif result == "gone":
                db.delete(device)
    db.commit()
    return sent


def _run(items: list[tuple]) -> None:
    from app.database import SessionLocal

    db = SessionLocal()
    try:
        for user_id, kind, body, target_id in items:
            try:
                deliver(db, user_id, kind, body, target_id)
            except Exception:
                db.rollback()
                log.exception("push delivery failed")
    finally:
        db.close()


# --- the listener: new Notification rows -> pushes after commit ------------------------------------------------

_KEY = "push_pending"


@event.listens_for(Session, "after_flush")
def _collect(session: Session, _ctx) -> None:
    if not any_enabled():
        return
    for obj in session.new:
        if isinstance(obj, Notification) and obj.user_id is not None and obj.type not in _NO_PUSH:
            session.info.setdefault(_KEY, []).append((obj.user_id, obj.type, obj.body, obj.target_id))


@event.listens_for(Session, "after_commit")
def _dispatch(session: Session) -> None:
    items = session.info.pop(_KEY, None)
    if items:
        threading.Thread(target=_run, args=(items,), daemon=True).start()


@event.listens_for(Session, "after_rollback")
def _discard(session: Session) -> None:
    session.info.pop(_KEY, None)
