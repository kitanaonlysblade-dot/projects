import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.attribution import resolve_source_post
from app.auth import get_current_active_user
from app.database import get_db
from app.escrow import release_to_merchant, sweep_auto_releases
from app.inventory import release_stock, reserve_stock
from app.models import CartItem, Order, OrderStatus, PaymentStatus, PayoutStatus, Product, ReturnClaim, ReturnClaimStatus, User
from app.paystack import refund_transaction
from app.return_policy import validate_return_claim
from app.schemas import (
    CheckoutCreate,
    OrderCancelRequest,
    OrderCreate,
    OrderRead,
    OrderStatusUpdate,
    ReturnClaimCreate,
    ReturnClaimRead,
    ReturnClaimSellerResponse,
)
from app.shipping import resolve_shipping_address

router = APIRouter(prefix="/orders", tags=["orders"])


def _snapshot_order(
    db: Session,
    buyer: User,
    product: Product,
    color: str | None,
    size: str | None,
    shipping_address: dict,
    source_video_post_id: uuid.UUID | None = None,
) -> Order:
    """Every Order field below is a snapshot of the buyer/product/address
    at this exact moment — see the comment on the Order model for why
    (renames, deletions, address changes, and display-name changes
    shouldn't rewrite order history)."""
    order = Order(
        buyer_id=buyer.id,
        product_id=product.id,
        product_name=product.name,
        price=product.price,
        color=color,
        size=size,
        buyer_name=buyer.display_name,
        source_video_post_id=source_video_post_id,
    )
    order.set_shipping_address(shipping_address)
    db.add(order)
    return order


