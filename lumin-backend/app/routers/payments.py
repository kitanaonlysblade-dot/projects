import hashlib
import hmac
import logging
import os
import uuid
from decimal import Decimal

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.auth import get_current_active_user
from app.database import get_db
from app.discounts import preview_discount, redeem_discount
from app.email import send_email
from app.email_templates import order_confirmation_email
from app.inventory import reserve_stock
from app.models import CartItem, DiscountCode, Order, Payment, PaymentMode, PaymentStatus, Product, User
from app.paystack import PAYSTACK_SECRET_KEY, verify_transaction
from app.rate_limit import limiter
from app.schemas import (
    OrderRead,
    PaymentInitializeCreate,
    PaymentInitializeRead,
    PaymentVerifyRequest,
)
from app.shipping import compute_shipping_fee, group_cart_by_merchant, resolve_shipping_address

router = APIRouter(prefix="/payments", tags=["payments"])

logger = logging.getLogger(__name__)

# PAYSTACK_SECRET_KEY comes from app.paystack (shared with orders.py's
# refund call and this file's own webhook signature check below) rather
# than reading the env var here too. PAYSTACK_PUBLIC_KEY is safe to hand
# back to the frontend (see PaymentInitializeRead below) — it stays
# local to this file since nothing else needs it.
PAYSTACK_PUBLIC_KEY = os.environ["PAYSTACK_PUBLIC_KEY"]
# Product/cart prices throughout this app (ProductCard, CartScreen, etc.)
# are displayed with a "$" — USD, not Naira — so payments are initialized
# in USD by default too, rather than assuming NGN just because Paystack
# is a Nigerian processor. Override if the connected Paystack account's
# currency is actually different from what's on screen.
PAYSTACK_CURRENCY = os.environ.get("PAYSTACK_CURRENCY", "USD")


def _snapshot_order(
    db: Session,
    buyer: User,
    product: Product,
    color: str | None,
    size: str | None,
    payment_id: uuid.UUID,
    shipping_address: dict,
) -> Order:
    """Same snapshot as orders.py's _snapshot_order, with payment_id
    added — kept as its own copy here rather than imported from that
    router, so this file doesn't reach into another router's internals
    for one helper.
    """
    order = Order(
        buyer_id=buyer.id,
        product_id=product.id,
        product_name=product.name,
        price=product.price,
        color=color,
        size=size,
        buyer_name=buyer.display_name,
        payment_id=payment_id,
    )
    order.set_shipping_address(shipping_address)
    db.add(order)
    return order


def _cart_subtotal(db: Session, user: User) -> Decimal:
    cart_items = db.query(CartItem).filter(CartItem.user_id == user.id).all()
    if not cart_items:
        raise HTTPException(status_code=400, detail="Cart is empty")
    # Early, read-only warning — NOT a reservation. Nothing is locked or
    # decremented here, since initializing a payment doesn't mean the
    # person will actually complete it (an abandoned Paystack popup
    # would otherwise "leak" stock forever). The real, race-safe check
    # is reserve_stock() inside _fulfill below, right when a charge is
    # actually confirmed — this just gives a faster, friendlier error
    # before anyone even sees the Paystack popup for a cart that was
    # already doomed.
    for item in cart_items:
        if item.product.stock_quantity is not None and item.product.stock_quantity < item.quantity:
            raise HTTPException(
                status_code=409,
                detail=f'Only {item.product.stock_quantity} left of "{item.product.name}" — not enough for this order.',
            )
    # Product subtotal only — shipping is computed separately (see
    # initialize_payment below) from the same per-merchant grouping
    # group_cart_by_merchant produces, not folded in here, so this
    # function's name keeps meaning exactly what it says.
    return sum(
        (Decimal(str(item.product.price)) * item.quantity for item in cart_items),
        Decimal("0"),
    )


