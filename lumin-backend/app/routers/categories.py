import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Category
from app.schemas import CategoryBannerRead, CategoryRead, DealRead

router = APIRouter(prefix="/categories", tags=["categories"])


@router.get("", response_model=list[CategoryRead])
def list_categories(db: Session = Depends(get_db)):
    """Powers the CategoryDrawer / CategorySheet list."""
    return db.query(Category).order_by(Category.name).all()


@router.get("/{category_id}/banners", response_model=list[CategoryBannerRead])
def list_category_banners(category_id: uuid.UUID, db: Session = Depends(get_db)):
    """Powers CategoryLanding.tsx — the promo banners inside one category."""
    category = db.get(Category, category_id)
    if category is None:
        raise HTTPException(status_code=404, detail="Category not found")
    return category.banners


@router.get("/{category_id}/deals", response_model=list[DealRead])
def list_category_deals(category_id: uuid.UUID, db: Session = Depends(get_db)):
    category = db.get(Category, category_id)
    if category is None:
        raise HTTPException(status_code=404, detail="Category not found")
    return category.deals
