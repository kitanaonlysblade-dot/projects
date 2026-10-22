from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app import scan_service, screening
from app.auth import get_current_active_user
from app.database import get_db
from app.models import Report, ReportReason, ReportTargetType, User
from app.schemas import ReportCreate, ReportRead

router = APIRouter(prefix="/reports", tags=["reports"])


@router.post("", response_model=ReportRead, status_code=status.HTTP_201_CREATED)
def file_report(
    payload: ReportCreate,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Any active user can file one against a video post, product, or
    account — reviewed from the admin console (GET/PATCH
    /admin/reports in routers/admin.py), never from the reported
    party's own dashboard; that's the whole point of this existing
    outside merchant.py. Doesn't validate that target_id actually
    exists for target_type — whoever reviews this will see soon enough
    if it doesn't (already deleted, say), and a bad id shouldn't be a
    500 or a confusing 404 for the person filing the report.
    """
    report = Report(
        reporter_id=current_user.id,
        target_type=payload.target_type,
        target_id=payload.target_id,
        reason=payload.reason,
        detail=payload.detail,
    )
    db.add(report)
    db.flush()
    if report.reason == ReportReason.copied and report.target_type == ReportTargetType.video_post:
        scan_service.open_flag_for_report(db, report)  # a review opens only if it is a known copy by someone else
    screening.on_report(db, report)  # enough different reporters hold a video for review
    db.commit()
    db.refresh(report)
    return report
