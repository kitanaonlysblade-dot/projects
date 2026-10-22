"""Stripe, as the payment gateway (PAYMENT_PROVIDER=stripe, the default).

How the money moves (Stripe calls this "separate charges and transfers" on Connect):

  1. A buyer pays. The charge lands 100% in the PLATFORM's own Stripe balance (a PaymentIntent on the platform account).
  2. The money sits there while the order is delivered and the claim window runs (app/escrow.py).
  3. When app/escrow.py releases an order, a Transfer moves that order's share (price minus any sponsored fee) from the
     platform balance to the seller's Connect account. The seller's Stripe account then pays out to their own bank.
  4. A refund goes back to the buyer's card from the same charge.

That is the same escrow shape the Paystack code had (charge, hold, transfer later), so app/escrow.py barely changes.

Sellers are Connect **Express** accounts: Stripe hosts the identity and bank-details form (account onboarding link), so
this app never sees or stores bank numbers. `MerchantAccount.stripe_account_id` is the only thing kept.

Settings:
  STRIPE_SECRET_KEY       sk_test_... / sk_live_...   (server only, never sent to the browser)
  STRIPE_PUBLIC_KEY       pk_test_... / pk_live_...   (handed to the browser to show the card form)
  STRIPE_WEBHOOK_SECRET   whsec_...                   (signing secret of the webhook endpoint /payments/stripe-webhook)
  PAYMENT_CURRENCY        default USD (PAYSTACK_CURRENCY is still read as a fallback, so old settings keep working)

Not run from the build sandbox (no network to PyPI): written against the public `stripe` Python library API and covered by
tests with a fake `stripe` module (tests/test_stripe_gateway.py). Try it in Stripe TEST mode before any live key.
"""
import os
from decimal import Decimal

from fastapi import HTTPException

try:  # the library is in requirements.txt; the import guard just lets tests and tooling load this file without it
    import stripe
except ImportError:  # pragma: no cover
    stripe = None  # type: ignore[assignment]

STRIPE_SECRET_KEY = os.environ.get("STRIPE_SECRET_KEY", "")
STRIPE_PUBLIC_KEY = os.environ.get("STRIPE_PUBLIC_KEY", "")
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "")
CURRENCY = (os.environ.get("PAYMENT_CURRENCY") or os.environ.get("PAYSTACK_CURRENCY") or "USD").upper()


def _client():
    """The stripe module with the key set, or a clear 503 (not a crash) when payments are not configured."""
    if stripe is None or not STRIPE_SECRET_KEY:
        raise HTTPException(status_code=503, detail="Payments are not set up yet (missing Stripe key)")
    stripe.api_key = STRIPE_SECRET_KEY
    return stripe


def _is_stripe_error(exc: Exception) -> bool:
    base = getattr(stripe, "StripeError", None) or getattr(getattr(stripe, "error", None), "StripeError", None)
    return base is not None and isinstance(exc, base)


def _fail(exc: Exception, what: str) -> HTTPException:
    """502 for Stripe trouble, with a message a person can act on (never the raw Stripe error, which can echo details)."""
    import logging

    logging.getLogger(__name__).warning("Stripe %s failed: %s", what, exc)
    return HTTPException(status_code=502, detail=f"Stripe {what} failed")


# ---- charging ---------------------------------------------------------------------------------------------------------
def create_payment_intent(amount_subunit: int, email: str, payment_id: str, idempotency_key: str) -> dict:
    """Starts a charge for the exact amount the SERVER computed. Returns {id, client_secret}.
    `automatic_payment_methods` lets Stripe offer whatever the dashboard has switched on, limited to methods that need no redirect
    (cards, Apple Pay, Google Pay), so paying never takes the buyer out of the app.
    `transfer_group` ties the later seller transfers to this charge in Stripe's dashboard."""
    s = _client()
    try:
        pi = s.PaymentIntent.create(
            amount=int(amount_subunit),
            currency=CURRENCY.lower(),
            automatic_payment_methods={"enabled": True, "allow_redirects": "never"},  # card, Apple Pay, Google Pay: all stay inside the app (no bank redirects)
            receipt_email=email,
            metadata={"payment_id": str(payment_id)},
            transfer_group=f"pay_{payment_id}",
            idempotency_key=idempotency_key,
        )
    except Exception as exc:
        if _is_stripe_error(exc):
            raise _fail(exc, "payment start") from exc
        raise
    return {"id": pi["id"], "client_secret": pi["client_secret"]}


def verify_transaction(reference: str) -> dict:
    """Same shape the Paystack module returned: {"status": "success"|..., "amount": <subunit>}.
    `reference` is the PaymentIntent id. Always asks Stripe (never trusts the browser or a webhook body)."""
    s = _client()
    try:
        pi = s.PaymentIntent.retrieve(reference)
    except Exception as exc:
        if _is_stripe_error(exc):
            raise _fail(exc, "payment check") from exc
        raise
    ok = pi.get("status") == "succeeded"
    # amount_received is what was actually collected; amount is what was asked for.
    return {"status": "success" if ok else (pi.get("status") or "unknown"), "amount": int(pi.get("amount_received") or 0)}


