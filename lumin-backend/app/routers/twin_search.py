"""Twin search: "what is this?" as a search engine.

A shopper clips a moment of a video (or just types into discovery search) and
describes what they want. We look for it in the catalog - first what's already
known about that moment, then products whose words (and, when a vision matcher is
plugged in, photos) fit - and either show matches they can buy like any product,
or tell them nothing matched yet and that they'll be notified. Every search is also
demand data for merchants (GET /merchant/insights/keywords), and every result a
shopper goes on to add to cart / buy teaches the video-moment index.
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy.orm import Session, joinedload

from app.auth import get_current_active_user, get_optional_user
from app.database import get_db
from app.models import Category, Product, TwinSearch, TwinSearchStatus, User, VideoMomentProduct, VideoPost
from app import moment_index
from app.rate_limit import limiter
from app.schemas import (
    KeywordInsight,
    KeywordInsightsRead,
    MomentCandidateRead,
    MomentLinkReview,
    MomentProductRead,
    TwinSearchCreate,
    TwinSearchPick,
    TwinSearchRead,
    TwinSearchResult,
    TwinSearchSummary,
)
from app.schemas.catalog import ProductRead
from app.twin_config import SEARCH_MAX_RESULTS
from app.twin_config import public as public_twin_config
from app.twin_search_service import (
    closest_matches,
    keyword_insights,
    moment_products,
    record_pick,
    run_search,
    save_closest,
    root_post,
)
from app.twin_pool import family_root_id

router = APIRouter(tags=["twin-search"])
# Always on, even with twins switched off: the seller's tagging screen reads these numbers.
config_router = APIRouter(tags=["twin-search"])

NOT_FOUND_MESSAGE = "We couldn't find a twin match. We'll notify you as soon as one is available."


@config_router.get("/twin-config")
def twin_config():
    """The few tunable numbers the apps need (see app/twin_config.py)."""
    return public_twin_config()


def _result(h) -> TwinSearchResult:
    return TwinSearchResult(product=ProductRead.model_validate(h.product), score=round(min(1.0, h.score), 3), source=h.source)


def _read(search: TwinSearch, hits, closest=()) -> TwinSearchRead:
    results = [_result(h) for h in hits]
    return TwinSearchRead(
        id=search.id,
        query=search.query,
        status=search.status,
        video_post_id=search.video_post_id,
        start_ms=search.start_ms,
        end_ms=search.end_ms,
        category_id=search.category_id,
        results=results,
        closest=[_result(h) for h in closest] if not results else [],
        message=(f"Found {len(results)} twin match{'es' if len(results) != 1 else ''}." if results else NOT_FOUND_MESSAGE),
        created_at=search.created_at,
    )


@router.post("/twin-search", response_model=TwinSearchRead)
@limiter.limit("30/hour")
def create_twin_search(
    request: Request,
    payload: TwinSearchCreate,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    post = None
    if payload.video_post_id is not None:
        post = db.get(VideoPost, payload.video_post_id)
        if post is None:
            raise HTTPException(status_code=404, detail="Video post not found")
    if payload.category_id is not None and db.get(Category, payload.category_id) is None:
        raise HTTPException(status_code=404, detail="Category not found")

    search, hits = run_search(
        db,
        current_user,
        query=payload.query,
        category_id=payload.category_id,
        post=post,
        start_ms=payload.start_ms,
        end_ms=payload.end_ms,
        box=(payload.box.x, payload.box.y, payload.box.w, payload.box.h) if payload.box is not None else None,
        box_at_ms=payload.box_at_ms,
    )
    closest = []
    if not hits:
        closest = closest_matches(
            db, payload.query, category_id=payload.category_id, current_user=current_user
        )
        save_closest(db, search, closest)
    return _read(search, hits, closest)


@router.get("/twin-search/mine", response_model=list[TwinSearchSummary])
def my_twin_searches(
    status_filter: str | None = Query(default=None, alias="status", pattern="^(matched|not_found|available|fulfilled)$"),
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """The caller's own searches - including the ones still waiting for a product."""
    q = (
        db.query(TwinSearch)
        .options(joinedload(TwinSearch.matched_product).joinedload(Product.images))
        .filter(TwinSearch.user_id == current_user.id)
    )
    if status_filter:
        q = q.filter(TwinSearch.status == TwinSearchStatus(status_filter))
    return q.order_by(TwinSearch.created_at.desc()).limit(100).all()


def _own_search_or_404(db: Session, search_id: uuid.UUID, user: User) -> TwinSearch:
    search = db.get(TwinSearch, search_id)
    if search is None or search.user_id != user.id:
        raise HTTPException(status_code=404, detail="Search not found")
    return search


