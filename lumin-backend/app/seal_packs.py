"""Selling the tamper-proof bags in the shop like any other product.

Lumin's own shop account lists "pack of N bags" products (Product.seal_pack_size = N, set in Admin > Sealed bags). A buyer
(a seller) orders one like anything else; as the order is created, N unused, unowned bags from the printed stock are reserved
to the buyer (SealBag.seller_id = the buyer, SealBag.pack_order_id = the order). The shop packs those exact serials and ships
them. Because the bags are owned by the buyer from that moment, a bag stolen in the post is useless to a thief: only the owner
can seal with it. If the stock has run out the order simply waits: print another batch, then Assign (Admin) or open the shop's
order list, and it is filled.
"""
import logging
import uuid

from sqlalchemy.orm import Session

from app.models import Order, Product, SealBag, SealEvent
from app.models.seal import BAG_UNUSED

log = logging.getLogger(__name__)


def pack_size_of(db: Session, order: Order) -> int:
    if order.product_id is None:
        return 0
    product = db.get(Product, order.product_id)
    return int(product.seal_pack_size or 0) if product is not None else 0


def serials_for_order(db: Session, order_id: uuid.UUID) -> "list[str]":
    rows = db.query(SealBag.serial).filter(SealBag.pack_order_id == order_id).order_by(SealBag.serial).all()
    return [r[0] for r in rows]


def assign_for_order(db: Session, order: Order) -> bool:
    """Give a bag-pack order its bags. All or nothing. -> True when the order has all its bags afterwards (also for orders that
    aren't packs: nothing to do). Safe to call again."""
    size = pack_size_of(db, order)
    if size <= 0 or order.buyer_id is None:
        return True
    have = db.query(SealBag).filter(SealBag.pack_order_id == order.id).count()
    need = size - have
    if need <= 0:
        return True
    free = (
        db.query(SealBag)
        .filter(SealBag.status == BAG_UNUSED, SealBag.seller_id.is_(None), SealBag.pack_order_id.is_(None))
        .order_by(SealBag.serial)
        .with_for_update(skip_locked=True)
        .limit(need)
        .all()
    )
    if len(free) < need:
        db.rollback()
        log.warning("not enough printed bags for order %s (need %s)", order.id, need)
        return False
    for bag in free:
        bag.seller_id = order.buyer_id
        bag.pack_order_id = order.id
        db.add(SealEvent(bag_id=bag.id, from_status=BAG_UNUSED, to_status=BAG_UNUSED, note=f"sold to the buyer of order {order.id}"))
    db.commit()
    return True


def assign_pending(db: Session, orders: "list[Order]") -> None:
    """Fill every bag-pack order in the list that has no bags yet (best-effort: never raises)."""
    for o in orders:
        try:
            if o.status.value != "cancelled":
                assign_for_order(db, o)
        except Exception:
            db.rollback()
            log.exception("could not assign bags for order %s", o.id)


def release_for_order(db: Session, order: Order) -> int:
    """A cancelled/refunded pack order gives its unused bags back to the stock. Bags already used stay with their history."""
    n = (
        db.query(SealBag)
        .filter(SealBag.pack_order_id == order.id, SealBag.status == BAG_UNUSED)
        .update({SealBag.seller_id: None, SealBag.pack_order_id: None}, synchronize_session=False)
    )
    db.commit()
    return n


def annotate(db: Session, orders: "list[Order]") -> None:
    """Sets is_seal_pack and seal_serials on each order (plain attributes the OrderRead schema picks up)."""
    for o in orders:
        size = pack_size_of(db, o)
        o.is_seal_pack = size > 0
        o.seal_serials = serials_for_order(db, o.id) if size > 0 else []
