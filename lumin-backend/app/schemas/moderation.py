import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.moderation import AppealStatus, ReportReason, ReportStatus, ReportTargetType


class ReportCreate(BaseModel):
    target_type: ReportTargetType
    target_id: uuid.UUID
    reason: ReportReason
    detail: str | None = None


class ReportRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    target_type: ReportTargetType
    target_id: uuid.UUID
    reason: ReportReason
    detail: str | None = None
    status: ReportStatus
    resolution_note: str | None = None
    created_at: datetime


class ReportResolve(BaseModel):
    """PATCH .../reports/{id} in routers/admin.py. `status` should be
    `reviewed` or `actioned` — `pending` is only ever the row's own
    default, never something an admin sets it back to."""

    status: ReportStatus
    resolution_note: str | None = None


class AppealCreate(BaseModel):
    message: str


class AppealRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    message: str
    status: AppealStatus
    admin_response: str | None = None
    created_at: datetime


class AppealResolve(BaseModel):
    """PATCH .../appeals/{id} in routers/admin.py. `status` should be
    `approved` or `denied` — see that route for what `approved` also
    does to the account itself (clears is_active/ban_reason/banned_at,
    not just this row's own status)."""

    status: AppealStatus
    admin_response: str | None = None