def _resolve_discount(
    db: Session, code: str | None, subtotal: Decimal, user_id: uuid.UUID
) -> tuple[DiscountCode | None, Decimal, uuid.UUID | None]:
    """Thin wrapper around app/discounts.py's preview_discount, just to
    give initialize_payment a single call that also handles the "no
    code given" case — returns (None, 0, None) rather than making both
    branches of initialize_payment special-case an absent
    payload.discount_code themselves.
    """
    if code is None:
        return None, Decimal("0"), None
    discount, amount = preview_discount(db, code, subtotal, user_id)
    return discount, amount, discount.id


@router.post(
    "/initialize", response_model=PaymentInitializeRead, status_code=status.HTTP_201_CREATED
)
@limiter.limit("10/minute")
def initialize_payment(
    request: Request,
    payload: PaymentInitializeCreate,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Starts a Paystack transaction. Computes the real amount
    server-side from the product or the person's own cart_items — never
    from anything the client sent — and hands back just enough for the
    frontend to open Paystack Inline's popup (CartScreen.tsx /
    ProductDrawer.tsx). Nothing is charged and no Order exists yet;
    /payments/verify (or the webhook below) is what actually fulfils
    this once Paystack confirms the card was charged.

    amount = subtotal + shipping_fee — see compute_shipping_fee in
    app/shipping.py for how shipping is derived per-merchant, not a
    single flat number regardless of who's actually selling what's in
    the cart. When a discount_code is given, it's validated against
    that same subtotal (app/discounts.py's preview_discount — read-only
    here, not yet "spent"; see that function's own comment) and
    subtracted before shipping is added: amount = subtotal -
    discount_amount + shipping_fee. An invalid/expired/exhausted code
    fails this whole call (400/404/409) rather than silently charging
    full price.

    Also resolves and locks in a shipping address (resolve_shipping_address)
    before anything else happens — a submitted address becomes the new
    saved default (remembered as "last used" for next time, no separate
    save step); an omitted one falls back to whatever's already saved;
    neither existing is a 400, not a payment that gets charged with
    nowhere to actually ship to.

    Rate-limited — this creates a database row per call, and each one
    of those a person could open Paystack's popup against; capped so
    that's not a free way to pile up rows or bother Paystack.
    """
    if payload.mode == "buy_now":
        product = db.get(Product, payload.product_id)
        if product is None:
            raise HTTPException(status_code=404, detail="Product not found")
        if payload.quantity < 1:
            raise HTTPException(status_code=400, detail="Quantity must be at least 1")
        # Same early-warning-only check as _cart_subtotal above — see
        # that comment for why this doesn't reserve/decrement anything
        # yet.
        if product.stock_quantity is not None and product.stock_quantity < payload.quantity:
            raise HTTPException(
                status_code=409,
                detail=f'Only {product.stock_quantity} left of "{product.name}" — not enough for this order.',
            )
        subtotal = Decimal(str(product.price)) * payload.quantity
        discount, discount_amount, discount_code_id = _resolve_discount(
            db, payload.discount_code, subtotal, current_user.id
        )
        shipping_fee = compute_shipping_fee(db, {product.merchant_id: subtotal})
        shipping_address = resolve_shipping_address(db, current_user, payload.shipping_address)
        payment = Payment(
            user_id=current_user.id,
            reference=f"lumin_{uuid.uuid4().hex}",
            amount=subtotal - discount_amount + shipping_fee,
            shipping_fee=shipping_fee,
            discount_code_id=discount_code_id,
            discount_amount=discount_amount,
            mode=PaymentMode.buy_now,
            product_id=product.id,
            color=payload.color,
            size=payload.size,
            quantity=payload.quantity,
        )
    else:
        subtotal = _cart_subtotal(db, current_user)
        discount, discount_amount, discount_code_id = _resolve_discount(
            db, payload.discount_code, subtotal, current_user.id
        )
        cart_items = db.query(CartItem).filter(CartItem.user_id == current_user.id).all()
        shipping_fee = compute_shipping_fee(db, group_cart_by_merchant(cart_items))
        shipping_address = resolve_shipping_address(db, current_user, payload.shipping_address)
        payment = Payment(
            user_id=current_user.id,
            reference=f"lumin_{uuid.uuid4().hex}",
            amount=subtotal - discount_amount + shipping_fee,
            shipping_fee=shipping_fee,
            discount_code_id=discount_code_id,
            discount_amount=discount_amount,
            mode=PaymentMode.cart,
        )
    payment.set_shipping_address(shipping_address)

    db.add(payment)
    db.commit()
    db.refresh(payment)

    return PaymentInitializeRead(
        reference=payment.reference,
        # Paystack's smallest-unit convention regardless of currency —
        # cents for USD, kobo for NGN, etc.
        amount_subunit=int(payment.amount * 100),
        subtotal_subunit=int(subtotal * 100),
        shipping_subunit=int(shipping_fee * 100),
        discount_subunit=int(discount_amount * 100),
        discount_code=discount.code if discount is not None else None,
        currency=PAYSTACK_CURRENCY,
        email=current_user.email,
        public_key=PAYSTACK_PUBLIC_KEY,
    )


def _fulfill(db: Session, payment: Payment) -> list[Order]:
    """Turns a confirmed charge into real Order rows — the same
    snapshot-and-clear-the-cart logic orders.py's checkout() already
    used for the no-payment path, plus the buy_now equivalent.
    Idempotent: /payments/verify (browser-driven) and the Paystack
    webhook (server-driven) can both reach here for the same charge —
    whichever gets here first creates the orders and flips the status;
    the other just returns what's already there instead of double-
    charging the cart or duplicating orders. Also idempotent for the
    fulfillment_failed case below — once marked, repeat calls (verify
    retried, webhook redelivered) just return an empty list again
    rather than re-attempting a reservation that's already known to
    fail.

    reserve_stock() here — not at /payments/initialize — is what
    actually decrements stock, and it's the real, race-safe check (see
    its own comment on the row lock): the ones in _cart_subtotal/
    initialize_payment above are only ever an early warning.
    redeem_discount() (app/discounts.py) is the same idea applied to
    payment.discount_code_id — the actual "spend" of a code's
    redemption count, re-validated here for the same race-safety
    reason, not at initialize.
    """
    if payment.status in (PaymentStatus.success, PaymentStatus.fulfillment_failed):
        return list(payment.orders)

    new_orders: list[Order] = []
    try:
        if payment.discount_code_id is not None:
            redeem_discount(
                db, payment.discount_code_id, payment.discount_amount, payment.user_id, payment.id
            )
        if payment.mode == PaymentMode.buy_now:
            product = reserve_stock(db, payment.product_id, payment.quantity)
            for _ in range(payment.quantity):
                new_orders.append(
                    _snapshot_order(
                        db,
                        payment.user,
                        product,
                        payment.color,
                        payment.size,
                        payment.id,
                        payment.shipping_address,
                    )
                )
        else:
            cart_items = db.query(CartItem).filter(CartItem.user_id == payment.user_id).all()
            for item in cart_items:
                product = reserve_stock(db, item.product_id, item.quantity)
                for _ in range(item.quantity):
                    new_orders.append(
                        _snapshot_order(
                            db,
                            payment.user,
                            product,
                            item.color,
                            item.size,
                            payment.id,
                            payment.shipping_address,
                        )
                    )
                db.delete(item)
    except HTTPException:
        # Paystack already captured this charge — a stock conflict here
        # means the payment succeeded but there's nothing left to actually
        # ship. Rolling back undoes reserve_stock's partial decrement(s)
        # and any orders staged so far in this loop, so a cart with three
        # items where only the third ran out doesn't end up half-fulfilled
        # — either the whole payment's worth of orders gets created, or
        # none does. The payment itself is marked so a merchant/admin can
        # see it needs a manual refund (same "no refund automation yet"
        # limitation as everywhere else charges are handled in this app)
        # rather than silently vanishing with no record.
        db.rollback()
        payment.status = PaymentStatus.fulfillment_failed
        db.commit()
        raise

    payment.status = PaymentStatus.success
    db.commit()
    for order in new_orders:
        db.refresh(order)

    # Best-effort, same reasoning as forgot_password's email send in
    # routers/auth.py: the payment already succeeded and every Order row
    # above is already committed — a flaky email provider is a reason to
    # log and move on, never a reason to roll back or fail a request
    # that already did the thing it promised (charge a card, create the
    # orders). Deliberately outside the try/except above: that block's
    # rollback-on-failure only makes sense while orders/stock are still
    # being staged, not after they're already durably committed.
    try:
        send_email(payment.user.email, *order_confirmation_email(new_orders, payment))
    except httpx.HTTPError:
        logger.exception("Failed to send order confirmation email for payment %s", payment.id)

    return new_orders


@router.post("/verify", response_model=list[OrderRead])
@limiter.limit("10/minute")
def verify_payment(
    request: Request,
    payload: PaymentVerifyRequest,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Called right after Paystack Inline's popup reports success.
    Re-checks the charge against Paystack's own API (never trusts the
    popup's callback alone — that's just UI state on the person's own
    browser) before creating anything. Rate-limited for the same reason
    as initialize above — each call is a real outbound request to
    Paystack's API, not something to leave uncapped.
    """
    payment = db.query(Payment).filter(Payment.reference == payload.reference).first()
    if payment is None or payment.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Payment not found")

    if payment.status == PaymentStatus.success:
        return list(payment.orders)

    data = verify_transaction(payment.reference)
    if data.get("status") != "success":
        payment.status = PaymentStatus.failed
        db.commit()
        raise HTTPException(status_code=402, detail="Payment was not successful")

    paid = Decimal(str(data.get("amount", 0))) / 100
    if paid < payment.amount:
        payment.status = PaymentStatus.failed
        db.commit()
        raise HTTPException(status_code=402, detail="Amount paid does not match what's owed")

    return _fulfill(db, payment)


