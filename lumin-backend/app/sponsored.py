"""Which "Sponsored twin" shows under a scan result's products.

Deliberately simple (no bidding yet): a seller switches a product on, and it is shown on scan results of videos
whose products sit in the SAME CATEGORY. Never the video's own products or its sellers' other products (those are
already on screen), never an out-of-stock one. Among the relevant ones the least-shown goes first, so sellers take
turns. One slot, always labelled "Sponsored" in the app.
"""
import uuid
from dataclasses import dataclass
from datetime import datetime


@dataclass
class Candidate:
    id: uuid.UUID
    product_id: uuid.UUID
    merchant_id: uuid.UUID | None
    category_id: uuid.UUID | None
    in_stock: bool
    impressions: int
    created_at: datetime


def rank(candidates: list[Candidate], wanted_categories: set, exclude_products: set, exclude_merchants: set) -> Candidate | None:
    """The one to show, or None. Pure, so it can be tested without a database."""
    if not wanted_categories:
        return None  # nothing to be relevant to: no ad rather than an unrelated one
    ok = [
        c
        for c in candidates
        if c.in_stock
        and c.merchant_id is not None
        and c.category_id in wanted_categories
        and c.product_id not in exclude_products
        and c.merchant_id not in exclude_merchants
    ]
    if not ok:
        return None
    return min(ok, key=lambda c: (c.impressions, c.created_at))


def _category_of(product):
    return product.banner.category_id if product.banner is not None else None


def pick_for_post(db, post):
    """The sponsored twin to show for this video's scan result (and counts the showing), or None."""
    from sqlalchemy import update
    from sqlalchemy.orm import joinedload

    from app.models import Product, SponsoredTwin

    source = post.repost_of or post
    featured = list(source.products)
    wanted = {c for c in (_category_of(p) for p in featured) if c is not None}
    if not wanted:
        return None
    rows = (
        db.query(SponsoredTwin)
        .join(Product, Product.id == SponsoredTwin.product_id)
        .options(joinedload(SponsoredTwin.product).joinedload(Product.banner))
        .filter(SponsoredTwin.active.is_(True), Product.merchant_id.is_not(None))
        .all()
    )
    cands = [
        Candidate(r.id, r.product_id, r.product.merchant_id, _category_of(r.product), r.product.in_stock, r.impressions, r.created_at)
        for r in rows
    ]
    best = rank(cands, wanted, {p.id for p in featured}, {p.merchant_id for p in featured if p.merchant_id})
    if best is None:
        return None
    db.execute(update(SponsoredTwin).where(SponsoredTwin.id == best.id).values(impressions=SponsoredTwin.impressions + 1))
    db.commit()
    return next(r for r in rows if r.id == best.id)
