from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import CategoryBanner
from app.schemas import CategoryBannerRead

router = APIRouter(prefix="/banners", tags=["banners"])


@router.get("", response_model=list[CategoryBannerRead])
def list_banners(db: Session = Depends(get_db)):
    """Every banner across every category, mirroring how /deals returns
    storewide and per-category deals alike.

    The client builds its category pages from banners + products together,
    and /categories/{id}/banners can only answer for one category at a
    time — so without this it would have to fan out one request per
    category just to render a sidebar. Scope to a single category with
    that route instead when that's genuinely all you need.
    """
    return db.query(CategoryBanner).all()
