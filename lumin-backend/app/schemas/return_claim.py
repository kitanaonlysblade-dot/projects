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
    # Codes from app/claim_review.py's FAULTS; unknown ones are rejected by the route.
    reasons: list[str] = []


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
    reasons: list[str] = []
    status: ReturnClaimStatus
    seller_response: str | None = None
    resolution_note: str | None = None
    resolved_at: datetime | None = None
    created_at: datetime
    auto_resolved: bool = False
    appeal_by: str | None = None
    appeal_note: str | None = None
    appealed_at: datetime | None = None
    appeal_outcome: str | None = None


class ClaimCoverage(BaseModel):
    """What the seller's live test did and didn't show, for the reviewer (admin only). The suggestion is advice: a person decides."""

    has_test: bool
    serial: str | None = None
    test_id: uuid.UUID | None = None
    seller_showed: list[str] = []
    covered: list[str] = []
    not_covered: list[str] = []
    needs_review: list[str] = []
    suggestion: str  # "deny" | "refund" | "review"
    summary: str
    seal_intact_at_delivery: bool | None = None
    risk_flags: list[str] = []  # warning signs for the reviewer (app/fraud_signals.py)
    seller_video_url: str | None = None  # the seller's live test, to watch next to the buyer's video
    seller_video_s: float | None = None


class ReturnClaimAdminRead(ReturnClaimRead):
    coverage: ClaimCoverage | None = None


class ClaimAppeal(BaseModel):
    note: str | None = None


class AppealDecision(BaseModel):
    overturn: bool
    note: str | None = None


class ClaimMine(BaseModel):
    """One claim as the buyer or the seller sees it (GET /orders/claims/mine)."""

    order_id: uuid.UUID
    role: str  # "buyer" | "seller"
    status: ReturnClaimStatus
    auto_resolved: bool = False
    resolution_note: str | None = None
    can_appeal: bool = False
    appeal_by: str | None = None
    appeal_outcome: str | None = None
