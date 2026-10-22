"""The Wanted wall: moments shoppers are asking about (see app/wanted_service.py). Public
to read; a shopper wants one ("Want it"), switches its bell ("Notify me"), opens its
compare list (every product sellers twinned to it, app/wanted_twins.py), and a seller
answers with "Twin it"."""
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth import get_current_active_user, get_optional_user
from app.database import get_db
from app.models import Product, TwinSearch, User, VideoPost
from app.rate_limit import limiter
from app.twin_search_service import moment_signals, root_post
from app.schemas.catalog import ProductRead
from app.schemas.wanted import (
    TwinChoice,
    TwinReportCreate,
    MomentSignals,
    MomentWord,
    WantedDetail,
    WantedItem,
    WantedLead,
    WantedList,
    WantedNotify,
    WantedOffer,
    WantedTwinResult,
    WantedTwins,
)
from app import wanted_service as svc
from app import wanted_twins as wt

router = APIRouter(prefix="/wanted", tags=["wanted"])


class WantedJoined(BaseModel):
    item: WantedDetail
    # Non-empty when a twin already exists: the shopper is shown it instead of being
    # added to the wait.
    matches: list[ProductRead] = []


def _visible_or_404(db: Session, request_id: uuid.UUID, user: User | None) -> TwinSearch:
    row = svc.request_row(db, request_id, user)
    if row is None:
        raise HTTPException(status_code=404, detail="Request not found")
    return row