@router.post("", response_model=OrderRead, status_code=status.HTTP_201_CREATED)
def buy_now(
    payload: OrderCreate,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Maps to handleBuyNow / handleBuyNowFromShopFeed — an immediate
    order that never touches the cart, same as the frontend's "Buy now"
    button on a product card. This is the legacy no-payment path (the
    frontend now goes through /payments/initialize + /payments/verify
    instead) but it's still a live, callable route, so it gets the same
    stock enforcement — and now the same shipping-address requirement —
    as everywhere else that creates an Order.
    """
    shipping_address = resolve_shipping_address(db, current_user, payload.shipping_address)
    product = reserve_stock(db, payload.product_id, 1)

    source_post = resolve_source_post(db, payload.source_video_post_id, product.id)
    order = _snapshot_order(
        db,
        current_user,
        product,
        payload.color,
        payload.size,
        shipping_address,
        source_post.id if source_post is not None else None,
    )
    db.commit()
    db.refresh(order)
    return order


@router.post("/checkout", response_model=list[OrderRead], status_code=status.HTTP_201_CREATED)
def checkout(
    payload: CheckoutCreate = CheckoutCreate(),
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Maps to handleCheckout. One Order per unit of quantity — a cart
    line with quantity 3 becomes 3 separate orders, matching the
    frontend's Array.from({length: item.quantity}) expansion — then the
    cart is cleared. All lines in one checkout ship to the same address,
    same as a real cart checkout normally works.
    """
    shipping_address = resolve_shipping_address(db, current_user, payload.shipping_address)
    cart_items = db.query(CartItem).filter(CartItem.user_id == current_user.id).all()
    if not cart_items:
        raise HTTPException(status_code=400, detail="Cart is empty")

    new_orders: list[Order] = []
    for item in cart_items:
        product = reserve_stock(db, item.product_id, item.quantity)
        for _ in range(item.quantity):
            new_orders.append(
                _snapshot_order(
                    db, current_user, product, item.color, item.size, shipping_address, item.source_video_post_id
                )
            )
        db.delete(item)

    db.commit()
    for order in new_orders:
        db.refresh(order)
    return new_orders


@router.get("/me", response_model=list[OrderRead])
def list_my_orders(current_user: User = Depends(get_current_active_user), db: Session = Depends(get_db)):
    """Orders the current user placed as a buyer."""
    orders = (
        db.query(Order)
        .filter(Order.buyer_id == current_user.id)
        .order_by(Order.created_at.desc())
        .all()
    )
    # Opportunistic, not scheduled — see sweep_auto_releases' own
    # comment for why "whenever someone happens to check their orders"
    # is what this app can actually do right now.
    sweep_auto_releases(db, orders)
    return orders


@router.get("/selling", response_model=list[OrderRead])
def list_orders_to_fulfill(current_user: User = Depends(get_current_active_user), db: Session = Depends(get_db)):
    """Powers the merchant dashboard's Orders tab (MerchantOrders.tsx) —
    every order placed against one of the current user's products,
    regardless of who bought it."""
    if current_user.merchant_account is None:
        raise HTTPException(status_code=404, detail="No merchant account for this user")
    orders = (
        db.query(Order)
        .join(Product, Order.product_id == Product.id)
        .filter(Product.merchant_id == current_user.merchant_account.id)
        .order_by(Order.created_at.desc())
        .all()
    )
    sweep_auto_releases(db, orders)
    return orders


@router.patch("/{order_id}/status", response_model=OrderRead)
def advance_order_status(
    order_id: uuid.UUID,
    payload: OrderStatusUpdate,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Maps to handleAdvanceOrderStatus — merchant-only, and only for
    orders against that merchant's own products. Doesn't enforce the
    frontend's pending → shipped → delivered forward-only ordering (that
    lives in MerchantOrders' UI, which only ever offers the next status
    as a button) — worth adding here too if this ever gets a second
    client that isn't as well-behaved.
    """
    order = db.get(Order, order_id)
    merchant = current_user.merchant_account
    if (
        order is None
        or merchant is None
        or order.product is None
        or order.product.merchant_id != merchant.id
    ):
        raise HTTPException(status_code=404, detail="Order not found")

    order.status = payload.status
    if payload.status == OrderStatus.delivered and order.delivered_at is None:
        # Starts the 24-hour claim window (app/return_policy.py's
        # CLAIM_WINDOW) ticking from exactly this moment, not from
        # updated_at — see delivered_at's own comment on the Order
        # model for why those two need to stay separate.
        order.delivered_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(order)
    return order


@router.post("/{order_id}/cancel", response_model=OrderRead)
def cancel_order(
    order_id: uuid.UUID,
    payload: OrderCancelRequest = OrderCancelRequest(),
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Either the buyer or the selling merchant can cancel — a buyer
    changing their mind and a merchant who can't fulfill something are
    both real, common reasons this needs to happen, and there's no
    reason to make them two separate endpoints that do the same work.
    Only allowed before delivery: once something has actually arrived,
    "I don't want this" is a return, which this app doesn't model, not
    a cancellation.

    Refunds through Paystack whenever the order was genuinely paid for
    (payment_id set, and that payment succeeded) — legacy orders from
    before payments existed, or ones this same route already cancelled,
    have nothing to refund and just get skipped straight to the status
    change. The refund is partial, for exactly this order's own
    product price, not the whole Payment: one Payment can fund several
    Order rows (a cart checkout), and cancelling one shouldn't refund
    the others' share along with it. It does NOT prorate shipping_fee
    or discount_amount back for a single cancelled line out of a
    multi-item order — a known simplification, not an oversight: doing
    that fairly needs real per-line cost accounting this app doesn't
    have yet.
    """
    order = db.get(Order, order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found")

    is_buyer = order.buyer_id == current_user.id
    is_selling_merchant = (
        current_user.merchant_account is not None
        and order.product is not None
        and order.product.merchant_id == current_user.merchant_account.id
    )
    if not is_buyer and not is_selling_merchant:
        # Same 404-not-403 pattern as every other ownership check in this
        # app — doesn't confirm this order id exists at all to someone
        # who has no business with it.
        raise HTTPException(status_code=404, detail="Order not found")

    if order.status == OrderStatus.cancelled:
        raise HTTPException(status_code=400, detail="This order is already cancelled")
    if order.status == OrderStatus.delivered:
        raise HTTPException(status_code=400, detail="Delivered orders can't be cancelled")

    if order.payment is not None and order.payment.status == PaymentStatus.success:
        refund_transaction(order.payment.reference, amount_subunit=int(order.price * 100))

    # Only an order that hadn't shipped yet gets its stock back — once
    # it's shipped, the physical item already left, so there's nothing
    # to actually put back regardless of what happens to it from here.
    if order.status == OrderStatus.pending and order.product_id is not None:
        release_stock(db, order.product_id, 1)

    order.status = OrderStatus.cancelled
    order.cancel_reason = payload.reason
    # Keeps payout_status truthful for a cancelled order regardless of
    # whether a real Paystack refund just happened above — a legacy
    # no-payment order has no money to hold in the first place, but
    # "the merchant will never receive this" is equally true either way,
    # and this is also what stops sweep_auto_releases from ever having
    # anything to do here (though its own status == delivered check
    # already makes that impossible on its own, since cancelled and
    # delivered can't both be true for the same order).
    order.payout_status = PayoutStatus.refunded

    # A Payment funding several orders only reaches "refunded" once the
    # LAST of them is cancelled — see this route's own comment above on
    # why cancelling one line shouldn't relabel a payment still
    # legitimately funding others still on their way.
    if order.payment is not None and all(o.status == OrderStatus.cancelled for o in order.payment.orders):
        order.payment.status = PaymentStatus.refunded

    db.commit()
    db.refresh(order)
    return order


@router.post("/{order_id}/confirm-receipt", response_model=OrderRead)
def confirm_receipt(
    order_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """The buyer's explicit "yes, this is what I ordered — pay the
    merchant" tap. Releases this order's held funds right away instead
    of waiting out the rest of the 24-hour claim window (see
    CLAIM_WINDOW in app/return_policy.py, and sweep_auto_releases in
    app/escrow.py for what happens if a buyer never taps this at all).
    Buyer-only — a merchant can't release their own funds by calling
    this themselves.
    """
    order = db.get(Order, order_id)
    if order is None or order.buyer_id != current_user.id:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.status != OrderStatus.delivered:
        raise HTTPException(status_code=400, detail="This order hasn't been delivered yet")

    release_to_merchant(db, order)
    db.refresh(order)
    return order


@router.post("/{order_id}/report-defect", response_model=OrderRead)
def report_defect(
    order_id: uuid.UUID,
    payload: ReturnClaimCreate,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """The buyer's "this arrived defective / not as described" path.
    validate_return_claim (app/return_policy.py) is the filter deciding
    whether a claim is even allowed to be FILED — delivered status,
    still inside the 24-hour window, a video present — and this route
    doesn't duplicate any of that logic itself, only calls into it.

    Filing no longer refunds in the same request — the claim is created
    `pending_review` (ReturnClaim's own default) and sits there until an
    admin resolves it via routers/admin.py, which is the only place
    refund_for_defect (app/escrow.py) gets called from now. The order's
    payout_status is left exactly as it was (still `held`) — see
    sweep_auto_releases in app/escrow.py, which now checks for an open
    claim before releasing funds, so this doesn't race a merchant
    getting paid out while a claim against the same order is still
    sitting unreviewed.
    """
    order = db.get(Order, order_id)
    if order is None or order.buyer_id != current_user.id:
        raise HTTPException(status_code=404, detail="Order not found")

    validate_return_claim(order, payload.video_url)

    if db.query(ReturnClaim).filter(ReturnClaim.order_id == order.id).first() is not None:
        raise HTTPException(status_code=400, detail="A claim has already been filed for this order")

    claim = ReturnClaim(
        order_id=order.id,
        buyer_id=current_user.id,
        video_url=payload.video_url,
        reason=payload.reason,
    )
    db.add(claim)
    db.commit()
    db.refresh(order)
    return order


@router.get("/{order_id}/return-claim", response_model=ReturnClaimRead)
def get_return_claim(
    order_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Either party can check a claim's status — the buyer who filed it,
    or the selling merchant it was filed against. Needed now in a way it
    wasn't before: report_defect used to refund in the same request, so
    there was nothing to check back on later. Now there is, and this is
    that check.
    """
    order = db.get(Order, order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found")

    is_buyer = order.buyer_id == current_user.id
    is_selling_merchant = (
        current_user.merchant_account is not None
        and order.product is not None
        and order.product.merchant_id == current_user.merchant_account.id
    )
    if not is_buyer and not is_selling_merchant:
        raise HTTPException(status_code=404, detail="Order not found")

    claim = db.query(ReturnClaim).filter(ReturnClaim.order_id == order.id).first()
    if claim is None:
        raise HTTPException(status_code=404, detail="No claim has been filed for this order")
    return claim


@router.post("/{order_id}/return-claim/respond", response_model=ReturnClaimRead)
def respond_to_return_claim(
    order_id: uuid.UUID,
    payload: ReturnClaimSellerResponse,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """The selling merchant's one-shot rebuttal to a claim filed against
    one of their orders — see ReturnClaim's own comment on why this is
    deliberately a single message, not a back-and-forth thread. Only
    while the claim is still pending_review: once an admin has already
    resolved it (routers/admin.py), a rebuttal arriving after the fact
    wouldn't change anything and would be confusing to show alongside a
    decision that's already been made.
    """
    order = db.get(Order, order_id)
    if (
        order is None
        or current_user.merchant_account is None
        or order.product is None
        or order.product.merchant_id != current_user.merchant_account.id
    ):
        raise HTTPException(status_code=404, detail="Order not found")

    claim = db.query(ReturnClaim).filter(ReturnClaim.order_id == order.id).first()
    if claim is None:
        raise HTTPException(status_code=404, detail="No claim has been filed for this order")
    if claim.status != ReturnClaimStatus.pending_review:
        raise HTTPException(status_code=400, detail="This claim has already been resolved")

    claim.seller_response = payload.message
    db.commit()
    db.refresh(claim)
    return claim
