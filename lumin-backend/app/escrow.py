"""
Where an order's money actually goes once a buyer's paid for it. This
module holds, releases, and refunds funds, and deliberately has no idea
WHY a release or refund is happening — app/return_policy.py (the rules
for when a defect claim is even allowed) and routers/orders.py (the
route handlers tying the two together) are kept separate on purpose;
see return_policy's own docstring for the full reasoning.

Built on a gateway's transfer API (Stripe Connect transfers, or Paystack
Transfers; app/gateway.py picks), not split payments: a charge lands 100%
in the platform's own balance at payment time (see Payment's own comment),
and release_to_merchant below is a deliberate, separate API call made
later, whenever this module decides an order's funds are ready to move. That's what makes this an escrow rather than an instant
split — the money sits still until something explicit tells it to move.
"""

from datetime import datetime, timezone
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import Order, OrderStatus, PayoutStatus, ReturnClaim, ReturnClaimStatus
import os

from app import scan_service
from app.gateway import pay_seller, refund_transaction, seller_ready
from app.return_policy import CLAIM_WINDOW


def payout_requires_verification() -> bool:
    """REQUIRE_VERIFIED_SELLERS_FOR_PAYOUT=true: unverified sellers' payouts wait until an admin verifies them."""
    return os.environ.get("REQUIRE_VERIFIED_SELLERS_FOR_PAYOUT", "false").lower() == "true"


def release_to_merchant(db: Session, order: Order) -> None:
    """Transfers this order's price to the selling merchant's bank
    account and marks it released. A no-op — not an error — if it's
    already released or refunded, so callers (a buyer's explicit
    confirm-receipt tap, and sweep_auto_releases below) never have to
    check state themselves before calling this.
    """
    if order.payout_status != PayoutStatus.held:
        return
    if order.product is None or order.product.merchant is None:
        raise HTTPException(status_code=400, detail="No merchant to pay out to")
    if payout_requires_verification() and not order.product.merchant.verified:
        return  # REQUIRE_VERIFIED_SELLERS_FOR_PAYOUT: waits (nothing lost) until the seller is verified
    if order.id in scan_service.payout_hold_ids(db, [order]):
        # The seller's own video is under a copy review: the money stays put (nothing is lost - this is a no-op,
        # like "already released") and the next call after the review closes pays it out.
        return

    if order.product.seal_pack_size:
        # Lumin's own bag packs: the money is already the platform's, so there is nobody to pay out.
        order.payout_status = PayoutStatus.released
        db.commit()
        return

    merchant = order.product.merchant
    if not seller_ready(db, merchant):
        raise HTTPException(
            status_code=400,
            detail="This merchant hasn't finished setting up payouts yet",
        )

    # A sale made through a sponsored twin card pays the platform its percent (app/sponsored.py): held back here.
    fee = Decimal(str(order.sponsored_fee or 0))
    code = pay_seller(
        merchant,
        order,
        int(((Decimal(str(order.price)) - fee) * 100).quantize(Decimal("1"))),
        f"Payout for order {order.id}" + (f" (less {fee} sponsored sale fee)" if fee else ""),
    )
    order.payout_status = PayoutStatus.released
    order.payout_transfer_code = code
    db.commit()


def refund_for_defect(db: Session, order: Order) -> None:
    """The money side of an approved return claim — routers/admin.py's
    resolve_return_claim calls this only once an admin has approved a
    claim that routers/orders.py's report_defect already validated
    (app/return_policy.py's validate_return_claim) when it was filed.
    Always a full refund of this order's own price (never the whole
    Payment.amount) — same per-order-not-per-payment reasoning
    cancel_order already uses in routers/orders.py, for the same reason:
    one Payment can fund several Order rows, and refunding one shouldn't
    touch the others' share.
    """
    if order.payout_status != PayoutStatus.held:
        raise HTTPException(status_code=400, detail="This order's funds have already been settled")
    if order.payment is None or order.payment.reference is None:
        raise HTTPException(status_code=400, detail="No payment on record for this order")

    refund_transaction(order.payment.reference, amount_subunit=int(Decimal(str(order.price)) * 100), order_id=order.id)
    order.payout_status = PayoutStatus.refunded
    db.commit()


def sweep_auto_releases(db: Session, orders: list[Order]) -> None:
    """Releases every order in `orders` that's sat past its claim window
    with nothing filed against it — the "buyer went silent" case
    CLAIM_WINDOW's own comment describes. Called opportunistically from
    inside GET /orders/me and GET /orders/selling (routers/orders.py) on
    whatever orders that request already loaded, rather than as a
    scheduled job: this app has no background task runner, so "checked
    the next time someone happens to look at their orders" is what's
    actually achievable right now, not "exactly 24 hours later to the
    second." A real production deployment should replace this with an
    actual cron/scheduled task hitting a dedicated endpoint instead —
    noted here rather than presented as equivalent to one.

    Also skips any order with a `pending_review` return claim, even past
    the window — filing one no longer refunds immediately (see
    report_defect in routers/orders.py), so without this check funds
    could get released to the merchant while an admin still hasn't
    looked at a claim against the same order. A `refunded` or `denied`
    claim doesn't block this: the former already moved the money via
    refund_for_defect, and the latter means the claim didn't hold up, so
    the order goes back to being release-eligible same as if nothing had
    ever been filed.
    """
    now = datetime.now(timezone.utc)
    for order in orders:
        if (
            order.status == OrderStatus.delivered
            and order.payout_status == PayoutStatus.held
            and order.delivered_at is not None
            and now > order.delivered_at + CLAIM_WINDOW
        ):
            claim = db.query(ReturnClaim).filter(ReturnClaim.order_id == order.id).first()
            if claim is not None and claim.status == ReturnClaimStatus.pending_review:
                continue
            try:
                release_to_merchant(db, order)
            except HTTPException:
                # Most likely the merchant never added payout bank
                # details — see release_to_merchant's own check. Left
                # `held` rather than raised: one merchant's missing bank
                # details shouldn't break everyone else's order list
                # from loading, and there's nothing this sweep itself
                # can do about it beyond trying again next time someone
                # looks.
                continue
