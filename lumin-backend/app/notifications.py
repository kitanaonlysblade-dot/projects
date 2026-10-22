from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models import Notification, NotificationType, User


def sync_birthday_notifications(db: Session, user: User) -> None:
    """Called at the top of GET /notifications (routers/notifications.py)
    — this app has no scheduled-job infra, so "today's birthdays" gets
    computed lazily, on demand, the moment the person actually opens
    their notifications, rather than by a cron job running at midnight.
    Does not commit; the caller (list_notifications) does, in the same
    transaction as whatever else that request touches.

    Idempotent per calendar day: before creating one, checks whether a
    birthday notification for this exact followee already exists from
    today, so opening the notifications screen five times in one day
    doesn't create five copies of the same "it's so-and-so's birthday"
    notification. Comparing created_at >= start of today (UTC) rather
    than a DATE() extraction — same value in the end, but a plain range
    comparison uses an index on created_at if one ever gets added, where
    a function-wrapped column can't.
    """
    today = datetime.now(timezone.utc)
    start_of_today = today.replace(hour=0, minute=0, second=0, microsecond=0)

    followees_with_birthday_today = [
        followee
        for followee in user.following
        if followee.birthday is not None
        and followee.birthday.month == today.month
        and followee.birthday.day == today.day
    ]
    if not followees_with_birthday_today:
        return

    already_notified_ids = {
        row.target_id
        for row in db.query(Notification.target_id)
        .filter(
            Notification.user_id == user.id,
            Notification.type == NotificationType.birthday,
            Notification.created_at >= start_of_today,
        )
        .all()
    }

    for followee in followees_with_birthday_today:
        if followee.id in already_notified_ids:
            continue
        db.add(
            Notification(
                user_id=user.id,
                body=f"It's {followee.display_name}'s birthday today!",
                type=NotificationType.birthday,
                target_id=followee.id,
            )
        )

