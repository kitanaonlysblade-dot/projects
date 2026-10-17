"""Seller verification by manual review.

A seller sends their legal name, a photo of an ID (or business registration) and a selfie; an admin looks at them and
approves or rejects. Approved sellers get a "Verified seller" badge (MerchantAccount.verified_at). The photos go to a
PRIVATE bucket (app/storage.py), are shown to the admin through links that expire in minutes, and are DELETED as soon as
the request is decided. If no private bucket is configured the feature is off (nothing is ever stored publicly).

  GET  /merchant/verification                 my status
  POST /merchant/verification                 submit (multipart: legal_name, doc_type, document, selfie)
  GET  /admin/verifications?status=pending    review queue (admin)
  POST /admin/verifications/{id}/review       approve or reject (admin)
  POST /admin/merchants/{id}/unverify         take the badge away (admin)
"""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app import storage
from app.auth import get_current_active_user, get_current_admin
from app.database import get_db
from app.escrow import payout_requires_verification
from app.models import MerchantAccount, Notification, NotificationType, SellerVerification, User
from app.models.seller_verification import DOC_TYPES, VERIFY_APPROVED, VERIFY_PENDING, VERIFY_REJECTED
from app.rate_limit import limiter

router = APIRouter(prefix="/merchant/verification", tags=["verification"])
admin_router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(get_current_admin)])

MAX_PHOTO_BYTES = 8 * 1024 * 1024


def sniff_image(data: bytes) -> tuple[str, str] | None:
    """(content type, extension) from the file's own first bytes - never trust the declared type - or None."""
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg", ".jpg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png", ".png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp", ".webp"
    return None


class VerificationStatus(BaseModel):
    available: bool  # false when the private bucket is not set up
    verified: bool
    status: str | None = None  # pending | approved | rejected | None (never applied)
    legal_name: str | None = None
    doc_type: str | None = None
    note: str | None = None
    submitted_at: datetime | None = None
    required_for_payout: bool = False


class ReviewRequest(BaseModel):
    approve: bool
    note: str | None = Field(default=None, max_length=300)


class VerificationQueueItem(BaseModel):
    id: uuid.UUID
    merchant_id: uuid.UUID
    business_name: str
    owner_email: str
    legal_name: str
    doc_type: str
    status: str
    created_at: datetime
    # Expire in a few minutes; None once the files have been deleted after review.
    document_url: str | None = None
    selfie_url: str | None = None
    note: str | None = None


def _merchant_of(user: User) -> MerchantAccount:
    if user.merchant_account is None:
        raise HTTPException(status_code=404, detail="No merchant account for this user")
    return user.merchant_account


def _latest(db: Session, merchant: MerchantAccount) -> SellerVerification | None:
    return (
        db.query(SellerVerification)
        .filter(SellerVerification.merchant_id == merchant.id)
        .order_by(SellerVerification.created_at.desc())
        .first()
    )


def _status(db: Session, merchant: MerchantAccount) -> VerificationStatus:
    latest = _latest(db, merchant)
    return VerificationStatus(
        available=storage.private_enabled(),
        verified=merchant.verified,
        status=latest.status if latest else None,
        legal_name=latest.legal_name if latest else None,
        doc_type=latest.doc_type if latest else None,
        note=latest.note if latest and latest.status == VERIFY_REJECTED else None,
        submitted_at=latest.created_at if latest else None,
        required_for_payout=payout_requires_verification(),
    )


@router.get("", response_model=VerificationStatus)
def my_verification(current_user: User = Depends(get_current_active_user), db: Session = Depends(get_db)):
    return _status(db, _merchant_of(current_user))


async def _read_photo(upload: UploadFile, what: str) -> tuple[bytes, str, str]:
    data = await upload.read(MAX_PHOTO_BYTES + 1)
    if len(data) > MAX_PHOTO_BYTES:
        raise HTTPException(status_code=413, detail=f"The {what} photo is too large (max {MAX_PHOTO_BYTES // (1024 * 1024)} MB).")
    kind = sniff_image(data)
    if kind is None:
        raise HTTPException(status_code=415, detail=f"The {what} must be a JPEG, PNG or WebP photo.")
    return data, kind[0], kind[1]


