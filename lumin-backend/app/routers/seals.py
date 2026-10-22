"""Tamper-proof bags: the seller's live test and seal (/seals) and the admin side (/admin/seals). Rules live in app/seals.py."""
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app import seals, storage
from app.auth import get_current_active_user, get_current_admin
from app.database import get_db
from app.models import LiveTest, Order, SealBag, SealBatch, SealEvent, User
from app.models.seal import TEST_SEALED
from app.rate_limit import limiter

router = APIRouter(prefix="/seals", tags=["seals"])
admin_router = APIRouter(prefix="/admin/seals", tags=["admin-seals"], dependencies=[Depends(get_current_admin)])


def _raise(e: seals.SealError):
    raise HTTPException(status_code=e.status, detail=str(e))


class StartTest(BaseModel):
    content_type: str = Field("video/webm", max_length=40)


class LiveTestRead(BaseModel):
    id: uuid.UUID
    order_id: uuid.UUID
    status: str
    order_code: str
    started_at: datetime
    sealed_at: datetime | None = None
    checklist: list[str] = []
    serial: str | None = None
    upload_url: str | None = None  # only when it has just been opened
    min_seconds: float | None = None
    require_serial: bool = False


class CodeBody(BaseModel):
    code: str = Field(max_length=200)


class SealBody(BaseModel):
    code: str = Field(max_length=200)
    duration_s: float = Field(ge=0, le=3600)
    checklist: list[str] = Field(default_factory=list, max_length=40)
    note: str | None = Field(default=None, max_length=300)


class BagCheck(BaseModel):
    ok: bool
    serial: str


def _read(db: Session, t: LiveTest, upload_url: str | None = None) -> LiveTestRead:
    bag = db.get(SealBag, t.bag_id) if t.bag_id else None
    return LiveTestRead(
        id=t.id, order_id=t.order_id, status=t.status, order_code=t.order_code, started_at=t.started_at,
        sealed_at=t.sealed_at, checklist=list(t.checklist or []), serial=bag.serial if bag else None, upload_url=upload_url,
        min_seconds=seals.MIN_TEST_SECONDS if upload_url else None,
        require_serial=bool(upload_url) and seals.serial_required(db.get(Order, t.order_id)),
    )


@router.get("/orders/{order_id}", response_model=LiveTestRead | None)
def order_test(order_id: uuid.UUID, current_user: User = Depends(get_current_active_user), db: Session = Depends(get_db)):
    """The sealed live test of this order (the seller's own), or null."""
    try:
        order = seals._order_for_seller(db, order_id, current_user)
    except seals.SealError as e:
        _raise(e)
    t = seals.sealed_test_for(db, order.id)
    return _read(db, t) if t else None


@router.get("/sealed-orders", response_model=list[uuid.UUID])
def sealed_orders(current_user: User = Depends(get_current_active_user), db: Session = Depends(get_db)):
    """Ids of this seller's orders that already have a sealed live test (for the ticks on the orders list)."""
    rows = db.query(LiveTest.order_id).filter(LiveTest.seller_id == current_user.id, LiveTest.status == TEST_SEALED).all()
    return [r[0] for r in rows]


@router.get("/bags/mine")
def my_bags(current_user: User = Depends(get_current_active_user), db: Session = Depends(get_db)):
    """How many bags this seller holds in each status."""
    rows = (
        db.query(SealBag.status, func.count())
        .filter(SealBag.seller_id == current_user.id)
        .group_by(SealBag.status)
        .all()
    )
    return {s: n for s, n in rows}


@router.post("/orders/{order_id}/tests", response_model=LiveTestRead, status_code=201)
@limiter.limit("20/minute")
def start_test(request: Request, order_id: uuid.UUID, payload: StartTest, current_user: User = Depends(get_current_active_user), db: Session = Depends(get_db)):
    """Open a live test: the server starts the clock, gives the on-screen order code and a one-time upload address."""
    try:
        t, url = seals.start_test(db, order_id, current_user, payload.content_type.split(";")[0].strip())
    except seals.SealError as e:
        _raise(e)
    return _read(db, t, url)


@router.post("/bags/check", response_model=BagCheck)
@limiter.limit("60/minute")
def check_bag(request: Request, payload: CodeBody, current_user: User = Depends(get_current_active_user), db: Session = Depends(get_db)):
    """While recording: does the scanned code belong to a bag this seller may use right now? Changes nothing."""
    try:
        bag = seals.check_bag(db, current_user, payload.code)
    except seals.SealError as e:
        _raise(e)
    return BagCheck(ok=True, serial=bag.serial)


