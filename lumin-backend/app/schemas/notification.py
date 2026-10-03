import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.notification import NotificationType


class NotificationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    body: str
    read: bool
    type: NotificationType | None = None
    target_id: uuid.UUID | None = None
    created_at: datetime