@router.post("", response_model=VerificationStatus, status_code=status.HTTP_201_CREATED)
@limiter.limit("5/day")
async def submit_verification(
    request: Request,
    legal_name: str = Form(min_length=2, max_length=150),
    doc_type: str = Form(),
    document: UploadFile = File(),
    selfie: UploadFile = File(),
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    merchant = _merchant_of(current_user)
    if not storage.private_enabled():
        raise HTTPException(status_code=503, detail="Seller verification isn't available right now.")
    if doc_type not in DOC_TYPES:
        raise HTTPException(status_code=422, detail="Choose a document type from the list.")
    if merchant.verified:
        raise HTTPException(status_code=409, detail="This store is already verified.")
    latest = _latest(db, merchant)
    if latest is not None and latest.status == VERIFY_PENDING:
        raise HTTPException(status_code=409, detail="Your documents are already waiting for review.")
    doc_bytes, doc_type_mime, doc_ext = await _read_photo(document, "document")
    selfie_bytes, selfie_mime, selfie_ext = await _read_photo(selfie, "selfie")

    base = f"verification/{merchant.id}/{uuid.uuid4()}"
    doc_key, selfie_key = f"{base}-doc{doc_ext}", f"{base}-selfie{selfie_ext}"
    try:
        storage.put_private(doc_key, doc_bytes, doc_type_mime)
        storage.put_private(selfie_key, selfie_bytes, selfie_mime)
    except Exception:
        storage.delete_private([doc_key, selfie_key])
        raise HTTPException(status_code=502, detail="We couldn't save your photos. Please try again.")
    db.add(SellerVerification(merchant_id=merchant.id, legal_name=legal_name.strip(), doc_type=doc_type, document_key=doc_key, selfie_key=selfie_key))
    db.commit()
    return _status(db, merchant)


# ---- admin ------------------------------------------------------------------------------------------------------------
def _queue_item(v: SellerVerification, merchant: MerchantAccount) -> VerificationQueueItem:
    return VerificationQueueItem(
        id=v.id,
        merchant_id=merchant.id,
        business_name=merchant.business_name,
        owner_email=merchant.user.email,
        legal_name=v.legal_name,
        doc_type=v.doc_type,
        status=v.status,
        created_at=v.created_at,
        document_url=storage.private_view_url(v.document_key),
        selfie_url=storage.private_view_url(v.selfie_key),
        note=v.note,
    )


@admin_router.get("/verifications", response_model=list[VerificationQueueItem])
def list_verifications(
    request_status: str = Query(VERIFY_PENDING, alias="status", pattern="^(pending|approved|rejected)$"),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(SellerVerification, MerchantAccount)
        .join(MerchantAccount, SellerVerification.merchant_id == MerchantAccount.id)
        .filter(SellerVerification.status == request_status)
        .order_by(SellerVerification.created_at)
        .limit(100)
        .all()
    )
    return [_queue_item(v, m) for v, m in rows]


@admin_router.post("/verifications/{verification_id}/review", response_model=VerificationQueueItem)
def review_verification(
    verification_id: uuid.UUID,
    payload: ReviewRequest,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    v = db.get(SellerVerification, verification_id)
    if v is None:
        raise HTTPException(status_code=404, detail="Request not found")
    if v.status != VERIFY_PENDING:
        raise HTTPException(status_code=409, detail="This request has already been decided.")
    if not payload.approve and not (payload.note and payload.note.strip()):
        raise HTTPException(status_code=422, detail="Say why it was rejected so the seller can fix it.")
    merchant = db.get(MerchantAccount, v.merchant_id)
    keys = [v.document_key, v.selfie_key]
    v.status = VERIFY_APPROVED if payload.approve else VERIFY_REJECTED
    v.note = None if payload.approve else payload.note.strip()
    v.reviewed_by, v.reviewed_at = admin.id, datetime.now(timezone.utc)
    v.document_key = v.selfie_key = None  # the photos are not kept
    if payload.approve:
        merchant.verified_at = datetime.now(timezone.utc)
        body = "Your store is now verified. A Verified seller badge shows on your videos."
    else:
        body = f"We couldn't verify your store yet: {v.note} You can send new photos from your seller dashboard."
    db.add(Notification(user_id=merchant.user_id, body=body[:500], type=NotificationType.moderation))
    db.commit()
    storage.delete_private(keys)
    return _queue_item(v, merchant)


@admin_router.post("/merchants/{merchant_id}/unverify", status_code=status.HTTP_204_NO_CONTENT)
def unverify_merchant(merchant_id: uuid.UUID, db: Session = Depends(get_db)):
    merchant = db.get(MerchantAccount, merchant_id)
    if merchant is None:
        raise HTTPException(status_code=404, detail="Merchant not found")
    merchant.verified_at = None
    db.commit()
