"""Register or remove this device for push notifications (app/push.py)."""
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app import push
from app.auth import get_current_active_user
from app.database import get_db
from app.models import PushDevice, PushSubscription, User
from app.rate_limit import limiter

router = APIRouter(prefix="/push", tags=["push"])

MAX_DEVICES = 10  # per person: the newest win


class PushConfig(BaseModel):
    enabled: bool
    public_key: str | None = None
    # Native apps (Firebase) can receive pushes.
    native: bool = False


class DeviceRequest(BaseModel):
    token: str = Field(min_length=20, max_length=500)
    platform: str = Field(pattern="^(android|ios)$")


class SubscriptionKeys(BaseModel):
    p256dh: str = Field(min_length=10, max_length=200)
    auth: str = Field(min_length=4, max_length=100)


class SubscribeRequest(BaseModel):
    endpoint: str = Field(min_length=10, max_length=1000)
    keys: SubscriptionKeys


class UnsubscribeRequest(BaseModel):
    endpoint: str = Field(min_length=10, max_length=1000)


@router.get("/config", response_model=PushConfig)
def config():
    return PushConfig(enabled=push.enabled(), public_key=push.public_key() if push.enabled() else None, native=push.native_enabled())


@router.post("/subscribe", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("30/hour")
def subscribe(
    request: Request,
    payload: SubscribeRequest,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    if not push.enabled():
        raise HTTPException(status_code=503, detail="Push notifications are not switched on.")
    if not payload.endpoint.startswith("https://"):
        raise HTTPException(status_code=400, detail="Not a valid push address.")
    agent = (request.headers.get("user-agent") or "")[:300] or None
    sub = db.query(PushSubscription).filter(PushSubscription.endpoint == payload.endpoint).first()
    if sub is None:
        sub = PushSubscription(endpoint=payload.endpoint, user_id=current_user.id, p256dh=payload.keys.p256dh, auth=payload.keys.auth, user_agent=agent)
        db.add(sub)
    else:
        # Same device, maybe a different person signed in on it now: it belongs to whoever registered last.
        sub.user_id, sub.p256dh, sub.auth, sub.user_agent = current_user.id, payload.keys.p256dh, payload.keys.auth, agent
    db.flush()
    mine = db.query(PushSubscription).filter(PushSubscription.user_id == current_user.id).order_by(PushSubscription.created_at.desc()).all()
    for old in mine[MAX_DEVICES:]:
        db.delete(old)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/unsubscribe", status_code=status.HTTP_204_NO_CONTENT)
def unsubscribe(
    payload: UnsubscribeRequest,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    db.query(PushSubscription).filter(
        PushSubscription.endpoint == payload.endpoint, PushSubscription.user_id == current_user.id
    ).delete(synchronize_session=False)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/device", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("30/hour")
def register_device(
    request: Request,
    payload: DeviceRequest,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """The native app registers this phone's Firebase token (see ../NATIVE.md)."""
    if not push.native_enabled():
        raise HTTPException(status_code=503, detail="Push notifications are not switched on.")
    device = db.query(PushDevice).filter(PushDevice.token == payload.token).first()
    if device is None:
        db.add(PushDevice(token=payload.token, user_id=current_user.id, platform=payload.platform))
    else:
        device.user_id, device.platform = current_user.id, payload.platform  # the phone now belongs to whoever signed in last
    db.flush()
    mine = db.query(PushDevice).filter(PushDevice.user_id == current_user.id).order_by(PushDevice.created_at.desc()).all()
    for old in mine[MAX_DEVICES:]:
        db.delete(old)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/device/remove", status_code=status.HTTP_204_NO_CONTENT)
def remove_device(
    payload: DeviceRequest,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    db.query(PushDevice).filter(PushDevice.token == payload.token, PushDevice.user_id == current_user.id).delete(synchronize_session=False)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
