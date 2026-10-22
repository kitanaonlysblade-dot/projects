"""One door to whichever payment gateway is live (app/payment_provider.py), so payments, escrow and order cancellation do
not care whether it is Stripe or Paystack. Both modules keep the same shapes:

  verify_transaction(reference) -> {"status": "success"|..., "amount": <smallest unit>}
  refund_transaction(reference, amount_subunit, order_id)
  seller_ready(merchant)            can this seller be paid right now?
  pay_seller(merchant, order, amount_subunit, reason) -> transfer code
"""
from app.payment_provider import is_stripe


def _impl_module():
    """Chosen at call time (not import time) so tests can flip the provider."""
    if is_stripe():
        from app import stripe_gateway as impl
    else:
        from app import paystack as impl
    return impl


def verify_transaction(reference: str) -> dict:
    return _impl_module().verify_transaction(reference)


def refund_transaction(reference: str, amount_subunit: int | None = None, order_id=None) -> dict:
    if is_stripe():
        return _impl_module().refund_transaction(reference, amount_subunit, str(order_id) if order_id is not None else None)
    return _impl_module().refund_transaction(reference, amount_subunit)


def seller_ready(db, merchant) -> bool:
    """Stripe: the seller finished Stripe's onboarding and can receive transfers. Paystack: bank details were added.
    For Stripe the answer is cached on the merchant (updated by the account.updated webhook); when the cache says "not yet"
    Stripe is asked once, so a seller who just finished onboarding is paid without waiting for the webhook."""
    if not is_stripe():
        return merchant.paystack_recipient_code is not None
    if not merchant.stripe_account_id:
        return False
    if merchant.stripe_ready:
        return True
    st = _impl_module().account_status(merchant.stripe_account_id)
    if st["ready"]:
        merchant.stripe_ready = True
        db.commit()
    return bool(st["ready"])


def pay_seller(merchant, order, amount_subunit: int, reason: str) -> str | None:
    if is_stripe():
        ref = order.payment.reference if order.payment is not None else None
        if not ref:
            from fastapi import HTTPException

            raise HTTPException(status_code=400, detail="No payment on record for this order")
        return _impl_module().create_transfer(merchant.stripe_account_id, amount_subunit, reason, ref, str(order.id)).get("transfer_code")
    return _impl_module().create_transfer(
        recipient_code=merchant.paystack_recipient_code, amount_subunit=amount_subunit, reason=reason
    ).get("transfer_code")
