"""Warning signs for the people reviewing disputes and sealed orders. They never block or punish anyone by themselves: they are
shown to an admin, who decides. Thresholds can be tuned with the env vars below."""
import os
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import MerchantAccount, Order, Product, ReturnClaim, ReturnClaimStatus, Shipment
from app.models.seal import SHIP_REFUSED

MIN_ORDERS = int(os.environ.get("RISK_MIN_ORDERS", "3"))  # a rate on fewer orders than this means nothing
DISPUTE_RATE = float(os.environ.get("RISK_DISPUTE_RATE", "0.3"))
REPEAT_PAIR_ORDERS = int(os.environ.get("RISK_REPEAT_PAIR_ORDERS", "3"))  # same buyer, same seller, in 30 days
BUYER_CLAIMS = int(os.environ.get("RISK_BUYER_CLAIMS", "3"))
REFUSALS = int(os.environ.get("RISK_REFUSALS", "2"))


def seller_flags(orders: int, claims: int, refunded_claims: int, refusals: int) -> "list[str]":
    """Pure: what to warn about for one seller, from their counts."""
    out: list[str] = []
    if orders >= MIN_ORDERS and claims / orders >= DISPUTE_RATE:
        out.append(f"{claims} of {orders} delivered orders were disputed ({round(100 * claims / orders)}%)")
    if refunded_claims >= 2:
        out.append(f"{refunded_claims} disputes went against this seller")
    if refusals >= REFUSALS:
        out.append(f"{refusals} deliveries were refused because the bag looked opened")
    return out


def _seller_counts(db: Session) -> "dict[uuid.UUID, dict]":
    """seller user id -> counts, from delivered orders, claims and refusals."""
    out: dict[uuid.UUID, dict] = {}

    def row(uid):
        return out.setdefault(uid, dict(orders=0, claims=0, refunded=0, refusals=0))

    base = db.query(MerchantAccount.user_id, func.count(Order.id)).join(Product, Product.merchant_id == MerchantAccount.id).join(Order, Order.product_id == Product.id)
    for uid, n in base.filter(Order.status == "delivered").group_by(MerchantAccount.user_id):
        row(uid)["orders"] = n
    cl = base.join(ReturnClaim, ReturnClaim.order_id == Order.id)
    for uid, n in cl.group_by(MerchantAccount.user_id):
        row(uid)["claims"] = n
    for uid, n in cl.filter(ReturnClaim.status == ReturnClaimStatus.refunded).group_by(MerchantAccount.user_id):
        row(uid)["refunded"] = n
    rf = base.join(Shipment, Shipment.order_id == Order.id).filter(Shipment.status == SHIP_REFUSED)
    for uid, n in rf.group_by(MerchantAccount.user_id):
        row(uid)["refusals"] = n
    return out


def risky_sellers(db: Session) -> "list[dict]":
    res = []
    for uid, c in _seller_counts(db).items():
        flags = seller_flags(c["orders"], c["claims"], c["refunded"], c["refusals"])
        if flags:
            res.append(dict(user_id=uid, flags=flags, **c))
    return sorted(res, key=lambda r: len(r["flags"]), reverse=True)


def repeat_pairs(db: Session) -> "list[dict]":
    """The same buyer buying from the same seller again and again within 30 days (a common sign of fake orders)."""
    since = datetime.now(timezone.utc) - timedelta(days=30)
    rows = (
        db.query(Order.buyer_id, MerchantAccount.user_id, func.count(Order.id))
        .join(Product, Product.id == Order.product_id)
        .join(MerchantAccount, MerchantAccount.id == Product.merchant_id)
        .filter(Order.created_at >= since, Order.buyer_id.isnot(None), Product.seal_pack_size.is_(None))
        .group_by(Order.buyer_id, MerchantAccount.user_id)
        .having(func.count(Order.id) >= REPEAT_PAIR_ORDERS)
        .all()
    )
    return [dict(buyer_id=b, seller_id=s, orders=n, flags=[f"Bought {n} times from the same seller in 30 days"]) for b, s, n in rows if b != s]


def repeat_claimants(db: Session) -> "list[dict]":
    rows = (
        db.query(ReturnClaim.buyer_id, func.count(ReturnClaim.id))
        .filter(ReturnClaim.buyer_id.isnot(None))
        .group_by(ReturnClaim.buyer_id)
        .having(func.count(ReturnClaim.id) >= BUYER_CLAIMS)
        .all()
    )
    return [dict(buyer_id=b, claims=n, flags=[f"Filed {n} dispute claims"]) for b, n in rows]


def flags_for_claim(db: Session, order: Order) -> "list[str]":
    """The warnings that apply to one dispute: its seller, and the buyer/seller pair."""
    out: list[str] = []
    if order.product is None or order.product.merchant is None:
        return out
    seller = order.product.merchant.user_id
    c = _seller_counts(db).get(seller)
    if c:
        out += ["Seller: " + f for f in seller_flags(c["orders"], c["claims"], c["refunded"], c["refusals"])]
    for p in repeat_pairs(db):
        if p["seller_id"] == seller and p["buyer_id"] == order.buyer_id:
            out += ["Buyer and seller: " + f for f in p["flags"]]
    for b in repeat_claimants(db):
        if b["buyer_id"] == order.buyer_id:
            out += ["Buyer: " + f for f in b["flags"]]
    return out
