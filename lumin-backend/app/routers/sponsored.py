"""Sponsored twins: a seller promotes a product on the scan result screen (see app/sponsored.py).

GET  /sponsored-twins/for-cart?ids=a,b  "Recommended add-on" in the cart
GET  /sponsored-twins/for-product/{id}  add-ons for a product detail screen ("buy this too")
GET  /sponsored-twins/for-video/{id}    up to 4 to show for that video (a list, maybe empty), each a different complementary kind, rotating; counts the showing
POST /sponsored-twins/{id}/reveal       the shopper opened the collapsed row to see the product
POST /sponsored-twins/{id}/click        tapped / added to cart / bought (body: post_id + action, optional): counts for the seller and teaches which pairs work
GET  /merchant/sponsored-twins          my promoted products with their numbers
PUT  /merchant/sponsored-twins/{product_id}   switch a product's promotion on or off, with its style / colour / audience tags
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, field_validator
from sqlalchemy import update
from sqlalchemy.orm import Session, joinedload

from app import sponsored
from app.auth import get_current_active_user
from app.database import get_db
from app.models import Product, SponsoredTwin, User, VideoPost
from app.rate_limit import limiter
from app.routers.video_posts import _VIDEO_POST_LOAD_OPTIONS
from app.schemas.catalog import ProductRead

router = APIRouter(tags=["sponsored-twins"])


class SponsoredTwinRead(BaseModel):
    id: uuid.UUID
    product: ProductRead
    kind: str | None = None  # bottom, footwear, outerwear...: shown as a label on the card
    lead: bool = True  # the first of its kind; the others are alternatives of the same kind
    added_with: int = 0  # real count: times shoppers added it to the cart / bought it from this product's screen (product add-ons only)


class SponsoredStatsRead(BaseModel):
    product_id: uuid.UUID
    active: bool
    impressions: int
    reveals: int
    clicks: int
    style: str | None = None
    color: str | None = None
    audience: str | None = None
    # Pay per sale: orders that came through this card (cancelled and refunded ones left out), their value, and the
    # platform's share of them at `percent`.
    sales: int = 0
    sales_total: float = 0
    fee_total: float = 0
    percent: float = 0


class SponsoredSwitch(BaseModel):
    active: bool
    style: str | None = None
    color: str | None = None
    audience: str | None = None

    @field_validator("style", "color", "audience")
    @classmethod
    def _known(cls, v, info):
        allowed = {"style": sponsored.STYLES, "color": sponsored.COLORS, "audience": sponsored.AUDIENCES}[info.field_name]
        if v in (None, ""):
            return None
        if v not in allowed:
            raise ValueError(f"{info.field_name} must be one of: {', '.join(allowed)}")
        return v


class SponsoredClick(BaseModel):
    post_id: uuid.UUID | None = None
    product_id: uuid.UUID | None = None  # the product detail screen it was shown on (when there is no video)
    product_ids: list[uuid.UUID] | None = None  # the cart's products (when it was shown in the cart)
    action: str = "tap"  # tap | cart | buy


@router.get("/sponsored-twins/for-video/{video_post_id}", response_model=list[SponsoredTwinRead])
@limiter.limit("60/minute")
def sponsored_for_video(request: Request, video_post_id: uuid.UUID, db: Session = Depends(get_db)):
    post = (
        db.query(VideoPost).options(*_VIDEO_POST_LOAD_OPTIONS).filter(VideoPost.id == video_post_id).first()
    )
    if post is None or post.moderation_hold:
        return []
    rows = sponsored.pick_for_post(db, post)
    return [SponsoredTwinRead(id=r.id, product=ProductRead.model_validate(r.product), kind=getattr(r, "_kind", None), lead=getattr(r, "_lead", True)) for r in rows]


@router.get("/sponsored-twins/for-product/{product_id}", response_model=list[SponsoredTwinRead])
@limiter.limit("60/minute")
def sponsored_for_product(request: Request, product_id: uuid.UUID, db: Session = Depends(get_db)):
    """Add-ons for a product detail screen ("buy this too"): what goes with the product the shopper opened."""
    product = db.get(Product, product_id)
    if product is None:
        return []
    rows = sponsored.pick_for_product(db, product)
    # Never offer the product as its own add-on. `added_with` is real learned data (never invented): carts + buys for this exact pair.
    kept = [r for r in rows if r.product_id != product_id]
    counts = {pr.sponsored_id: int(pr.carts or 0) + int(pr.buys or 0) for pr in sponsored._pair_rows(db, [r.id for r in kept], [product_id])}
    return [
        SponsoredTwinRead(id=r.id, product=ProductRead.model_validate(r.product), kind=getattr(r, "_kind", None), lead=getattr(r, "_lead", True), added_with=counts.get(r.id, 0))
        for r in kept
    ]


@router.get("/sponsored-twins/for-cart", response_model=list[SponsoredTwinRead])
@limiter.limit("60/minute")
def sponsored_for_cart(request: Request, ids: str = "", db: Session = Depends(get_db)):
    """"Recommended add-on" in the cart: what goes with what is in it (ids = comma-separated product ids, at most 8).
    Never offers something that is already in the cart."""
    wanted: list[uuid.UUID] = []
    for part in ids.split(",")[:8]:
        try:
            wanted.append(uuid.UUID(part.strip()))
        except ValueError:
            continue
    if not wanted:
        return []
    products = db.query(Product).filter(Product.id.in_(wanted)).all()
    rows = sponsored.pick_for_products(db, products)
    have = {p.id for p in products}
    return [
        SponsoredTwinRead(id=r.id, product=ProductRead.model_validate(r.product), kind=getattr(r, "_kind", None), lead=getattr(r, "_lead", True))
        for r in rows
        if r.product_id not in have
    ]


@router.post("/sponsored-twins/{sponsored_id}/reveal", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("60/minute")
def sponsored_reveal(request: Request, sponsored_id: uuid.UUID, db: Session = Depends(get_db)):
    db.execute(update(SponsoredTwin).where(SponsoredTwin.id == sponsored_id).values(reveals=SponsoredTwin.reveals + 1))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/sponsored-twins/{sponsored_id}/click", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("60/minute")
def sponsored_click(request: Request, sponsored_id: uuid.UUID, payload: SponsoredClick | None = None, db: Session = Depends(get_db)):
    db.execute(update(SponsoredTwin).where(SponsoredTwin.id == sponsored_id).values(clicks=SponsoredTwin.clicks + 1))
    if payload is not None and (payload.post_id is not None or payload.product_id is not None or payload.product_ids):
        field = {"cart": "carts", "buy": "buys"}.get(payload.action, "clicks")
        anchors: list = []
        if payload.post_id is not None:
            post = db.query(VideoPost).options(*_VIDEO_POST_LOAD_OPTIONS).filter(VideoPost.id == payload.post_id).first()
            if post is not None:
                anchors = [p.id for p in (post.repost_of or post).products]
        elif payload.product_id is not None:
            anchors = [payload.product_id]
        elif payload.product_ids:
            anchors = list(payload.product_ids)[:8]
        if anchors:
            sponsored.bump_pairs(db, [sponsored_id], anchors, field)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _sales(db, ids):
    """twin id -> (orders, value, fee) for sales through the card that still stand."""
    if not ids:
        return {}
    from sqlalchemy import func

    from app.models import Order, OrderStatus, PayoutStatus

    rows = (
        db.query(Order.sponsored_twin_id, func.count(Order.id), func.coalesce(func.sum(Order.price), 0), func.coalesce(func.sum(Order.sponsored_fee), 0))
        .filter(Order.sponsored_twin_id.in_(ids), Order.status != OrderStatus.cancelled, Order.payout_status != PayoutStatus.refunded)
        .group_by(Order.sponsored_twin_id)
        .all()
    )
    return {r[0]: (int(r[1]), float(r[2]), float(r[3])) for r in rows}


def _stats(r, sales=None) -> SponsoredStatsRead:
    n, total, fee = (sales or {}).get(r.id, (0, 0.0, 0.0))
    return SponsoredStatsRead(sales=n, sales_total=total, fee_total=fee, percent=float(sponsored.sale_percent()),
        product_id=r.product_id, active=r.active, impressions=r.impressions, reveals=r.reveals, clicks=r.clicks,
        style=r.style, color=r.color, audience=r.audience,
    )


def _merchant(user: User):
    if user.merchant_account is None:
        raise HTTPException(status_code=404, detail="No merchant account for this user")
    return user.merchant_account


@router.get("/merchant/sponsored-twins", response_model=list[SponsoredStatsRead])
def my_sponsored(current_user: User = Depends(get_current_active_user), db: Session = Depends(get_db)):
    merchant = _merchant(current_user)
    rows = (
        db.query(SponsoredTwin)
        .join(Product, Product.id == SponsoredTwin.product_id)
        .filter(Product.merchant_id == merchant.id)
        .all()
    )
    sales = _sales(db, [r.id for r in rows])
    return [_stats(r, sales) for r in rows]


@router.put("/merchant/sponsored-twins/{product_id}", response_model=SponsoredStatsRead)
def switch_sponsored(
    product_id: uuid.UUID,
    payload: SponsoredSwitch,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    merchant = _merchant(current_user)
    product = db.get(Product, product_id)
    if product is None or product.merchant_id != merchant.id:
        raise HTTPException(status_code=404, detail="Product not found")
    row = db.query(SponsoredTwin).filter(SponsoredTwin.product_id == product_id).first()
    if row is None:
        row = SponsoredTwin(product_id=product_id, active=payload.active, style=payload.style, color=payload.color, audience=payload.audience)
        db.add(row)
    else:
        row.active = payload.active
        row.style, row.color, row.audience = payload.style, payload.color, payload.audience
    if payload.active:
        from app import product_ai

        product_ai.queue_missing(db, [product])  # read the product once with AI (needs ANTHROPIC_API_KEY); else the keyword rules
    db.commit()
    db.refresh(row)
    return _stats(row, _sales(db, [row.id]))
