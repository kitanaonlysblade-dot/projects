"""Twin search: the database side.

* ``find_matches``      - catalog products that answer a description (ranked).
* ``moment_matches``    - what is already known about a video moment: the seller's
                          own twins, then moment links shoppers have confirmed.
* ``run_search``        - the whole "what is this?" flow; stores the TwinSearch.
* ``notify_waiting_searches`` - when a product is listed/edited, tell shoppers who
                          searched for something like it and found nothing.
* ``record_pick``       - a shopper added a result to cart / bought it: that is the
                          ground truth that feeds the video-moment index.
* ``keyword_insights``  - demand data for merchants.
"""
from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, or_
from sqlalchemy.orm import Session, joinedload

from app.models import (
    CategoryBanner,
    Notification,
    NotificationType,
    Product,
    TwinReviewStatus,
    TwinSearch,
    TwinSearchStatus,
    User,
    VideoMomentProduct,
    VideoPost,
    VideoPostTwin,
)
from app import twin_config
from app.twin_config import (
    INSIGHTS_PREVIEW_KEYWORDS,
    SEARCH_CLOSEST_MAX,
    SEARCH_CLOSEST_MIN_SCORE,
    SEARCH_MAX_RESULTS,
    SEARCH_MIN_SCORE,
    SEARCH_WAIT_DAYS,
    WANTED_BOX_MIN_IOU,
    WANTED_MERGE_MIN_IOU,
    WANTED_MIN_USERS,
)
from app import moment_index
from app.twin_match import normalize_query, score_product, tokens
from app.twin_pool import family_root_id, overlaps
from app.visibility import hide_shadow_banned_products

log = logging.getLogger(__name__)

_MAX_CANDIDATES = 300
_MAX_WAITING_SCANNED = 2000


@dataclass
class Hit:
    product: Product
    score: float
    source: str  # twin | crowd | search


def _like_prefix(token: str) -> str:
    # One letter short, so "berry" still finds "berries".
    return token if len(token) <= 4 else token[:-1]


def _extra_attrs(product: Product) -> list[str]:
    banner = product.banner
    if banner is None:
        return []
    return [banner.title, banner.category.name if banner.category is not None else ""]


def find_matches(
    db: Session,
    query: str,
    *,
    category_id: uuid.UUID | None = None,
    current_user: User | None = None,
    limit: int = SEARCH_MAX_RESULTS,
    exclude_ids: set[uuid.UUID] | None = None,
    min_score: float = SEARCH_MIN_SCORE,
) -> list[Hit]:
    q_tokens = tokens(query)
    if not q_tokens:
        return []

    text_match = or_(
        *[
            or_(
                Product.name.ilike(f"%{_like_prefix(t)}%"),
                Product.description.ilike(f"%{_like_prefix(t)}%"),
                func.array_to_string(Product.colors, " ").ilike(f"%{_like_prefix(t)}%"),
            )
            for t in q_tokens
        ]
    )
    # Text-only and local: nothing from the clip is sent to any outside model.
    cq = (
        db.query(Product)
        .options(joinedload(Product.images), joinedload(Product.banner).joinedload(CategoryBanner.category))
        .outerjoin(CategoryBanner, Product.banner_id == CategoryBanner.id)
        .filter(text_match)
    )
    if category_id is not None:
        cq = cq.filter(CategoryBanner.category_id == category_id)
    cq = hide_shadow_banned_products(cq, current_user)
    if exclude_ids:
        cq = cq.filter(Product.id.notin_(exclude_ids))
    candidates = cq.order_by(Product.created_at.desc()).limit(_MAX_CANDIDATES).all()

    scored = [(p, score_product(q_tokens, p, _extra_attrs(p))) for p in candidates]
    hits: list[Hit] = []
    for p, m in scored:
        eligible = m.base
        if eligible < min_score:
            continue  # quality bonus never rescues a non-match
        hits.append(Hit(p, eligible + (m.rank - m.base), "search"))  # may exceed 1.0: ordering only
    hits.sort(key=lambda h: (not h.product.in_stock, -h.score))
    return hits[:limit]


def root_post(db: Session, post: VideoPost) -> VideoPost:
    if post.repost_of_id is not None:
        post = db.get(VideoPost, post.repost_of_id) or post
    if post.retwin_of_id is not None:  # legacy rows
        post = db.get(VideoPost, post.retwin_of_id) or post
    return post