@router.post("/tests/{test_id}/seal", response_model=LiveTestRead)
@limiter.limit("20/minute")
def seal(request: Request, test_id: uuid.UUID, payload: SealBody, current_user: User = Depends(get_current_active_user), db: Session = Depends(get_db)):
    """The scan that ends the live test: the bag goes unused -> preview/used, tied to this order and this video."""
    try:
        t = seals.seal_test(db, test_id, current_user, payload.code, payload.duration_s, payload.checklist, payload.note)
    except seals.SealError as e:
        _raise(e)
    return _read(db, t)


@router.post("/tests/{test_id}/abandon", status_code=204)
def abandon(test_id: uuid.UUID, current_user: User = Depends(get_current_active_user), db: Session = Depends(get_db)):
    t = db.get(LiveTest, test_id)
    if t is not None and t.seller_id == current_user.id and t.status == "recording":
        t.status = "abandoned"
        db.commit()
    return Response(status_code=204)


# ------------------------------------------------------------------ admin
class BatchCreate(BaseModel):
    count: int = Field(ge=1, le=seals.MAX_BATCH)
    label: str | None = Field(default=None, max_length=120)
    seller_id: uuid.UUID | None = None


class BatchRead(BaseModel):
    id: uuid.UUID
    label: str | None
    count: int
    created_at: datetime
    by_status: dict[str, int]


class AssignBody(BaseModel):
    seller_id: uuid.UUID


@admin_router.post("/batches")
@limiter.limit("10/minute")
def create_batch(request: Request, payload: BatchCreate, admin: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    """Make a batch of dormant bags and return the print-ready PDF. This is the ONLY time the codes exist in readable form
    (the database keeps hashes): download it straight away and send it to the bag manufacturer."""
    if payload.seller_id is not None and db.get(User, payload.seller_id) is None:
        raise HTTPException(status_code=404, detail="Seller not found")
    try:
        batch, rows = seals.generate_batch(db, payload.count, payload.label, admin.id, payload.seller_id)
    except seals.SealError as e:
        _raise(e)
    pdf = seals.print_sheet(rows, payload.label)
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="lumin-seals-{rows[0][0]}-{rows[-1][0]}.pdf"',
            "X-Batch-Id": str(batch.id),
            "Cache-Control": "no-store",
        },
    )


@admin_router.get("/batches", response_model=list[BatchRead])
def list_batches(db: Session = Depends(get_db)):
    batches = db.query(SealBatch).order_by(SealBatch.created_at.desc()).limit(100).all()
    counts: dict[uuid.UUID, dict[str, int]] = {}
    for bid, st, n in db.query(SealBag.batch_id, SealBag.status, func.count()).group_by(SealBag.batch_id, SealBag.status):
        counts.setdefault(bid, {})[st] = n
    return [BatchRead(id=b.id, label=b.label, count=b.count, created_at=b.created_at, by_status=counts.get(b.id, {})) for b in batches]


@admin_router.post("/batches/{batch_id}/assign")
def assign_batch(batch_id: uuid.UUID, payload: AssignBody, db: Session = Depends(get_db)):
    """Sell/give a batch to a seller: only unused bags that nobody owns yet are assigned."""
    if db.get(User, payload.seller_id) is None:
        raise HTTPException(status_code=404, detail="Seller not found")
    n = (
        db.query(SealBag)
        .filter(SealBag.batch_id == batch_id, SealBag.seller_id.is_(None), SealBag.status == "unused")
        .update({SealBag.seller_id: payload.seller_id}, synchronize_session=False)
    )
    db.commit()
    return {"assigned": n}


class EventRead(BaseModel):
    from_status: str | None
    to_status: str
    note: str | None
    created_at: datetime


class EvidenceRead(BaseModel):
    id: uuid.UUID
    order_id: uuid.UUID
    seller_id: uuid.UUID
    serial: str | None
    bag_status: str | None
    status: str
    order_code: str
    started_at: datetime
    sealed_at: datetime | None
    claimed_duration_s: float | None
    video_sha256: str | None
    video_url: str | None
    checklist: list[str]
    note: str | None
    events: list[EventRead]


@admin_router.get("/tests", response_model=list[EvidenceRead])
def list_tests(order_id: uuid.UUID | None = None, limit: int = 50, db: Session = Depends(get_db)):
    """Sealed live tests with their video (a link that expires in minutes when a private bucket is set) and the bag's history."""
    q = db.query(LiveTest).filter(LiveTest.status == TEST_SEALED)
    if order_id:
        q = q.filter(LiveTest.order_id == order_id)
    out = []
    for t in q.order_by(LiveTest.sealed_at.desc()).limit(min(limit, 100)).all():
        bag = db.get(SealBag, t.bag_id) if t.bag_id else None
        events = (
            db.query(SealEvent).filter(SealEvent.bag_id == t.bag_id).order_by(SealEvent.created_at).all() if t.bag_id else []
        )
        out.append(
            EvidenceRead(
                id=t.id, order_id=t.order_id, seller_id=t.seller_id, serial=bag.serial if bag else None,
                bag_status=bag.status if bag else None, status=t.status, order_code=t.order_code, started_at=t.started_at,
                sealed_at=t.sealed_at, claimed_duration_s=t.claimed_duration_s, video_sha256=t.video_sha256,
                video_url=storage.evidence_view_url(t.video_key, t.video_private), checklist=list(t.checklist or []),
                note=t.note,
                events=[EventRead(from_status=e.from_status, to_status=e.to_status, note=e.note, created_at=e.created_at) for e in events],
            )
        )
    return out


