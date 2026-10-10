from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.auth import get_current_active_user
from app.database import get_db
from app.discounts import preview_discount
from app.models import CartItem, Product, User
from app.rate_limit import limiter
from app.schemas import DiscountPreviewRead, DiscountPreviewRequest

router = APIRouter(prefix="/discounts", tags=["discounts"])


@router.post("/preview", response_model=DiscountPreviewRead)
@limiter.limit("20/minute")
def preview(
    request: Request,
    payload: DiscountPreviewRequest,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Lets CartScreen.tsx/ProductDrawer.tsx show what a code is worth
    the moment someone types it in — no charge, no reservation, nothing
    written except reading whether the code and its caps currently
    allow it (see preview_discount's own comment on why the cap checks
    here are read-only, not authoritative). The authoritative check
    happens twice more after this: again in /payments/initialize
    (which is what actually decides the amount Paystack charges) and
    again, race-safe, in routers/payments.py's _fulfill once that
    charge is confirmed — this endpoint exists purely for instant UI
    feedback before either of those.

    Duplicates the same small subtotal computation
    routers/payments.py's own _cart_subtotal does, rather than
    importing it from there — same "kept as its own copy, not reached
    into another router's internals" reasoning that router's
    _snapshot_order already documents for the same kind of duplication.
    """
    if payload.mode == "buy_now":
        product = db.get(Product, payload.product_id)
        if product is None:
            raise HTTPException(status_code=404, detail="Product not found")
        if payload.quantity < 1:
            raise HTTPException(status_code=400, detail="Quantity must be at least 1")
        subtotal = Decimal(str(product.price)) * payload.quantity
    else:
        cart_items = db.query(CartItem).filter(CartItem.user_id == current_user.id).all()
        if not cart_items:
            raise HTTPException(status_code=400, detail="Cart is empty")
        subtotal = sum(
            (Decimal(str(item.product.price)) * item.quantity for item in cart_items),
            Decimal("0"),
        )

    discount, amount = preview_discount(db, payload.code, subtotal, current_user.id)
    return DiscountPreviewRead(
        code=discount.code,
        kind=discount.kind,
        subtotal=subtotal,
        discount_amount=amount,
        new_subtotal=subtotal - amount,
    )
