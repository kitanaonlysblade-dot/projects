"""The moment->product index ("video Shazam"), built to be accurate rather than big.

Adding to cart is not proof a product is in a video: people cart similar things,
gifts, impulse buys. So a single pick is never trusted. Evidence is layered:

1. Intent: a pick only counts if the shopper clipped that moment (<= a few seconds),
   described it, and the product fits their words well (``text_score``, stricter than
   merely showing a result). Picks of "closest we have" consolations never count.
2. One voice each: one vote per shopper per link; the product's own seller and the
   video's own poster can't vouch; a shopper can vouch for few products per video.
3. Kept: only a purchase that stuck makes a buyer - order delivered, the 24h claim
   window passed, no return claim. Cancelled or returned orders simply stop counting.
   Carts don't reach the buyer threshold; they only add a little to the share below.
4. Agreement: several different buyers are needed, and the product must hold a
   majority of the support among rivals picked for the same moment.
5. A real moment: the link's range is the median of the clips, not the first clip.
6. Freshness: evidence expires.
7. The video's poster has the last word: confirm a link early, or reject it for good.

Trust is computed from the evidence on every read, never stored as a flag.
"""
from __future__ import annotations

import statistics
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.models import MomentEvidence, Order, OrderStatus, Product, ReturnClaim, ReturnClaimStatus, TwinSearch, VideoMomentProduct, VideoPost
from app.return_policy import CLAIM_WINDOW
from app.twin_config import (
    MOMENT_CART_WEIGHT,
    MOMENT_EVIDENCE_MAX_CLIP_MS,
    MOMENT_EVIDENCE_MIN_SCORE,
    MOMENT_EVIDENCE_TTL_DAYS,
    MOMENT_LINK_MIN_IOU,
    MOMENT_MAX_PER_USER_VIDEO,
    MOMENT_MIN_BUYERS,
    MOMENT_MIN_SHARE,
    MOMENT_PURCHASE_WINDOW_DAYS,
    MOMENT_QUERY_MIN_OVERLAP,
)
from app.twin_match import score_product, tokens


def iou(a_start: int, a_end: int, b_start: int, b_end: int) -> float:
    inter = min(a_end, b_end) - max(a_start, b_start)
    if inter <= 0:
        return 0.0
    return inter / (max(a_end, b_end) - min(a_start, b_start))


def covers(q_start: int, q_end: int, l_start: int, l_end: int) -> bool:
    """Does the searched clip cover enough of the link (or the link of the clip)?"""
    inter = min(q_end, l_end) - max(q_start, l_start)
    shorter = min(q_end - q_start, l_end - l_start)
    return inter > 0 and shorter > 0 and inter / shorter >= MOMENT_QUERY_MIN_OVERLAP


@dataclass
class LinkState:
    trusted: bool
    buyers: int  # distinct shoppers who bought it and kept it
    shoppers: int  # distinct live voters
    share: float  # of the support among rivals for this moment
    confidence: float  # 0..1, what a result is scored as


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _live(link: VideoMomentProduct, now: datetime) -> list[MomentEvidence]:
    cutoff = now - timedelta(days=MOMENT_EVIDENCE_TTL_DAYS)
    return [e for e in link.evidence if e.created_at >= cutoff]


def _kept_buyers(db: Session, links: list[VideoMomentProduct], now: datetime) -> dict[uuid.UUID, set[uuid.UUID]]:
    """link id -> shoppers who bought that link's product after voting and kept it."""
    pairs = {(e.user_id, l.product_id) for l in links for e in l.evidence}
    if not pairs:
        return {}
    users = {u for u, _ in pairs}
    products = {p for _, p in pairs}
    kept_before = now - CLAIM_WINDOW
    orders = (
        db.query(Order)
        .filter(
            Order.buyer_id.in_(users),
            Order.product_id.in_(products),
            Order.status == OrderStatus.delivered,
            Order.delivered_at.isnot(None),
            Order.delivered_at <= kept_before,
        )
        .all()
    )
    claimed = {
        c.order_id
        for c in db.query(ReturnClaim).filter(
            ReturnClaim.order_id.in_([o.id for o in orders] or [uuid.uuid4()]),
            ReturnClaim.status != ReturnClaimStatus.denied,
        )
    }
    window = timedelta(days=MOMENT_PURCHASE_WINDOW_DAYS)
    out: dict[uuid.UUID, set[uuid.UUID]] = {}
    for l in links:
        for e in l.evidence:
            for o in orders:
                if o.buyer_id == e.user_id and o.product_id == l.product_id and o.id not in claimed:
                    if e.created_at <= o.created_at <= e.created_at + window:
                        out.setdefault(l.id, set()).add(e.user_id)
    return out


