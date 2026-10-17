import uuid
from collections import defaultdict
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import DeliveryCompany, User
from app.schemas import ShippingAddress

# Used only when no DeliveryCompany row is active at all (a fresh
# database before seed.py has run, or every company's is_active toggled
# off) — never a per-merchant or per-product fallback the way this used
# to be back when shipping settings lived on MerchantAccount. Delivery
# pricing is entirely the active company's business now; this constant
# exists purely so checkout still works with a sane number instead of
# erroring when the platform hasn't configured a courier yet.
DEFAULT_SHIPPING_FLAT_FEE = Decimal("4.99")


def resolve_shipping_address(db: Session, user: User, submitted: ShippingAddress | None) -> dict:
    """The single place both checkout paths (orders.py's legacy
    no-payment route, payments.py's real one) turn "whatever address the
    request carried, if any" into an actual address dict ready to
    snapshot onto an Order/Payment — and the single place that updates
    the user's saved default to match, so an address used at checkout is
    remembered as "last used" without the frontend needing a separate
    save step or a "save this address" checkbox.

    Shared as its own module rather than duplicated per-router the way
    each router's own small _snapshot_order is (see that function's own
    comment on why that one's copied, not shared) — this is meaningfully
    more logic, with a real failure mode (see the 400 below) worth
    getting right in exactly one place, same reasoning as reserve_stock
    living in app/inventory.py instead of being duplicated too.

    Raises 400 if there's nothing to resolve to: no address on the
    request and none saved yet either. Doesn't commit — callers already
    have their own transaction (an Order/Payment row being created in
    the same one) and a saved-default update here should roll back
    together with that, not commit independently of whether the rest of
    the checkout actually succeeds.
    """
    if submitted is not None:
        address = submitted.model_dump()
        user.set_shipping_address(address)
        return address
    if user.shipping_address is not None:
        return user.shipping_address
    raise HTTPException(
        status_code=400,
        detail="A shipping address is required — none was provided and none is saved on this account.",
    )


def group_cart_by_merchant(cart_items) -> dict[uuid.UUID | None, Decimal]:
    """The `merchant_subtotals` compute_shipping_fee needs, built once
    here instead of separately in payments.py's cart-mode initialize and
    orders.py's checkout() — both group the same CartItem rows by
    product.merchant_id the same way, so there's exactly one place that
    decides what "this merchant's share of the cart" means.
    """
    subtotals: dict[uuid.UUID | None, Decimal] = defaultdict(lambda: Decimal("0"))
    for item in cart_items:
        subtotals[item.product.merchant_id] += Decimal(str(item.product.price)) * item.quantity
    return dict(subtotals)


def compute_shipping_fee(db: Session, merchant_subtotals: dict[uuid.UUID | None, Decimal]) -> Decimal:
    """Delivery-fee logic for a checkout, real multi-merchant-aware —
    not a single flat number tacked onto every order. `merchant_subtotals`
    is each distinct merchant represented in this checkout (grouped by
    group_cart_by_merchant above; None for products with no merchant)
    mapped to the sum of that merchant's own line totals (price *
    quantity, before shipping) — kept as a per-merchant grouping because
    physically these are still separate parcels from separate sellers
    even when the same courier delivers all of them, the same way
    ordering from three different sellers on a real marketplace still
    means three separate shipments and (usually) three separate shipping
    lines.

    The rate and free-shipping threshold applied to every one of those
    parcels both come from the same place now, though: whichever single
    DeliveryCompany has is_active=True — not the merchant. A merchant
    selling the product has no say in what it costs to ship it; that's
    the courier's business, priced identically for every seller on the
    platform. A cart spanning three merchants can still owe shipping to
    two of them and get free shipping from the third, because each
    parcel's own subtotal is checked against the threshold independently
    — a cart-wide total would let one cheap item from merchant A
    quietly count toward merchant B's parcel clearing the threshold it
    never actually reached on its own.

    Falls back to DEFAULT_SHIPPING_FLAT_FEE with no free-shipping tier
    if no company is currently active. If more than one row is active
    at once (nothing currently prevents that — see DeliveryCompany's own
    comment), whichever one the query happens to return first is used
    for the entire checkout; there's no per-order assignment of a
    specific company yet, so "more than one active" isn't a state this
    function can meaningfully split across correctly today.

    Called from both /payments/initialize (payments.py) and buy_now/
    checkout (orders.py, the legacy no-payment path) so the two checkout
    paths can't quietly disagree about what shipping costs for the same
    cart.
    """
    company = db.query(DeliveryCompany).filter(DeliveryCompany.is_active.is_(True)).first()
    flat_fee = company.shipping_flat_fee if company is not None else DEFAULT_SHIPPING_FLAT_FEE
    threshold = company.free_shipping_threshold if company is not None else None

    total = Decimal("0")
    for subtotal in merchant_subtotals.values():
        if threshold is not None and subtotal >= threshold:
            continue
        total += flat_fee
    return total
