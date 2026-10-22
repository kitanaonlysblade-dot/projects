from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Deal
from app.schemas import DealRead

router = APIRouter(prefix="/deals", tags=["deals"])


@router.get("", response_model=list[DealRead])
def list_deals(db: Session = Depends(get_db)):
    """All deals, storewide and per-category alike — DealBanner.tsx.
    Use /categories/{id}/deals instead to scope to just one category."""
    return db.query(Deal).all()
