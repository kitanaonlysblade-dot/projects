import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.auth import get_current_active_user
from app.database import get_db
from app.models import Notification, User
from app.notifications import sync_birthday_notifications
from app.schemas import NotificationRead

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("", response_model=list[NotificationRead])
def list_notifications(current_user: User = Depends(get_current_active_user), db: Session = Depends(get_db)):
    """Powers NotificationsScreen.tsx. Every other notification type
    (follow, product/discount, order, moderation) is created eagerly, at
    the moment the thing that caused it actually happens — see
    routers/users.py's follow_user, routers/merchant.py's
    update_merchant_product, routers/admin.py, and app/seed.py. Birthday
    notifications are the one exception: synced lazily right here, since
    there's no scheduled job to have created them ahead of time. See
    sync_birthday_notifications' own comment for why that's safe to
    call on every request rather than just once a day.
    """
    sync_birthday_notifications(db, current_user)
    db.commit()
    return (
        db.query(Notification)
        .filter(Notification.user_id == current_user.id)
        .order_by(Notification.created_at.desc())
        .all()
    )


@router.post("/{notification_id}/read", response_model=NotificationRead)
def mark_notification_read(
    notification_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    notification = db.get(Notification, notification_id)
    if notification is None or notification.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Notification not found")
    notification.read = True
    db.commit()
    db.refresh(notification)
    return notification


@router.post("/read-all", status_code=status.HTTP_204_NO_CONTENT)
def mark_all_notifications_read(
    current_user: User = Depends(get_current_active_user), db: Session = Depends(get_db)
):
    """Maps to NotificationsScreen.tsx's "Mark all as read" — one UPDATE
    for every unread row rather than the frontend looping one PATCH per
    notification."""
    db.query(Notification).filter(
        Notification.user_id == current_user.id, Notification.read == False  # noqa: E712
    ).update({"read": True})
    db.commit()
