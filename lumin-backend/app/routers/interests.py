from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Interest
from app.schemas import InterestRead

router = APIRouter(prefix="/interests", tags=["interests"])


@router.get("", response_model=list[InterestRead])
def list_interests(db: Session = Depends(get_db)):
    """Powers the topic chips in DiscoverOnboarding.tsx."""
    return db.query(Interest).all()
