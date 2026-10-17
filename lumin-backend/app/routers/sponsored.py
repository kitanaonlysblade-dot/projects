"""Sponsored twins: a seller promotes a product on the scan result screen (see app/sponsored.py).

GET  /sponsored-twins/for-video/{id}    the one to show under that video's scan result (or null); counts the showing
POST /sponsored-twins/{id}/reveal       the shopper opened the collapsed row to see the product
POST /sponsored-twins/{id}/click        ...and then tapped through to the product
GET  /merchant/sponsored-twins          my promoted products with their numbers
PUT  /merchant/sponsored-twins/{product_id}   switch a product's promotion on or off
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel
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


class SponsoredStatsRead(BaseModel):
    product_id: uuid.UUID
    active: bool
    impressions: int
    reveals: int
    clicks: int


class SponsoredSwitch(BaseModel):
    active: bool


@router.get("/sponsored-twins/for-video/{video_post_id}", response_model=SponsoredTwinRead | None)
@limiter.limit("60/minute")
def sponsored_for_video(request: Request, video_post_id: uuid.UUID, db: Session = Depends(get_db)):
    post = (
        db.query(VideoPost).options(*_VIDEO_POST_LOAD_OPTIONS).filter(VideoPost.id == video_post_id).first()
    )
    if post is None or post.moderation_hold:
        return None
    row = sponsored.pick_for_post(db, post)
    return None if row is None else SponsoredTwinRead(id=row.id, product=ProductRead.model_validate(row.product))


@router.post("/sponsored-twins/{sponsored_id}/reveal", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("60/minute")
def sponsored_reveal(request: Request, sponsored_id: uuid.UUID, db: Session = Depends(get_db)):
    db.execute(update(SponsoredTwin).where(SponsoredTwin.id == sponsored_id).values(reveals=SponsoredTwin.reveals + 1))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/sponsored-twins/{sponsored_id}/click", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("60/minute")
def sponsored_click(request: Request, sponsored_id: uuid.UUID, db: Session = Depends(get_db)):
    db.execute(update(SponsoredTwin).where(SponsoredTwin.id == sponsored_id).values(clicks=SponsoredTwin.clicks + 1))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


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
    return [SponsoredStatsRead(product_id=r.product_id, active=r.active, impressions=r.impressions, reveals=r.reveals, clicks=r.clicks) for r in rows]


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
        row = SponsoredTwin(product_id=product_id, active=payload.active)
        db.add(row)
    else:
        row.active = payload.active
    db.commit()
    db.refresh(row)
    return SponsoredStatsRead(product_id=row.product_id, active=row.active, impressions=row.impressions, reveals=row.reveals, clicks=row.clicks)
