"""
The business rules for whether a buyer's defect claim is even allowed
to be filed — kept separate from app/escrow.py (which does the actual
holding/releasing/refunding of money, and doesn't know or care WHY) and
from the route handler in routers/orders.py (which is just the thin
connective layer between this module and that one). This is the filter:
changing what counts as a valid claim — the time window, what evidence
is required, anything — should only ever mean editing this file, never
touching the money-movement code or the route itself.
"""

from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

from app.models import Order, OrderStatus, PayoutStatus

# How long after delivery a buyer can still file a defect claim. Past
# this, the window is closed — the order becomes release-eligible on
# its own (see app/escrow.py's sweep_auto_releases, which uses this
# same constant to decide that).
CLAIM_WINDOW = timedelta(hours=24)


def validate_return_claim(order: Order, video_url: str | None) -> None:
    """Raises HTTPException the moment any rule fails; returns normally
    (nothing to return — a pass is silent) if the claim is allowed to
    proceed. routers/orders.py's report_defect calls this before it
    creates a ReturnClaim row or touches any money.
    """
    if order.status != OrderStatus.delivered:
        raise HTTPException(
            status_code=400, detail="Only a delivered order can be reported as defective"
        )

    if order.payout_status != PayoutStatus.held:
        # Most commonly: the buyer already tapped "confirm receipt"
        # (POST /orders/{id}/confirm-receipt), which releases funds to
        # the merchant right away. Blocking the filing here, rather than
        # letting it through and only discovering this when an admin
        # tries to approve it later (refund_for_defect's own check would
        # catch it then too, but as a confusing failure for the admin,
        # long after the buyer who'd get the actual answer has moved on)
        # keeps the same guarantee this app had back when a claim
        # refunded in the same request it was filed in, before disputes
        # went through admin review.
        raise HTTPException(
            status_code=400,
            detail="This order's funds have already been settled — nothing left to refund",
        )

    if order.delivered_at is None:
        # Shouldn't happen — delivered implies delivered_at got set (see
        # advance_order_status) — but a missing timestamp must never be
        # treated as "the window is still open."
        raise HTTPException(status_code=400, detail="This order has no delivery date on record")

    deadline = order.delivered_at + CLAIM_WINDOW
    if datetime.now(timezone.utc) > deadline:
        raise HTTPException(
            status_code=400,
            detail="The 24-hour window to report a problem with this order has passed",
        )

    if not video_url:
        # The backend can only check that a URL is present, not where it
        # came from — see the "must be from the camera, not the gallery"
        # requirement's own note on ReturnClaim: that guarantee lives
        # entirely in the frontend's recorder UI (no file-picker
        # fallback), not in anything checkable here.
        raise HTTPException(
            status_code=400,
            detail="An unboxing video is required to report a defective item",
        )
