import uuid

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.attribution import resolve_source_post
from app.auth import get_current_active_user
from app.database import get_db
from app.models import CartItem, Product, User
from app.schemas import CartItemCreate, CartItemRead, CartItemUpdate

router = APIRouter(prefix="/cart", tags=["cart"])

# Product.cart_count is NOT bumped anywhere in this file. The frontend's
# equivalent (`productActivity` in page.tsx) is explicitly a session-only,
# shop-feed-only heuristic — its own comment says it deliberately ignores
# the real cart_count seed value and only reflects actions taken through
# one specific UI path. A real "X people have this in their cart" number
# is better computed live (`select count(distinct user_id) from
# cart_items where product_id = ...`) than reconstructed by mirroring
# that mock's add/remove/quantity-change bookkeeping exactly.


@router.get("", response_model=list[CartItemRead])
def list_cart_items(current_user: User = Depends(get_current_active_user), db: Session = Depends(get_db)):
    return db.query(CartItem).filter(CartItem.user_id == current_user.id).all()


@router.post("", response_model=CartItemRead, status_code=status.HTTP_201_CREATED)
def add_to_cart(
    payload: CartItemCreate,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Maps to handleAddToCart in page.tsx. Re-adding the same
    product+color+size combination increments the existing row's
    quantity instead of creating a duplicate line — same as the
    frontend's `existing` lookup before deciding whether to push a new
    cart line."""
    product = db.get(Product, payload.product_id)
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")

    source_post = resolve_source_post(db, payload.source_video_post_id, payload.product_id)
    if source_post is not None:
        source_post.cart_adds_count += 1

    existing = (
        db.query(CartItem)
        .filter(
            CartItem.user_id == current_user.id,
            CartItem.product_id == payload.product_id,
            CartItem.color == payload.color,
            CartItem.size == payload.size,
        )
        .first()
    )
    if existing is not None:
        existing.quantity += payload.quantity
        if existing.source_video_post_id is None and source_post is not None:
            existing.source_video_post_id = source_post.id
        db.commit()
        db.refresh(existing)
        return existing

    item = CartItem(
        user_id=current_user.id,
        **payload.model_dump(exclude={"source_video_post_id"}),
        source_video_post_id=source_post.id if source_post is not None else None,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.patch("/{item_id}", response_model=CartItemRead)
def update_cart_item_quantity(
    item_id: uuid.UUID,
    payload: CartItemUpdate,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Maps to handleUpdateCartQuantity. The frontend removes the line
    entirely when quantity drops to 0 or below — same behavior here
    (returning a 204 in that case, since there's no updated row left to
    describe), rather than leaving a zero-quantity row around."""
    item = db.get(CartItem, item_id)
    if item is None or item.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Cart item not found")

    if payload.quantity <= 0:
        db.delete(item)
        db.commit()
        # Returning a Response directly bypasses response_model — exactly
        # what's needed here, since there's no CartItemRead left to
        # serialize once the row is gone.
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    item.quantity = payload.quantity
    db.commit()
    db.refresh(item)
    return item


@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_from_cart(
    item_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    item = db.get(CartItem, item_id)
    if item is None or item.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Cart item not found")
    db.delete(item)
    db.commit()