class VoidBody(BaseModel):
    reason: str = Field(min_length=3, max_length=300)


@admin_router.post("/bags/{serial}/void")
def void_bag(serial: str, payload: VoidBody, admin: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    bag = db.query(SealBag).filter(SealBag.serial == serial.upper()).first()
    if bag is None:
        raise HTTPException(status_code=404, detail="Bag not found")
    try:
        seals.advance(db, bag.id, "void", admin.id, payload.reason)
    except seals.SealError as e:
        _raise(e)
    return {"serial": bag.serial, "status": "void"}


# ------------------------------------------------------------------ the shop's bag packs
class PackSize(BaseModel):
    pack_size: int | None = Field(ge=1, le=1000)  # null turns it off


@admin_router.patch("/products/{product_id}")
def set_pack_size(product_id: uuid.UUID, payload: PackSize, db: Session = Depends(get_db)):
    """Mark a shop product as a pack of N tamper-proof bags (or null: an ordinary product again). Buying one reserves N printed
    bags to the buyer."""
    from app.models import Product

    p = db.get(Product, product_id)
    if p is None:
        raise HTTPException(status_code=404, detail="Product not found")
    p.seal_pack_size = payload.pack_size
    db.commit()
    return {"product_id": str(p.id), "name": p.name, "pack_size": p.seal_pack_size}


class PackOrderRead(BaseModel):
    order_id: uuid.UUID
    product_name: str
    buyer_name: str
    pack_size: int
    serials: list[str]
    status: str
    created_at: datetime


@admin_router.get("/stock")
def stock(db: Session = Depends(get_db)):
    """Printed bags nobody owns yet: what is left to sell."""
    n = db.query(func.count()).select_from(SealBag).filter(SealBag.status == "unused", SealBag.seller_id.is_(None), SealBag.pack_order_id.is_(None)).scalar()
    return {"free_bags": n}


@admin_router.get("/pack-orders", response_model=list[PackOrderRead])
def pack_orders(db: Session = Depends(get_db)):
    """Shop orders for bag packs, with the serials to pack. Orders that could not get their bags (stock ran out) show none."""
    from app import seal_packs
    from app.models import Product

    rows = (
        db.query(Order, Product.seal_pack_size)
        .join(Product, Product.id == Order.product_id)
        .filter(Product.seal_pack_size.isnot(None))
        .order_by(Order.created_at.desc())
        .limit(200)
        .all()
    )
    return [
        PackOrderRead(order_id=o.id, product_name=o.product_name, buyer_name=o.buyer_name, pack_size=size,
                      serials=seal_packs.serials_for_order(db, o.id), status=o.status.value, created_at=o.created_at)
        for o, size in rows
    ]


@admin_router.post("/pack-orders/{order_id}/assign")
def assign_pack_order(order_id: uuid.UUID, db: Session = Depends(get_db)):
    """Fill a bag-pack order that was waiting for stock (after printing another batch)."""
    from app import seal_packs

    o = db.get(Order, order_id)
    if o is None:
        raise HTTPException(status_code=404, detail="Order not found")
    ok = seal_packs.assign_for_order(db, o)
    return {"complete": ok, "serials": seal_packs.serials_for_order(db, o.id)}


@admin_router.get("/risk")
def risk(db: Session = Depends(get_db)):
    """Warning signs to look at (never automatic actions): sellers with many disputes or refused deliveries, a buyer and seller
    trading with each other over and over, buyers who file many claims."""
    from app import fraud_signals

    def name(uid):
        u = db.get(User, uid) if uid else None
        return u.display_name if u is not None else None

    sellers = [dict(r, user_id=str(r["user_id"]), name=name(r["user_id"])) for r in fraud_signals.risky_sellers(db)]
    pairs = [dict(r, buyer_id=str(r["buyer_id"]), seller_id=str(r["seller_id"]), buyer_name=name(r["buyer_id"]), seller_name=name(r["seller_id"])) for r in fraud_signals.repeat_pairs(db)]
    buyers = [dict(r, buyer_id=str(r["buyer_id"]), name=name(r["buyer_id"])) for r in fraud_signals.repeat_claimants(db)]
    return {"sellers": sellers, "pairs": pairs, "buyers": buyers}
