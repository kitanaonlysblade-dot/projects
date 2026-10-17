"""Admin side of content moderation (app/screening.py): the review queue and the word-filter list."""
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app import screening
from app.auth import get_current_admin
from app.database import get_db
from app.models import Comment, ModerationItem, ModerationTerm, Product, User, VideoPost
from app.models.screening import SEVERITY_HELD, STATUS_APPROVED, STATUS_PENDING, STATUS_REMOVED

router = APIRouter(prefix="/admin/moderation", tags=["admin"], dependencies=[Depends(get_current_admin)])


class DecisionBody(BaseModel):
    note: str | None = Field(default=None, max_length=300)


class TermBody(BaseModel):
    term: str = Field(min_length=2, max_length=100)
    action: str = Field(default="block", pattern="^(block|flag)$")


def _preview(db: Session, item: ModerationItem) -> dict:
    """What an admin needs to see to decide, or {} when the target is already gone."""
    tt, tid = item.target_type, item.target_id
    if tt == "video_post":
        p = db.get(VideoPost, tid)
        if p is not None:
            src = p.repost_of if p.repost_of is not None else p
            return {"kind": "video", "video_url": src.video_url, "thumbnail_url": src.thumbnail_url, "text": src.description, "by": p.poster.username, "held": p.moderation_hold}
    elif tt == "comment":
        c = db.get(Comment, tid)
        if c is not None:
            return {"kind": "text", "text": c.text, "by": c.author.username if c.author else None}
    elif tt == "product":
        pr = db.get(Product, tid)
        if pr is not None:
            images = sorted(pr.images, key=lambda i: i.position)
            return {"kind": "product", "thumbnail_url": images[0].url if images else None, "images": [i.url for i in images], "text": f"{pr.name}\n{pr.description or ''}".strip()}
    elif tt == "user":
        u = db.get(User, tid)
        if u is not None:
            return {"kind": "profile", "thumbnail_url": u.avatar_url, "text": f"{u.display_name} (@{u.username})\n{u.bio or ''}".strip(), "by": u.username}
    return {}


def _read(db: Session, item: ModerationItem) -> dict:
    owner = db.get(User, item.owner_id) if item.owner_id else None
    return {
        "id": item.id,
        "target_type": item.target_type,
        "target_id": item.target_id,
        "owner_username": owner.username if owner else None,
        "owner_removed_count": screening.owner_removed_count(db, item.owner_id),
        "source": item.source,
        "category": item.category,
        "score": item.score,
        "detail": item.detail,
        "severity": item.severity,
        "status": item.status,
        "resolution_note": item.resolution_note,
        "created_at": item.created_at,
        "preview": _preview(db, item),
    }


@router.get("/summary")
def summary(db: Session = Depends(get_db)):
    from app.image_safety import enabled

    counts = dict(db.query(ModerationItem.status, func.count()).group_by(ModerationItem.status).all())
    held = db.query(ModerationItem).filter(ModerationItem.status == STATUS_PENDING, ModerationItem.severity == SEVERITY_HELD).count()
    return {
        "pending": counts.get(STATUS_PENDING, 0),
        "pending_held": held,
        "approved": counts.get(STATUS_APPROVED, 0),
        "removed": counts.get(STATUS_REMOVED, 0),
        "terms": db.query(ModerationTerm).count(),
        "picture_checks_on": enabled(),
    }


@router.get("/items")
def list_items(
    status_: str = Query(default=STATUS_PENDING, alias="status", pattern="^(pending|approved|removed)$"),
    limit: int = Query(default=50, le=200),
    db: Session = Depends(get_db),
):
    q = db.query(ModerationItem).filter(ModerationItem.status == status_)
    # Hidden videos first (they are waiting to be seen again), then oldest first.
    q = q.order_by((ModerationItem.severity == SEVERITY_HELD).desc(), ModerationItem.created_at)
    return [_read(db, i) for i in q.limit(limit).all()]


def _pending_item(db: Session, item_id: uuid.UUID) -> ModerationItem:
    item = db.get(ModerationItem, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Item not found")
    if item.status != STATUS_PENDING:
        raise HTTPException(status_code=400, detail="This item has already been decided")
    return item


@router.post("/items/{item_id}/approve")
def approve_item(item_id: uuid.UUID, body: DecisionBody | None = None, admin: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    item = _pending_item(db, item_id)
    screening.approve(db, item, admin, body.note if body else None)
    return _read(db, item)


@router.post("/items/{item_id}/remove")
def remove_item(item_id: uuid.UUID, body: DecisionBody | None = None, admin: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    item = _pending_item(db, item_id)
    screening.remove(db, item, admin, body.note if body else None)
    return _read(db, item)


@router.get("/terms")
def list_terms(db: Session = Depends(get_db)):
    return [{"id": t.id, "term": t.term, "action": t.action} for t in db.query(ModerationTerm).order_by(ModerationTerm.term)]


@router.post("/terms", status_code=status.HTTP_201_CREATED)
def add_term(body: TermBody, db: Session = Depends(get_db)):
    term = screening.normalize_term(body.term)
    if len(term) < 2:
        raise HTTPException(status_code=400, detail="That term is too short")
    existing = db.query(ModerationTerm).filter(ModerationTerm.term == term).first()
    if existing is not None:
        existing.action = body.action
        row = existing
    else:
        row = ModerationTerm(term=term, action=body.action)
        db.add(row)
    db.commit()
    screening.reset_terms_cache()
    return {"id": row.id, "term": row.term, "action": row.action}


@router.delete("/terms/{term_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_term(term_id: uuid.UUID, db: Session = Depends(get_db)):
    row = db.get(ModerationTerm, term_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Term not found")
    db.delete(row)
    db.commit()
    screening.reset_terms_cache()