@router.post("/webhook", status_code=status.HTTP_200_OK)
async def paystack_webhook(request: Request, db: Session = Depends(get_db)):
    """Paystack's own server-to-server confirmation — covers the case
    where the person's browser closes right after paying, before it
    gets a chance to call /payments/verify itself. No auth dependency
    (Paystack calls this directly); the signature check below is what
    proves a request actually came from Paystack rather than anyone who
    happens to know this URL — HMAC-SHA512 over the exact raw body,
    keyed with the same secret key /payments/verify uses to call out to
    Paystack.
    """
    body = await request.body()
    signature = request.headers.get("x-paystack-signature", "")
    expected = hmac.new(PAYSTACK_SECRET_KEY.encode(), body, hashlib.sha512).hexdigest()
    if not signature or not hmac.compare_digest(expected, signature):
        raise HTTPException(status_code=400, detail="Invalid signature")

    event = await request.json()
    if event.get("event") != "charge.success":
        return {"status": "ignored"}

    reference = event.get("data", {}).get("reference")
    if not reference:
        return {"status": "ignored"}

    payment = db.query(Payment).filter(Payment.reference == reference).first()
    if payment is None or payment.status == PaymentStatus.success:
        return {"status": "ok"}

    # Re-verify against Paystack's API rather than trusting this
    # webhook's own body for the amount/status — same check
    # /payments/verify does, just triggered from the other direction.
    data = verify_transaction(reference)
    if data.get("status") != "success":
        payment.status = PaymentStatus.failed
        db.commit()
        return {"status": "ok"}

    paid = Decimal(str(data.get("amount", 0))) / 100
    if paid < payment.amount:
        payment.status = PaymentStatus.failed
        db.commit()
        return {"status": "ok"}

    try:
        _fulfill(db, payment)
    except HTTPException:
        # _fulfill already marked payment.status = fulfillment_failed and
        # committed that before re-raising — still answering Paystack
        # with 200 here regardless: this webhook only needs to confirm
        # receipt, and retrying delivery wouldn't change the outcome,
        # since the stock shortfall it hit isn't a transient problem.
        pass
    return {"status": "ok"}
