import uuid

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import Product


def reserve_stock(db: Session, product_id: uuid.UUID, quantity: int) -> Product:
    """Locks the product row and decrements its stock by `quantity`, or
    raises 409 if there isn't enough left. Returns the same, now-locked
    Product so callers can read its current name/price for an order
    snapshot without a second query.

    `SELECT ... FOR UPDATE` (via with_for_update) is what actually makes
    this race-safe, not the read-then-compare that follows it — two
    concurrent purchases for the last unit serialize on this lock rather
    than both reading the same pre-decrement number and both succeeding.
    Call this inside the same transaction as creating the Order row(s)
    it's for, so a failed check never leaves stock decremented with
    nothing to show for it (a rollback undoes the decrement along with
    everything else in that transaction).

    Products with stock_quantity == None are untracked/unlimited — see
    that column's own comment on the model — so this is a no-op for
    them beyond the existence check.
    """
    product = db.query(Product).filter(Product.id == product_id).with_for_update().first()
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")

    if product.stock_quantity is not None:
        if product.stock_quantity < quantity:
            raise HTTPException(
                status_code=409,
                detail=f'Only {product.stock_quantity} left of "{product.name}" — not enough for this order.',
            )
        product.stock_quantity -= quantity

    return product


def release_stock(db: Session, product_id: uuid.UUID, quantity: int) -> None:
    """The reverse of reserve_stock — puts `quantity` back when an order
    that had reserved it gets cancelled before shipping (see cancel_order
    in routers/orders.py). Same row lock, for the same reason: two
    concurrent restocks (or a restock racing a fresh purchase against the
    same row) shouldn't be able to interleave into a wrong final count.

    A no-op for untracked/unlimited products (stock_quantity is None) or
    a product that's since been deleted — same "nothing to enforce or
    give back" reasoning as reserve_stock's own handling of the
    untracked case.
    """
    product = db.query(Product).filter(Product.id == product_id).with_for_update().first()
    if product is None or product.stock_quantity is None:
        return
    product.stock_quantity += quantity