def refund_transaction(reference: str, amount_subunit: int | None = None, order_id: str | None = None) -> dict:
    """Refunds all or part of a charge to the buyer's card. One charge can fund several orders (a cart), so callers pass the
    one order's share AND its id: the idempotency key is per ORDER, so a retried click can never refund the same order twice,
    while two equal-priced orders in one cart are still refunded separately."""
    s = _client()
    args: dict = {"payment_intent": reference}
    if amount_subunit is not None:
        args["amount"] = int(amount_subunit)
    if order_id is not None:
        args["idempotency_key"] = f"refund_{order_id}"
    try:
        return s.Refund.create(**args)
    except Exception as exc:
        if _is_stripe_error(exc):
            raise _fail(exc, "refund") from exc
        raise


def construct_webhook_event(payload: bytes, signature: str) -> dict:
    """Checks the Stripe-Signature header against the raw body and returns the event, or 400. Without a configured secret
    every webhook is refused (an unsigned endpoint would let anyone mark orders paid)."""
    s = _client()
    if not STRIPE_WEBHOOK_SECRET:
        raise HTTPException(status_code=503, detail="Stripe webhook secret is not set")
    try:
        return s.Webhook.construct_event(payload, signature, STRIPE_WEBHOOK_SECRET)
    except Exception as exc:
        # ValueError (bad body) or SignatureVerificationError: either way this is not from Stripe.
        raise HTTPException(status_code=400, detail="Invalid signature") from exc


# ---- sellers (Connect Express) ----------------------------------------------------------------------------------------
def create_connect_account(email: str, business_name: str, merchant_id: str, country: str | None = None) -> str:
    """Creates the seller's Express account and returns its id (acct_...). `transfers` is the capability this app needs:
    it receives money from the platform. Stripe collects identity and bank details itself."""
    s = _client()
    args: dict = {
        "type": "express",
        "email": email,
        "capabilities": {"transfers": {"requested": True}},
        "business_profile": {"name": business_name[:100]},
        "metadata": {"merchant_id": str(merchant_id)},
    }
    if country:
        args["country"] = country.upper()
    try:
        acct = s.Account.create(idempotency_key=f"acct_{merchant_id}", **args)
    except Exception as exc:
        if _is_stripe_error(exc):
            raise _fail(exc, "seller account creation") from exc
        raise
    return acct["id"]


def onboarding_link(account_id: str, return_url: str, refresh_url: str) -> str:
    """A one-time Stripe-hosted page where the seller adds identity and bank details. Links expire in minutes, so one is
    created per tap, never stored."""
    s = _client()
    try:
        link = s.AccountLink.create(account=account_id, return_url=return_url, refresh_url=refresh_url, type="account_onboarding")
    except Exception as exc:
        if _is_stripe_error(exc):
            raise _fail(exc, "onboarding link") from exc
        raise
    return link["url"]


def dashboard_link(account_id: str) -> str:
    """Login link to the seller's own Express dashboard (balance, payout schedule, bank changes)."""
    s = _client()
    try:
        return s.Account.create_login_link(account_id)["url"]
    except Exception as exc:
        if _is_stripe_error(exc):
            raise _fail(exc, "dashboard link") from exc
        raise


def account_status(account_id: str) -> dict:
    """{"ready": bool, "details_submitted": bool, "payouts_enabled": bool}. A seller is READY when Stripe says they can
    receive transfers and pay out to a bank; until then app/escrow.py leaves their money held (nothing is lost)."""
    s = _client()
    try:
        a = s.Account.retrieve(account_id)
    except Exception as exc:
        if _is_stripe_error(exc):
            raise _fail(exc, "seller account check") from exc
        raise
    caps = a.get("capabilities") or {}
    transfers_on = caps.get("transfers") == "active"
    payouts = bool(a.get("payouts_enabled"))
    return {"ready": bool(transfers_on and payouts), "details_submitted": bool(a.get("details_submitted")), "payouts_enabled": payouts}


def create_transfer(account_id: str, amount_subunit: int, reason: str, payment_reference: str, order_id: str) -> dict:
    """Moves one order's share from the platform balance to the seller. Tied to the original charge (`source_transaction`)
    so it works even while that charge's funds are still settling, and `transfer_group` keeps it with its payment.
    The idempotency key (one per order) means a retry can never pay the same order twice. -> {"transfer_code": id}"""
    s = _client()
    args: dict = {
        "amount": int(amount_subunit),
        "currency": CURRENCY.lower(),
        "destination": account_id,
        "description": reason[:200],
        "metadata": {"order_id": str(order_id)},
    }
    try:
        pi = s.PaymentIntent.retrieve(payment_reference)
        charge = pi.get("latest_charge")
        if charge:
            args["source_transaction"] = charge if isinstance(charge, str) else charge.get("id")
        if pi.get("transfer_group"):
            args["transfer_group"] = pi["transfer_group"]
        t = s.Transfer.create(idempotency_key=f"payout_{order_id}", **args)
    except Exception as exc:
        if _is_stripe_error(exc):
            raise _fail(exc, "payout") from exc
        raise
    return {"transfer_code": t["id"]}


def to_subunit(amount) -> int:
    """Money (Decimal or number) -> the smallest unit Stripe wants (cents for USD). Rounds half up."""
    from decimal import ROUND_HALF_UP

    return int((Decimal(str(amount)) * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
