import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.models import Product
from app.schemas import ProductRead

router = APIRouter(prefix="/products", tags=["products"])


@router.get("", response_model=list[ProductRead])
def list_products(
    banner_id: uuid.UUID | None = Query(default=None),
    is_new: bool | None = Query(default=None, description="Filter to New Arrivals only"),
    db: Session = Depends(get_db),
):
    query = db.query(Product).options(joinedload(Product.images))
    if banner_id is not None:
        query = query.filter(Product.banner_id == banner_id)
    if is_new is not None:
        query = query.filter(Product.is_new == is_new)
    return query.all()


@router.get("/{product_id}", response_model=ProductRead)
def get_product(product_id: uuid.UUID, db: Session = Depends(get_db)):
    product = (
        db.query(Product)
        .options(joinedload(Product.images))
        .filter(Product.id == product_id)
        .first()
    )
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")
    return product