def assess(db: Session, links: list[VideoMomentProduct]) -> dict[uuid.UUID, LinkState]:
    """Trust state of each link, judged against every link of the same video (rivals)."""
    now = _now()
    if not links:
        return {}
    post_ids = {l.video_post_id for l in links}
    everyone = db.query(VideoMomentProduct).filter(VideoMomentProduct.video_post_id.in_(post_ids)).all()
    kept = _kept_buyers(db, everyone, now)

    support: dict[uuid.UUID, float] = {}
    live: dict[uuid.UUID, list[MomentEvidence]] = {}
    for l in everyone:
        ev = _live(l, now)
        live[l.id] = ev
        if l.review == "rejected":
            support[l.id] = 0.0
            continue
        buyers = kept.get(l.id, set())
        carters = {e.user_id for e in ev} - buyers
        support[l.id] = len(buyers & {e.user_id for e in ev}) + MOMENT_CART_WEIGHT * len(carters)

    out: dict[uuid.UUID, LinkState] = {}
    for l in links:
        ev = live.get(l.id, [])
        buyers = len(kept.get(l.id, set()) & {e.user_id for e in ev})
        rivals = [
            support[r.id]
            for r in everyone
            if r.video_post_id == l.video_post_id and iou(l.start_ms, l.end_ms, r.start_ms, r.end_ms) >= 0.3
        ]
        total = sum(rivals) or 0.0
        share = (support[l.id] / total) if total > 0 else 0.0
        if l.review == "confirmed":
            out[l.id] = LinkState(True, buyers, len({e.user_id for e in ev}), share, 0.95)
        elif l.review == "rejected":
            out[l.id] = LinkState(False, buyers, len({e.user_id for e in ev}), share, 0.0)
        else:
            trusted = buyers >= MOMENT_MIN_BUYERS and share >= MOMENT_MIN_SHARE
            conf = min(0.9, 0.6 + 0.1 * (buyers - MOMENT_MIN_BUYERS)) if trusted else 0.0
            out[l.id] = LinkState(trusted, buyers, len({e.user_id for e in ev}), share, conf)
    return out


def trusted_links(db: Session, post_id: uuid.UUID) -> list[tuple[VideoMomentProduct, LinkState]]:
    from sqlalchemy.orm import joinedload

    links = (
        db.query(VideoMomentProduct)
        .options(joinedload(VideoMomentProduct.product).joinedload(Product.images), joinedload(VideoMomentProduct.evidence))
        .filter(VideoMomentProduct.video_post_id == post_id, VideoMomentProduct.review.is_distinct_from("rejected"))
        .order_by(VideoMomentProduct.start_ms)
        .all()
    )
    states = assess(db, links)
    return [(l, states[l.id]) for l in links if states[l.id].trusted]


def candidate_links(db: Session, post_id: uuid.UUID) -> list[tuple[VideoMomentProduct, LinkState]]:
    """Every link not yet trusted or rejected - for the poster to confirm or reject early."""
    from sqlalchemy.orm import joinedload

    links = (
        db.query(VideoMomentProduct)
        .options(joinedload(VideoMomentProduct.product).joinedload(Product.images), joinedload(VideoMomentProduct.evidence))
        .filter(VideoMomentProduct.video_post_id == post_id, VideoMomentProduct.review.is_(None))
        .order_by(VideoMomentProduct.start_ms)
        .all()
    )
    states = assess(db, links)
    return [(l, states[l.id]) for l in links if not states[l.id].trusted]


def _text_score(search: TwinSearch, product: Product) -> float:
    from app.twin_search_service import _extra_attrs

    q = tokens(search.query)
    return score_product(q, product, _extra_attrs(product)).base if q else 0.0


def add_evidence(db: Session, user, search: TwinSearch, product: Product, action: str, post: VideoPost | None) -> bool:
    """Record one shopper's vote if (and only if) it is real evidence. Returns whether
    it counted. Never raises for "doesn't qualify" - the pick itself still succeeded."""
    if post is None or search.video_post_id is None or search.start_ms is None or search.end_ms is None:
        return False
    if search.end_ms - search.start_ms > MOMENT_EVIDENCE_MAX_CLIP_MS:
        return False
    if product.merchant is not None and product.merchant.user_id == user.id:
        return False  # a seller can't vouch for their own product
    if post.poster_id == user.id:
        return False  # the poster has twin tagging and the confirm button
    score = _text_score(search, product)
    if score < MOMENT_EVIDENCE_MIN_SCORE:
        return False  # picked it, but not because it matched what they described

    mine = db.query(MomentEvidence).filter(MomentEvidence.user_id == user.id, MomentEvidence.video_post_id == post.id).all()
    existing = next((e for e in mine if e.product_id == product.id and iou(e.start_ms, e.end_ms, search.start_ms, search.end_ms) >= MOMENT_LINK_MIN_IOU), None)
    if existing is None and len({e.product_id for e in mine}) >= MOMENT_MAX_PER_USER_VIDEO:
        return False

    link = next(
        (
            l
            for l in db.query(VideoMomentProduct).filter(
                VideoMomentProduct.video_post_id == post.id, VideoMomentProduct.product_id == product.id
            )
            if iou(l.start_ms, l.end_ms, search.start_ms, search.end_ms) >= MOMENT_LINK_MIN_IOU
        ),
        None,
    )
    if link is not None and link.review == "rejected":
        return False
    if link is None:
        link = VideoMomentProduct(video_post_id=post.id, product_id=product.id, start_ms=search.start_ms, end_ms=search.end_ms, confirmations=0)
        db.add(link)
        db.flush()

    ev = next((e for e in link.evidence if e.user_id == user.id), None)
    if ev is None:
        ev = MomentEvidence(link_id=link.id, user_id=user.id, video_post_id=post.id, product_id=product.id,
                            start_ms=search.start_ms, end_ms=search.end_ms, text_score=score, kind=action)
        db.add(ev)
        link.evidence.append(ev)
    else:  # same shopper again: refresh their one vote, never add a second
        ev.start_ms, ev.end_ms, ev.text_score = search.start_ms, search.end_ms, max(ev.text_score, score)
        if action == "buy":
            ev.kind = "buy"
    link.start_ms = int(statistics.median(e.start_ms for e in link.evidence))
    link.end_ms = int(statistics.median(e.end_ms for e in link.evidence))
    if link.end_ms <= link.start_ms:
        link.end_ms = link.start_ms + 1
    link.confirmations = len({e.user_id for e in link.evidence})
    link.last_confirmed_at = _now()
    return True
