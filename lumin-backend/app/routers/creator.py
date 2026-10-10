"""What a creator's videos make people want, and the twins other sellers put on them.

"Your impact" counts shoppers who asked about moments of the creator's own videos and
the products sellers twinned there. "Twins on your videos" is the inbox where the creator
approves or hides those twins (POST /video-posts/{id}/moment-products/{link}/review,
app/routers/twin_search.py): the creator is the one person who knows what is in their
video, so their call wins over the crowd.
"""
import uuid
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import desc, func
from sqlalchemy.orm import Session, joinedload

from app import moment_index
from app import wanted_service as svc
from app import wanted_twins as wt
from app.auth import get_current_active_user
from app.database import get_db
from app.models import Product, TwinSearch, User, VideoMomentProduct, VideoPost, WantedOffer
from app.schemas.catalog import ProductRead
from app.schemas.creator import CreatorImpact, CreatorMoment, CreatorTwin, CreatorTwins
from app.twin_config import TWIN_NEW_SELLER_DAYS, WANTED_MIN_USERS

router = APIRouter(prefix="/creator", tags=["creator"])

_MOMENTS_SHOWN = 5
_TWINS_MAX = 100


def _my_root_ids(db: Session, user: User) -> list[uuid.UUID]:
    """The creator's own original videos. Reposts and retwins play someone else's moments."""
    rows = db.query(VideoPost.id).filter(
        VideoPost.poster_id == user.id, VideoPost.repost_of_id.is_(None), VideoPost.retwin_of_id.is_(None)
    )
    return [r[0] for r in rows]


def _link_state(link: VideoMomentProduct, st: moment_index.LinkState) -> str:
    if link.review == "rejected":
        return "hidden"
    if link.review == "confirmed" or st.trusted:
        return "approved"
    return "review"


@router.get("/impact", response_model=CreatorImpact)
def creator_impact(current_user: User = Depends(get_current_active_user), db: Session = Depends(get_db)):
    roots = _my_root_ids(db, current_user)
    can_tag = current_user.merchant_account is not None
    if not roots:
        return CreatorImpact(wanted=0, twins_offered=0, twins_approved=0, can_tag=can_tag, moments=[])

    wanted = (
        db.query(func.count(func.distinct(TwinSearch.user_id)))
        .filter(TwinSearch.video_post_id.in_(roots), TwinSearch.user_id != current_user.id)
        .scalar()
        or 0
    )
    links = (
        db.query(VideoMomentProduct)
        .options(joinedload(VideoMomentProduct.evidence))
        .filter(VideoMomentProduct.video_post_id.in_(roots))
        .all()
    )
    states = moment_index.assess(db, links)
    approved = sum(1 for l in links if _link_state(l, states[l.id]) == "approved")
    offered = 0
    if links:
        offered = (
            db.query(func.count(WantedOffer.id))
            .filter(WantedOffer.link_id.in_([l.id for l in links]))
            .scalar()
            or 0
        )

    asks = func.count(func.distinct(TwinSearch.user_id))
    rows = (
        db.query(TwinSearch.request_key, asks)
        .filter(
            TwinSearch.video_post_id.in_(roots),
            TwinSearch.status.in_(svc.UNMET),
            TwinSearch.request_key != "",
            TwinSearch.user_id != current_user.id,
        )
        .group_by(TwinSearch.request_key)
        .having(asks >= WANTED_MIN_USERS)
        .order_by(desc(asks))
        .limit(_MOMENTS_SHOWN)
        .all()
    )
    keys = [r[0] for r in rows]
    reps = svc._representatives(db, keys)
    clips = svc._clip_rows(db, keys)
    posts = svc._posts(db, clips)
    mine = {
        r[0]
        for r in db.query(WantedOffer.request_key).filter(
            WantedOffer.request_key.in_(keys or [""]), WantedOffer.seller_user_id == current_user.id
        )
    }
    moments = []
    for key, n in rows:
        clip, rep = clips.get(key), reps.get(key)
        if clip is None or rep is None or clip.video_post_id is None:
            continue
        post = posts.get(clip.video_post_id)
        moments.append(
            CreatorMoment(
                request_id=rep.id,
                query=rep.query,
                wants=n,
                twinned=wt.twinned_count(db, key, rep.query, svc._clip_tuple(clip), current_user),
                video_post_id=clip.video_post_id,
                thumbnail_url=post.thumbnail_url if post is not None else None,
                start_ms=clip.start_ms,
                end_ms=clip.end_ms,
                mine=key in mine,
            )
        )
    return CreatorImpact(wanted=wanted, twins_offered=offered, twins_approved=approved, can_tag=can_tag, moments=moments)


@router.get("/twins", response_model=CreatorTwins)
def creator_twins(
    state: Literal["review", "approved", "hidden"] = Query(default="review"),
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Twins on the creator's videos, by what they have decided: "review" is everything
    neither approved by them nor trusted from shoppers' kept purchases, nor hidden."""
    roots = _my_root_ids(db, current_user)
    counts = {"review": 0, "approved": 0, "hidden": 0}
    if not roots:
        return CreatorTwins(**counts, items=[])
    links = (
        db.query(VideoMomentProduct)
        .options(
            joinedload(VideoMomentProduct.product).joinedload(Product.images),
            joinedload(VideoMomentProduct.evidence),
        )
        .filter(VideoMomentProduct.video_post_id.in_(roots))
        .order_by(VideoMomentProduct.created_at.desc())
        .all()
    )
    states = moment_index.assess(db, links)
    tagged = [(l, _link_state(l, states[l.id])) for l in links]
    for _, s in tagged:
        counts[s] += 1
    shown = [(l, s) for l, s in tagged if s == state][:_TWINS_MAX]

    by_link = {
        r[0]: r[1]
        for r in db.query(WantedOffer.link_id, WantedOffer.request_key).filter(
            WantedOffer.link_id.in_([l.id for l, _ in shown] or [uuid.uuid4()])
        )
    }
    queries = {
        r[0]: r[1]
        for r in db.query(TwinSearch.request_key, func.max(TwinSearch.query))
        .filter(TwinSearch.request_key.in_(list(set(by_link.values())) or [""]))
        .group_by(TwinSearch.request_key)
    }
    new_after = datetime.now(timezone.utc) - timedelta(days=TWIN_NEW_SELLER_DAYS)
    items = []
    for l, s in shown:
        q = queries.get(by_link.get(l.id, ""))
        merchant = l.product.merchant
        items.append(
            CreatorTwin(
                link_id=l.id,
                video_post_id=l.video_post_id,
                product=ProductRead.model_validate(l.product),
                seller_name=merchant.business_name if merchant is not None else None,
                new_seller=bool(merchant is not None and merchant.created_at >= new_after),
                for_query=q,
                match=wt.match_label(wt.text_score(q, l.product)) if q else None,
                kept=states[l.id].buyers,
                state=s,
                start_ms=l.start_ms,
                end_ms=l.end_ms,
            )
        )
    return CreatorTwins(**counts, items=items)