@router.get("", response_model=WantedList)
def list_wanted(
    tab: str = Query(default="trending", pattern="^(trending|new|most_twinned|mine|fulfilled)$"),
    limit: int = Query(default=20, ge=1, le=50),
    offset: int = Query(default=0, ge=0),
    current_user: User | None = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    open_count, items = svc.board(db, current_user, tab, limit, offset)
    return WantedList(open_count=open_count, items=[WantedItem(**i) for i in items])


@router.get("/nearby", response_model=list[WantedItem])
def nearby_wanted(
    video_post_id: uuid.UUID,
    start_ms: int = Query(ge=0),
    end_ms: int = Query(ge=1),
    q: str = Query(default="", max_length=300),
    bx: float | None = Query(default=None, ge=0, le=1),
    by: float | None = Query(default=None, ge=0, le=1),
    bw: float | None = Query(default=None, gt=0, le=1),
    bh: float | None = Query(default=None, gt=0, le=1),
    current_user: User | None = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    """Requests already on the wall for this moment of a video, so a shopper can join one
    ("Want it too") before creating another."""
    post = db.get(VideoPost, video_post_id)
    if post is None or end_ms <= start_ms:
        return []
    box = (bx, by, bw, bh) if None not in (bx, by, bw, bh) else None
    return [WantedItem(**i) for i in svc.nearby(db, current_user, post, start_ms, end_ms, q, box)]


@router.get("/suggest", response_model=MomentSignals)
def moment_hints(
    video_post_id: uuid.UUID,
    start_ms: int = Query(ge=0),
    end_ms: int = Query(ge=1),
    bx: float | None = Query(default=None, ge=0, le=1),
    by: float | None = Query(default=None, ge=0, le=1),
    bw: float | None = Query(default=None, gt=0, le=1),
    bh: float | None = Query(default=None, gt=0, le=1),
    current_user: User | None = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    """Tap-to-pick words and "N others circled this too" for a clipped moment."""
    post = db.get(VideoPost, video_post_id)
    if post is None or end_ms <= start_ms:
        return MomentSignals()
    box = (bx, by, bw, bh) if None not in (bx, by, bw, bh) else None
    sig = moment_signals(db, root_post(db, post).id, start_ms, end_ms, box, current_user.id if current_user else None)
    return MomentSignals(asked=sig.asked, circled=sig.circled, words=[MomentWord(word=w, count=n) for w, n in sig.words])


@router.get("/leads", response_model=list[WantedLead])
def wanted_leads(
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """"Requests you can answer": open requests on the wall that one of the seller's own
    products already fits, best fit first (declared before /{request_id}). Free for every
    seller; each one answers with the usual Twin it."""
    merchant = _my_merchant_or_403(current_user)
    _, items = svc.board(db, current_user, "trending", 40, 0)
    return [
        WantedLead(request=WantedItem(**i), product=ProductRead.model_validate(p), match=m)
        for i, p, m in wt.leads(db, current_user, merchant, items)
    ]


@router.get("/{request_id}", response_model=WantedDetail)
def get_wanted(
    request_id: uuid.UUID,
    current_user: User | None = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    row = _visible_or_404(db, request_id, current_user)
    return WantedDetail(**svc.detail(db, row, current_user))


@router.post("/{request_id}/upvote", response_model=WantedJoined)
@limiter.limit("60/hour")
def upvote_wanted(
    request: Request,
    request_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    row = _visible_or_404(db, request_id, current_user)
    _, hits = svc.join(db, current_user, row)
    return WantedJoined(
        item=WantedDetail(**svc.detail(db, row, current_user)),
        matches=[ProductRead.model_validate(h.product) for h in hits],
    )


@router.delete("/{request_id}/upvote", response_model=WantedDetail)
def remove_upvote(
    request_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    row = _visible_or_404(db, request_id, current_user)
    svc.leave(db, current_user, row.request_key)
    # The representative row may have been the caller's own and is now gone.
    fresh = svc.request_row(db, request_id, current_user)
    if fresh is None:
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    return WantedDetail(**svc.detail(db, fresh, current_user))


@router.put("/{request_id}/notify", response_model=WantedDetail)
def set_notify(
    request_id: uuid.UUID,
    payload: WantedNotify,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """The bell. Turning it on for a request you aren't part of joins it (asking to be
    told is wanting it); turning it off keeps your vote but stops the notification."""
    row = _visible_or_404(db, request_id, current_user)
    if svc.set_bell(db, current_user, row.request_key, payload.notify) == 0 and payload.notify:
        svc.join(db, current_user, row)
        svc.set_bell(db, current_user, row.request_key, True)
    return WantedDetail(**svc.detail(db, row, current_user))


def _my_merchant_or_403(user: User):
    merchant = user.merchant_account
    if merchant is None:
        raise HTTPException(status_code=403, detail="Create a merchant page to twin products")
    return merchant


def _clip_of(db: Session, row: TwinSearch):
    return svc._clip_tuple(svc._clip_rows(db, [row.request_key]).get(row.request_key))


@router.get("/{request_id}/twins", response_model=WantedTwins)
def wanted_twins_list(
    request_id: uuid.UUID,
    current_user: User | None = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    """The compare list: every product twinned to this moment, official first. A product
    is only called "Similar" when an official twin exists to compare it with."""
    row = _visible_or_404(db, request_id, current_user)
    opts = wt.options(db, row.request_key, row.query, _clip_of(db, row), current_user)
    return WantedTwins(**wt.options_payload(opts))


@router.get("/{request_id}/my-products", response_model=list[TwinChoice])
def my_twin_choices(
    request_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """The "Twin it" sheet: the seller's own products, best match first."""
    merchant = _my_merchant_or_403(current_user)
    row = _visible_or_404(db, request_id, current_user)
    return [
        TwinChoice(product=ProductRead.model_validate(p), match=match, twinned=done)
        for p, match, done in wt.my_choices(db, merchant, row.request_key, row.query)
    ]


def _twin_it(db: Session, current_user: User, row: TwinSearch, product_id: uuid.UUID) -> tuple[Product, int]:
    merchant = _my_merchant_or_403(current_user)
    product = db.get(Product, product_id)
    if product is None or product.merchant_id != merchant.id:
        raise HTTPException(status_code=404, detail="Product not found")
    try:
        notified = svc.offer(db, current_user, row, product)
    except wt.OfferBlocked:
        raise HTTPException(status_code=409, detail="The video's creator hid this product for this moment")
    return product, notified


@router.post("/{request_id}/twin", response_model=WantedTwinResult)
@limiter.limit("10/day")
def twin_it(
    request: Request,
    request_id: uuid.UUID,
    payload: WantedOffer,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """"Twin it": a seller says this product of theirs fits the moment. Shoppers still
    waiting (with the bell on) are told once. Sellers can only twin their own products."""
    row = _visible_or_404(db, request_id, current_user)
    product, notified = _twin_it(db, current_user, row, payload.product_id)
    opts = wt.options(db, row.request_key, row.query, _clip_of(db, row), current_user)
    mine = next((o for o in opts if o.product.id == product.id), None)
    if mine is None:  # hidden (e.g. reported) - say so rather than pretend it shows
        raise HTTPException(status_code=409, detail="This product can't be shown for this moment right now")
    return WantedTwinResult(notified=notified, option=wt.option_dict(mine, any(o.kind == "official" for o in opts)))


@router.post("/{request_id}/offer")
@limiter.limit("10/day")
def offer_product(
    request: Request,
    request_id: uuid.UUID,
    payload: WantedOffer,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Same as /twin, kept for older app versions: returns just how many were told."""
    row = _visible_or_404(db, request_id, current_user)
    _, notified = _twin_it(db, current_user, row, payload.product_id)
    return {"notified": notified}


@router.delete("/{request_id}/twin/{product_id}", status_code=status.HTTP_204_NO_CONTENT)
def withdraw_twin(
    request_id: uuid.UUID,
    product_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """A seller takes their own twin back."""
    row = _visible_or_404(db, request_id, current_user)
    if not wt.withdraw(db, current_user, row.request_key, product_id):
        raise HTTPException(status_code=404, detail="You haven't twinned that product here")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{request_id}/twins/{product_id}/report", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("30/day")
def report_twin(
    request: Request,
    request_id: uuid.UUID,
    product_id: uuid.UUID,
    payload: TwinReportCreate,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Report a twin (counterfeit, a likeness used without permission, doesn't match the
    moment, or "I'm the brand or creator"). It goes into the admin Reports queue; enough
    different reporters hide it from compare lists until it has been looked at."""
    row = _visible_or_404(db, request_id, current_user)
    opts = wt.options(db, row.request_key, row.query, _clip_of(db, row), current_user)
    option = next((o for o in opts if o.product.id == product_id), None)
    if option is None:
        raise HTTPException(status_code=404, detail="That product isn't twinned here")
    wt.file_report(db, current_user, row.id, option.product, payload.reason, payload.detail)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