def moment_matches(db: Session, post_id: uuid.UUID, start_ms: int, end_ms: int) -> list[Hit]:
    """Products already known to be on screen at this moment."""
    out: dict[uuid.UUID, Hit] = {}
    twins = (
        db.query(VideoPostTwin)
        .options(joinedload(VideoPostTwin.product).joinedload(Product.images))
        .filter(VideoPostTwin.video_post_id == post_id, VideoPostTwin.review_status != TwinReviewStatus.flagged)
        .all()
    )
    for t in twins:
        if overlaps(start_ms, end_ms, t.start_ms, t.end_ms):
            out[t.product_id] = Hit(t.product, 1.0, "twin")
    # Crowd links: only those that pass every check in app/moment_index.py, and only
    # where the searched clip really covers the moment (not any one-millisecond touch).
    for link, state in sorted(moment_index.trusted_links(db, post_id), key=lambda ls: -ls[1].confidence):
        if link.product_id not in out and moment_index.covers(start_ms, end_ms, link.start_ms, link.end_ms):
            out[link.product_id] = Hit(link.product, state.confidence, "crowd")
    return list(out.values())


def moment_products(db: Session, post_id: uuid.UUID) -> list[tuple[VideoMomentProduct | VideoPostTwin, str]]:
    """Everything known about a video's moments, for features that show twins later."""
    twins = (
        db.query(VideoPostTwin)
        .options(joinedload(VideoPostTwin.product).joinedload(Product.images))
        .filter(VideoPostTwin.video_post_id == post_id, VideoPostTwin.review_status != TwinReviewStatus.flagged)
        .order_by(VideoPostTwin.start_ms)
        .all()
    )
    links = moment_index.trusted_links(db, post_id)
    return [(t, "twin") for t in twins] + [(link, "crowd") for link, _ in links]


def _same_ask(existing: TwinSearch, start_ms: int | None, end_ms: int | None) -> bool:
    if existing.start_ms is None or start_ms is None:
        return existing.start_ms is None and start_ms is None
    return overlaps(existing.start_ms, existing.end_ms, start_ms, end_ms)


def closest_matches(
    db: Session, query: str, *, category_id: uuid.UUID | None, current_user: User | None
) -> list[Hit]:
    """When nothing matched: the nearest things we do have, clearly second-best."""
    return find_matches(
        db,
        query,
        category_id=category_id,
        current_user=current_user,
        limit=SEARCH_CLOSEST_MAX,
        min_score=SEARCH_CLOSEST_MIN_SCORE,
    )


def save_closest(db: Session, search: TwinSearch, closest: list[Hit]) -> None:
    search.closest_ids = [h.product.id for h in closest]
    db.commit()


def _unmet_on_video(db: Session, root_id: uuid.UUID) -> list[TwinSearch]:
    return (
        db.query(TwinSearch)
        .filter(
            TwinSearch.video_post_id == root_id,
            TwinSearch.start_ms.isnot(None),
            TwinSearch.end_ms.isnot(None),
            TwinSearch.status.in_([TwinSearchStatus.not_found, TwinSearchStatus.available]),
            TwinSearch.request_key != "",
        )
        .order_by(TwinSearch.created_at)
        .all()
    )


# (left, top, width, height) as fractions of the frame.
Box = tuple[float, float, float, float]


def box_iou(a: Box, b: Box) -> float:
    iw = min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0])
    ih = min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1])
    if iw <= 0 or ih <= 0:
        return 0.0
    inter = iw * ih
    return inter / (a[2] * a[3] + b[2] * b[3] - inter)


def row_box(r: TwinSearch) -> Box | None:
    if r.box_x is None or r.box_y is None or r.box_w is None or r.box_h is None:
        return None
    return r.box_x, r.box_y, r.box_w, r.box_h


def same_moment(
    a_start: int, a_end: int, b_start: int, b_end: int, a_query: str, b_query: str, a_box: Box | None = None, b_box: Box | None = None
) -> bool:
    """Do two asks about one video mean the same moment? Clips that mostly coincide do;
    clips that merely overlap do when the words share a meaningful token. When both
    circled something, the circles must overlap too: the jacket and the bag in one frame
    are different requests."""
    if not overlaps(a_start, a_end, b_start, b_end):
        return False
    if a_box is not None and b_box is not None and box_iou(a_box, b_box) < WANTED_BOX_MIN_IOU:
        return False
    if moment_index.iou(a_start, a_end, b_start, b_end) >= WANTED_MERGE_MIN_IOU:
        return True
    return bool(set(tokens(a_query)) & set(tokens(b_query)))