@router.delete("/twin-search/{search_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_twin_search(
    search_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Stop waiting: removes the search (and so the shopper's place in the keyword demand)."""
    db.delete(_own_search_or_404(db, search_id, current_user))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/twin-search/{search_id}/pick", response_model=TwinSearchSummary)
@limiter.limit("60/hour")
def pick_twin_result(
    request: Request,
    search_id: uuid.UUID,
    payload: TwinSearchPick,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Called by the app right after the shopper adds a result to cart / taps buy.
    Only a product the search really returns can be picked, so this can't be used to
    plant arbitrary products on a video."""
    search = _own_search_or_404(db, search_id, current_user)
    product = db.get(Product, payload.product_id)
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")

    # Judged against what this search showed, not re-matched: that keeps picks cheap and
    # means what the shopper saw is what counts. matched_product_id covers a waiting
    # search whose twin was listed later (the notification opens that product).
    exact = product.id in set(search.result_ids or []) or product.id == search.matched_product_id
    if not exact and product.id not in set(search.closest_ids or []):
        raise HTTPException(status_code=400, detail="That product wasn't one of the results")

    return record_pick(db, current_user, search, product, payload.action, exact=exact)


@router.get("/video-posts/{video_post_id}/moment-products", response_model=list[MomentProductRead])
def video_moment_products(
    video_post_id: uuid.UUID,
    current_user: User | None = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    """Which products are on screen when, for this video: the seller's own twins plus
    shopper-suggested links that have earned trust (several different shoppers who
    clipped the moment, matched the words, bought and kept the product - see
    app/moment_index.py). The index other video surfaces can read later."""
    post = db.get(VideoPost, video_post_id)
    if post is None:
        raise HTTPException(status_code=404, detail="Video post not found")
    root = root_post(db, post)
    root_id = family_root_id(root)
    states = {l.id: st for l, st in moment_index.trusted_links(db, root_id)}
    out = []
    for row, source in moment_products(db, root_id):
        crowd = source == "crowd"
        out.append(
            MomentProductRead(
                product=ProductRead.model_validate(row.product),
                start_ms=row.start_ms,
                end_ms=row.end_ms,
                confirmations=getattr(row, "confirmations", 0),
                source=source,
                confidence=states[row.id].confidence if crowd else 1.0,
                link_id=row.id if crowd else None,
                reviewed=bool(crowd and row.review == "confirmed"),
            )
        )
    return out


def _poster_post_or_404(db: Session, video_post_id: uuid.UUID, user: User) -> VideoPost:
    post = db.get(VideoPost, video_post_id)
    if post is None:
        raise HTTPException(status_code=404, detail="Video post not found")
    root = root_post(db, post)
    if root.poster_id != user.id:
        raise HTTPException(status_code=403, detail="Only the video's original poster can review moment links")
    return root


@router.get("/video-posts/{video_post_id}/moment-candidates", response_model=list[MomentCandidateRead])
def video_moment_candidates(
    video_post_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """The poster's inbox: products shoppers suggest for moments of this video that
    haven't earned trust yet, so they can confirm or reject them without waiting."""
    root = _poster_post_or_404(db, video_post_id, current_user)
    return [
        MomentCandidateRead(
            link_id=l.id,
            product=ProductRead.model_validate(l.product),
            start_ms=l.start_ms,
            end_ms=l.end_ms,
            shoppers=st.shoppers,
            buyers=st.buyers,
        )
        for l, st in moment_index.candidate_links(db, root.id)
    ]


@router.post("/video-posts/{video_post_id}/moment-products/{link_id}/review", status_code=status.HTTP_204_NO_CONTENT)
def review_moment_link(
    video_post_id: uuid.UUID,
    link_id: uuid.UUID,
    payload: MomentLinkReview,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """The poster overrules the crowd: confirm trusts the link now, reject hides it and
    stops new evidence landing on it, clear hands it back to the evidence."""
    root = _poster_post_or_404(db, video_post_id, current_user)
    link = db.get(VideoMomentProduct, link_id)
    if link is None or link.video_post_id != root.id:
        raise HTTPException(status_code=404, detail="Link not found")
    link.review = {"confirm": "confirmed", "reject": "rejected", "clear": None}[payload.decision]
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/merchant/insights/keywords", response_model=KeywordInsightsRead)
def merchant_keyword_insights(
    days: int = Query(default=30, ge=1, le=180),
    limit: int = Query(default=50, ge=1, le=200),
    category_id: uuid.UUID | None = None,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """What shoppers are searching for and not finding. A paid feature: without an
    active subscription a merchant sees only the top few keywords, no numbers."""
    merchant = current_user.merchant_account
    if merchant is None:
        raise HTTPException(status_code=404, detail="No merchant account for this user")
    unlocked = merchant.insights_active
    rows = keyword_insights(db, days=days, limit=limit, category_id=category_id, unlocked=unlocked)
    items = [
        KeywordInsight(
            keyword=r.keyword,
            example=r.example,
            searchers=r.searchers if unlocked else None,
            searches=r.searches if unlocked else None,
            unmet_searchers=r.unmet_searchers if unlocked else None,
            last_searched_at=r.last_searched_at if unlocked else None,
        )
        for r in rows
    ]
    return KeywordInsightsRead(locked=not unlocked, window_days=days, items=items)
