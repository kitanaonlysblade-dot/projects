import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.return_claim import ReturnClaimStatus


class ReturnClaimCreate(BaseModel):
    # Required — app/return_policy.py's validate_return_claim rejects a
    # missing one before a ReturnClaim row ever gets created. See that
    # module's own comment on why "must be from the camera" is a
    # frontend-only guarantee this field can't itself verify.
    video_url: str
    reason: str | None = None


class ReturnClaimSellerResponse(BaseModel):
    """The selling merchant's one-shot rebuttal — POST
    /orders/{id}/return-claim/respond in routers/orders.py. Its own
    schema rather than reusing ReturnClaimCreate: that one requires
    video_url, which has no meaning for a seller's text response."""

    message: str


class ReturnClaimResolve(BaseModel):
    """PATCH /admin/return-claims/{id} in routers/admin.py. Binary
    rather than accepting a full ReturnClaimStatus — the only two
    outcomes a resolution can ever produce are `refunded` or `denied`;
    `pending_review` is a row's own starting state, never something a
    resolution sets it back to."""

    approve: bool
    resolution_note: str | None = None


class ReturnClaimRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    order_id: uuid.UUID
    video_url: str
    reason: str | None = None
    status: ReturnClaimStatus
    seller_response: str | None = None
    resolution_note: str | None = None
    resolved_at: datetime | None = None
    created_at: datetime