def nearby_requests(
    db: Session, root_id: uuid.UUID, start_ms: int, end_ms: int, query: str = "", box: Box | None = None
) -> list[TwinSearch]:
    """One representative (earliest) row per existing request on this moment of the video."""
    seen: dict[str, TwinSearch] = {}
    for r in _unmet_on_video(db, root_id):
        if r.request_key in seen:
            continue
        if same_moment(start_ms, end_ms, r.start_ms, r.end_ms, query, r.query, box, row_box(r)):
            seen[r.request_key] = r
    return list(seen.values())


@dataclass
class MomentSignals:
    asked: int  # other shoppers who asked about this moment
    circled: int  # of those, how many circled the same thing
    words: list[tuple[str, int]]  # words several different shoppers used, most common first


def moment_signals(
    db: Session, root_id: uuid.UUID, start_ms: int, end_ms: int, box: Box | None, viewer_id: uuid.UUID | None
) -> MomentSignals:
    """What other shoppers did on this moment of the video: only counts and words that at
    least WANTED_MIN_USERS different people used, never who said what."""
    rows = (
        db.query(TwinSearch)
        .filter(TwinSearch.video_post_id == root_id, TwinSearch.start_ms.isnot(None), TwinSearch.end_ms.isnot(None))
        .order_by(TwinSearch.created_at.desc())
        .limit(500)
        .all()
    )
    asked: set[uuid.UUID] = set()
    circled: set[uuid.UUID] = set()
    by_word: dict[str, set[uuid.UUID]] = {}
    for r in rows:
        if r.user_id == viewer_id or not overlaps(start_ms, end_ms, r.start_ms, r.end_ms):
            continue
        rb = row_box(r)
        if box is not None and rb is not None and box_iou(box, rb) < WANTED_BOX_MIN_IOU:
            continue  # they circled something else
        asked.add(r.user_id)
        if box is not None and rb is not None:
            circled.add(r.user_id)
        for w in tokens(r.query):
            by_word.setdefault(w, set()).add(r.user_id)
    words = sorted(((w, len(u)) for w, u in by_word.items() if len(u) >= WANTED_MIN_USERS), key=lambda x: (-x[1], x[0]))
    return MomentSignals(len(asked), len(circled), words[:6])


def assign_request_key(
    db: Session, root_id: uuid.UUID | None, start_ms: int | None, end_ms: int | None, query: str, key: str, box: Box | None = None
) -> str:
    """The Wanted request a new ask joins: an existing one for the same moment of the
    same video, otherwise its own words."""
    if root_id is None or start_ms is None or end_ms is None:
        return key
    found = nearby_requests(db, root_id, start_ms, end_ms, query, box)
    return found[0].request_key if found else key


def run_search(
    db: Session,
    user: User,
    *,
    query: str,
    category_id: uuid.UUID | None,
    post: VideoPost | None,
    start_ms: int | None,
    end_ms: int | None,
    join_key: str | None = None,
    box: Box | None = None,
    box_at_ms: int | None = None,
) -> tuple[TwinSearch, list[Hit]]:
    root = root_post(db, post) if post is not None else None
    root_id = root.id if root is not None else None
    key = normalize_query(query)

    hits: list[Hit] = []
    if root is not None and start_ms is not None and end_ms is not None:
        hits = moment_matches(db, family_root_id(root), start_ms, end_ms)
    seen = {h.product.id for h in hits}
    hits += find_matches(db, query, category_id=category_id, current_user=user, exclude_ids=seen)
    hits = hits[:SEARCH_MAX_RESULTS]

    # The same shopper asking the same thing again updates their row instead of
    # piling up duplicates: still-waiting searches always, others within a day.
    day_ago = datetime.now(timezone.utc) - timedelta(days=1)
    prior = (
        db.query(TwinSearch)
        .filter(
            TwinSearch.user_id == user.id,
            TwinSearch.query_key == key,
            TwinSearch.video_post_id.is_(None) if root_id is None else TwinSearch.video_post_id == root_id,
            or_(TwinSearch.status.in_([TwinSearchStatus.not_found, TwinSearchStatus.available]), TwinSearch.created_at >= day_ago),
        )
        .order_by(TwinSearch.created_at.desc())
        .all()
    )
    row = next((r for r in prior if _same_ask(r, start_ms, end_ms)), None)
    if row is None:
        row = TwinSearch(user_id=user.id, video_post_id=root_id, start_ms=start_ms, end_ms=end_ms, query_key=key, request_key=join_key or assign_request_key(db, root_id, start_ms, end_ms, query, key, box), query=query)
        db.add(row)
    if box is not None:
        row.box_x, row.box_y, row.box_w, row.box_h = box
        row.box_at_ms = box_at_ms
    row.query = query
    row.category_id = category_id
    row.result_count = len(hits)
    row.result_ids = [h.product.id for h in hits]
    row.closest_ids = []
    row.best_score = max((h.score for h in hits), default=0.0)
    if hits:
        row.status = TwinSearchStatus.matched
    elif row.status != TwinSearchStatus.not_found:  # a brand-new row has no status yet
        row.status = TwinSearchStatus.not_found
        row.notified_at = None
        row.matched_product_id = None
    db.commit()
    db.refresh(row)
    return row, hits


