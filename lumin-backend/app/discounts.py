from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import DiscountCode, DiscountKind, DiscountRedemption


def _compute_discount_amount(discount: DiscountCode, subtotal: Decimal) -> Decimal:
    if discount.kind == DiscountKind.percent:
        amount = subtotal * discount.value / Decimal("100")
        if discount.max_discount_amount is not None:
            amount = min(amount, discount.max_discount_amount)
    else:
        amount = discount.value
    # Never more than the subtotal itself — a fixed-amount code bigger
    # than the order doesn't make the order free, let alone negative.
    return min(amount, subtotal)


def _lookup_active(db: Session, code: str) -> DiscountCode:
    normalized = code.strip().upper()
    discount = db.query(DiscountCode).filter(DiscountCode.code == normalized).first()
    if discount is None or not discount.active:
        raise HTTPException(status_code=404, detail="That code isn't valid.")
    if discount.expires_at is not None and discount.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="That code has expired.")
    return discount


def _lookup_active_locked(db: Session, discount_code_id: UUID) -> DiscountCode:
    # SELECT ... FOR UPDATE by id — same reasoning as reserve_stock
    # (app/inventory.py): two people racing to use the last redemption
    # of a capped code have to serialize on this lock, not both read
    # the same pre-increment count and both succeed. By id, not code,
    # since redeem_discount is called with what /payments/initialize
    # already resolved and stored (Payment.discount_code_id) — not
    # whatever the person originally typed.
    discount = (
        db.query(DiscountCode).filter(DiscountCode.id == discount_code_id).with_for_update().first()
    )
    if discount is None or not discount.active:
        raise HTTPException(status_code=404, detail="That code isn't valid.")
    if discount.expires_at is not None and discount.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="That code has expired.")
    return discount


def preview_discount(
    db: Session, code: str, subtotal: Decimal, user_id: UUID
) -> tuple[DiscountCode, Decimal]:
    """Read-only validation for a code someone's just typed in, before
    they've paid anything — checks everything except the two things
    that can only be known race-free at actual redemption (the
    per-code and per-person caps; see redeem_discount below for why
    those wait). Used by POST /discounts/preview (instant feedback
    while editing a cart) and by /payments/initialize (which stores
    this same result on the Payment row, since Paystack has to be
    opened with an exact amount already decided).

    Still checks the caps at a read level — not to enforce them
    (redeem_discount owns that), but so a code that's already
    exhausted doesn't show as "applied, -$5" only to fail for real at
    checkout a moment later.
    """
    discount = _lookup_active(db, code)
    if discount.min_subtotal is not None and subtotal < discount.min_subtotal:
        raise HTTPException(
            status_code=400,
            detail=f"This code needs a subtotal of at least {discount.min_subtotal:.2f}.",
        )
    if discount.max_redemptions is not None and discount.redemption_count >= discount.max_redemptions:
        raise HTTPException(status_code=409, detail="This code has reached its redemption limit.")
    if discount.max_redemptions_per_user is not None:
        used = (
            db.query(DiscountRedemption)
            .filter(
                DiscountRedemption.discount_code_id == discount.id,
                DiscountRedemption.user_id == user_id,
            )
            .count()
        )
        if used >= discount.max_redemptions_per_user:
            raise HTTPException(status_code=409, detail="You've already used this code.")

    return discount, _compute_discount_amount(discount, subtotal)


def redeem_discount(
    db: Session, discount_code_id: UUID, amount_off: Decimal, user_id: UUID, payment_id: UUID
) -> None:
    """The real, race-checked spend — called from routers/payments.py's
    _fulfill at the same point reserve_stock() actually decrements
    stock, not at /payments/initialize (see DiscountRedemption's own
    comment on why). Re-validates active/expiry/both caps from
    scratch against a locked row rather than trusting
    preview_discount's earlier read — time passes between initialize
    and a Paystack charge actually confirming, in which the code could
    have been deactivated or exhausted by someone else entirely.

    amount_off is NOT recomputed here — it's whatever
    /payments/initialize already locked in and Paystack already
    charged (payment.discount_amount), passed straight through. Ever
    recomputing it at this point risks landing on a different number
    than what was actually charged, if the code's own value/subtotal
    rules changed in between.

    Raises the same HTTPException style reserve_stock does on a cap
    violation — routers/payments.py's _fulfill already catches that
    broadly (rolling back and marking the payment
    fulfillment_failed), so this needs no special-casing there, just
    to be called inside the same try block.
    """
    discount = _lookup_active_locked(db, discount_code_id)
    if discount.max_redemptions is not None and discount.redemption_count >= discount.max_redemptions:
        raise HTTPException(status_code=409, detail="This code has reached its redemption limit.")
    if discount.max_redemptions_per_user is not None:
        used = (
            db.query(DiscountRedemption)
            .filter(
                DiscountRedemption.discount_code_id == discount.id,
                DiscountRedemption.user_id == user_id,
            )
            .count()
        )
        if used >= discount.max_redemptions_per_user:
            raise HTTPException(status_code=409, detail="You've already used this code.")

    discount.redemption_count += 1
    db.add(
        DiscountRedemption(
            discount_code_id=discount.id,
            user_id=user_id,
            payment_id=payment_id,
            amount_off=amount_off,
        )
    )