def record_pick(db: Session, user: User, search: TwinSearch, product: Product, action: str, *, exact: bool = True) -> TwinSearch:
    """The shopper added a result to cart / tapped buy. That ends their wait, but it is
    only the START of evidence for the video-moment index: add_evidence decides whether
    it counts, and the link is trusted later, from kept purchases (app/moment_index.py)."""
    if search.picked_product_id is not None or not exact:
        return search
    search.picked_product_id = product.id
    search.status = TwinSearchStatus.fulfilled
    if search.video_post_id is not None:
        moment_index.add_evidence(db, user, search, product, action, db.get(VideoPost, search.video_post_id))
    db.commit()
    db.refresh(search)
    return search


def notify_waiting_searches(db: Session, product: Product) -> int:
    """Called when a product is listed or its words change: anyone who searched for
    something like it and found nothing hears about it once. Returns how many were told.
    Never raises - listing a product must not fail because of this. Does nothing while
    twins are switched off (app/twin_config.enabled)."""
    if not twin_config.enabled():
        return 0
    try:
        with db.begin_nested():
            return _notify_waiting(db, product)
    except Exception:  # noqa: BLE001
        log.exception("twin search waitlist matching failed for product %s", product.id)
        return 0


def _notify_waiting(db: Session, product: Product) -> int:
    product_tokens = tokens(f"{product.name} {product.description or ''} {' '.join(product.colors or [])}")[:40]
    if not product_tokens:
        return 0
    since = datetime.now(timezone.utc) - timedelta(days=SEARCH_WAIT_DAYS)
    waiting = (
        db.query(TwinSearch)
        .filter(
            TwinSearch.status == TwinSearchStatus.not_found,
            TwinSearch.notify.is_(True),
            TwinSearch.created_at >= since,
            or_(*[TwinSearch.query_key.ilike(f"%{_like_prefix(t)}%") for t in product_tokens]),
        )
        .order_by(TwinSearch.created_at.desc())
        .limit(_MAX_WAITING_SCANNED)
        .all()
    )
    if not waiting:
        return 0
    banner = product.banner
    product_category = banner.category_id if banner is not None else None
    owner_user_id = product.merchant.user_id if product.merchant is not None else None
    extras = _extra_attrs(product)

    told = 0
    for s in waiting:
        if s.user_id == owner_user_id:
            continue
        if s.category_id is not None and s.category_id != product_category:
            continue
        if score_product(tokens(s.query), product, extras).base < SEARCH_MIN_SCORE:
            continue
        s.status = TwinSearchStatus.available
        s.matched_product_id = product.id
        s.notified_at = datetime.now(timezone.utc)
        db.add(
            Notification(
                user_id=s.user_id,
                body=f"A twin for “{s.query[:120]}” just landed: {product.name[:120]}.",
                type=NotificationType.twin_available,
                target_id=product.id,
            )
        )
        told += 1
    return told


@dataclass
class KeywordRow:
    keyword: str
    example: str
    searchers: int
    searches: int
    unmet_searchers: int
    last_searched_at: datetime


def keyword_insights(
    db: Session, *, days: int, limit: int, category_id: uuid.UUID | None, unlocked: bool
) -> list[KeywordRow]:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    unmet = func.count(func.distinct(TwinSearch.user_id)).filter(
        TwinSearch.status.in_([TwinSearchStatus.not_found])
    )
    q = (
        db.query(
            TwinSearch.query_key,
            func.max(TwinSearch.query),
            func.count(func.distinct(TwinSearch.user_id)),
            func.count(TwinSearch.id),
            unmet,
            func.max(TwinSearch.created_at),
        )
        .filter(TwinSearch.created_at >= since, TwinSearch.query_key != "")
    )
    if category_id is not None:
        q = q.filter(TwinSearch.category_id == category_id)
    # Biggest unmet demand first - that is what a merchant can act on - then overall interest.
    rows = (
        q.group_by(TwinSearch.query_key)
        .order_by(unmet.desc(), func.count(func.distinct(TwinSearch.user_id)).desc(), func.max(TwinSearch.created_at).desc())
        .limit(limit if unlocked else INSIGHTS_PREVIEW_KEYWORDS)
        .all()
    )
    return [KeywordRow(*r) for r in rows]
