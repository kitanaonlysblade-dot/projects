"""The Wanted board: unmet twin searches, made public.

There is no separate "request" table. A request is a group of TwinSearch rows that
share a ``request_key`` (the same words in any order, or the same moment of the same video) and were not matched when they were
made: the shoppers who asked for it. So:

* a request's count is the number of different shoppers in the group;
* "upvote" is simply another shopper making the same search (and so is notified like
  the rest when a twin turns up);
* open = at least one of them is still waiting; fulfilled = everyone has been told.

Requests only appear on the public board once WANTED_MIN_USERS different shoppers want
them, so one person's free text isn't published the moment they type it.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import false, func, or_, select
from sqlalchemy.orm import Session, joinedload

from app.models import (
    Notification,
    NotificationType,
    Product,
    TwinSearch,
    TwinSearchStatus,
    User,
    VideoPost,
    WantedOffer,
)
from app import wanted_twins
from app.twin_config import SEARCH_WAIT_DAYS, WANTED_MIN_USERS, WANTED_NEARBY_MAX
from app.twin_search_service import Hit, nearby_requests, root_post, row_box, run_search

UNMET = (TwinSearchStatus.not_found, TwinSearchStatus.available)
_PAGE_MAX = 50
_MOST_TWINNED_POOL = 60


def _group_columns():
    users = func.count(func.distinct(TwinSearch.user_id))
    open_users = func.count(func.distinct(TwinSearch.user_id)).filter(TwinSearch.status == TwinSearchStatus.not_found)
    return users, open_users


def _grouped(db: Session, tab: str, user: User | None = None):
    """Query of (request_key, users, open_users, first_at, last_at, recent, has_clip), one row
    per listed request on this tab, in tab order.

    A request stays on the wall while it is still open OR a seller has twinned something
    to it (so "6 twinned" tiles keep showing); only a request nobody is waiting on and
    nobody has offered for moves to Fulfilled. "mine" is the requests the viewer is part
    of, listed even before enough others join."""
    users, open_users = _group_columns()
    week_ago = datetime.now(timezone.utc) - timedelta(days=7)
    recent = func.count(TwinSearch.id).filter(TwinSearch.created_at >= week_ago)
    first_at = func.min(TwinSearch.created_at)
    last_at = func.max(TwinSearch.created_at)
    q = db.query(
        TwinSearch.request_key,
        users,
        open_users,
        first_at,
        last_at,
        recent,
        func.bool_or(TwinSearch.video_post_id.isnot(None)),
    ).filter(TwinSearch.status.in_(UNMET), TwinSearch.request_key != "")
    if tab == "mine":
        if user is None:
            return q.filter(false()).group_by(TwinSearch.request_key).order_by(last_at.desc())
        mine_keys = select(TwinSearch.request_key).where(TwinSearch.user_id == user.id, TwinSearch.status.in_(UNMET))
        return q.filter(TwinSearch.request_key.in_(mine_keys)).group_by(TwinSearch.request_key).order_by(last_at.desc())
    q = q.group_by(TwinSearch.request_key).having(users >= WANTED_MIN_USERS)
    if tab == "fulfilled":
        return q.having(open_users == 0).order_by(last_at.desc())
    q = q.having(or_(open_users > 0, TwinSearch.request_key.in_(select(WantedOffer.request_key))))
    if tab == "new":
        return q.order_by(first_at.desc())
    return q.order_by(recent.desc(), users.desc())  # trending (and the pool "most_twinned" sorts)


def _representatives(db: Session, keys: list[str]) -> dict[str, TwinSearch]:
    """Earliest search of each request: its handle, wording and (via _clip_row) moment."""
    if not keys:
        return {}
    rows = (
        db.query(TwinSearch)
        .filter(TwinSearch.request_key.in_(keys), TwinSearch.status.in_(UNMET))
        .distinct(TwinSearch.request_key)
        .order_by(TwinSearch.request_key, TwinSearch.created_at)
        .all()
    )
    return {r.request_key: r for r in rows}


def _clip_rows(db: Session, keys: list[str]) -> dict[str, TwinSearch]:
    if not keys:
        return {}
    rows = (
        db.query(TwinSearch)
        .filter(TwinSearch.request_key.in_(keys), TwinSearch.status.in_(UNMET), TwinSearch.video_post_id.isnot(None))
        .distinct(TwinSearch.request_key)
        .order_by(TwinSearch.request_key, TwinSearch.created_at)
        .all()
    )
    return {r.request_key: r for r in rows}


def _fulfilled_products(db: Session, keys: list[str]) -> dict[str, Product]:
    if not keys:
        return {}
    rows = (
        db.query(TwinSearch)
        .options(joinedload(TwinSearch.matched_product).joinedload(Product.images))
        .filter(TwinSearch.request_key.in_(keys), TwinSearch.matched_product_id.isnot(None), TwinSearch.status.in_(UNMET))
        .distinct(TwinSearch.request_key)
        .order_by(TwinSearch.request_key, TwinSearch.created_at.desc())
        .all()
    )
    return {r.request_key: r.matched_product for r in rows if r.matched_product is not None}


def _mine(db: Session, user: User | None, keys: list[str]) -> dict[str, bool]:
    """key -> is the bell on, for the requests this shopper is part of."""
    if user is None or not keys:
        return {}
    out: dict[str, bool] = {}
    for r in db.query(TwinSearch).filter(
        TwinSearch.user_id == user.id, TwinSearch.request_key.in_(keys), TwinSearch.status.in_(UNMET)
    ):
        out[r.request_key] = out.get(r.request_key, False) or bool(r.notify)
    return out


def _clip_tuple(clip: TwinSearch | None) -> wanted_twins.Clip | None:
    if clip is None or clip.video_post_id is None or clip.start_ms is None or clip.end_ms is None:
        return None
    return clip.video_post_id, clip.start_ms, clip.end_ms


def _posts(db: Session, clips: dict[str, TwinSearch]) -> dict[uuid.UUID, VideoPost]:
    ids = {c.video_post_id for c in clips.values() if c.video_post_id is not None}
    if not ids:
        return {}
    rows = db.query(VideoPost).options(joinedload(VideoPost.poster)).filter(VideoPost.id.in_(ids)).all()
    return {p.id: p for p in rows}


def _box_dict(clip: TwinSearch | None) -> dict | None:
    b = row_box(clip) if clip is not None else None
    return None if b is None else {"x": b[0], "y": b[1], "w": b[2], "h": b[3]}


def _item(key, users, open_users, first_at, has_clip, rep, mine, product, clip, post, summary) -> dict:
    twinned, previews = summary
    return {
        "id": rep.id,
        "query": rep.query,
        "count": users,
        "status": "open" if open_users > 0 else "fulfilled",
        "upvoted": key in mine,
        "notifying": mine.get(key, False),
        "has_clip": bool(has_clip),
        "created_at": first_at,
        "fulfilled_product": product if open_users == 0 else None,
        "twinned": twinned,
        "twin_previews": previews,
        "video_post_id": clip.video_post_id if clip is not None else None,
        "start_ms": clip.start_ms if clip is not None else None,
        "end_ms": clip.end_ms if clip is not None else None,
        "box": _box_dict(clip),
        "box_at_ms": clip.box_at_ms if clip is not None and row_box(clip) is not None else None,
        "video_url": post.video_url if post is not None else None,
        "thumbnail_url": post.thumbnail_url if post is not None else None,
        "width": post.width if post is not None else None,
        "height": post.height if post is not None else None,
        "creator_name": post.poster.display_name if post is not None and post.poster is not None else None,
        "creator_avatar_url": post.poster.avatar_url if post is not None and post.poster is not None else None,
    }


def board(db: Session, user: User | None, tab: str, limit: int, offset: int) -> tuple[int, list[dict]]:
    # Subtitle number: how many requests are on the wall, whichever tab is showing.
    open_count = db.query(func.count()).select_from(_grouped(db, "new").order_by(None).subquery()).scalar() or 0
    page = min(limit, _PAGE_MAX)
    if tab == "most_twinned":
        # Twin counts come from the compare-list rules, not one column, so sort the busiest
        # requests (a bounded pool) in Python rather than approximating in SQL.
        pool = _grouped(db, "trending", user).limit(_MOST_TWINNED_POOL).all()
        clips_all = _clip_rows(db, [r[0] for r in pool])
        reps_all = _representatives(db, [r[0] for r in pool])
        counts = {
            r[0]: wanted_twins.twin_summary(db, r[0], reps_all[r[0]].query, _clip_tuple(clips_all.get(r[0])), user)
            for r in pool
            if r[0] in reps_all
        }
        rows = sorted((r for r in pool if r[0] in counts), key=lambda r: (-counts[r[0]][0], -r[1]))[offset : offset + page]
    else:
        rows = _grouped(db, tab, user).offset(offset).limit(page).all()
        counts = {}
    keys = [r[0] for r in rows]
    reps = _representatives(db, keys)
    clips = _clip_rows(db, keys)
    posts = _posts(db, clips)
    mine = _mine(db, user, keys)
    products = _fulfilled_products(db, [r[0] for r in rows if r[2] == 0])
    items = []
    for k, users, open_users, first_at, _last, _recent, has_clip in rows:
        if k not in reps:
            continue
        clip = clips.get(k)
        summary = counts[k] if k in counts else wanted_twins.twin_summary(db, k, reps[k].query, _clip_tuple(clip), user)
        post = posts.get(clip.video_post_id) if clip is not None and clip.video_post_id is not None else None
        items.append(_item(k, users, open_users, first_at, has_clip, reps[k], mine, products.get(k), clip, post, summary))
    return open_count, items


def _group_stats(db: Session, key: str):
    users, open_users = _group_columns()
    return (
        db.query(users, open_users, func.min(TwinSearch.created_at), func.bool_or(TwinSearch.video_post_id.isnot(None)))
        .filter(TwinSearch.request_key == key, TwinSearch.status.in_(UNMET))
        .one()
    )


def request_row(db: Session, request_id: uuid.UUID, user: User | None) -> TwinSearch | None:
    """The request's representative row, if it may be seen: listed on the board
    (enough shoppers) or one the viewer is part of."""
    row = db.get(TwinSearch, request_id)
    if row is None or row.status not in UNMET:
        return None
    users, *_ = _group_stats(db, row.request_key)
    if users >= WANTED_MIN_USERS:
        return row
    if user is not None and row.user_id == user.id:
        return row
    if user is not None and db.query(TwinSearch.id).filter(
        TwinSearch.user_id == user.id, TwinSearch.request_key == row.request_key, TwinSearch.status.in_(UNMET)
    ).first():
        return row
    return None


def detail(db: Session, row: TwinSearch, user: User | None) -> dict:
    key = row.request_key
    users, open_users, first_at, has_clip = _group_stats(db, key)
    rep = _representatives(db, [key]).get(key, row)
    mine = _mine(db, user, [key])
    product = _fulfilled_products(db, [key]).get(key)
    clip = _clip_rows(db, [key]).get(key)
    post = db.get(VideoPost, clip.video_post_id) if clip is not None and clip.video_post_id is not None else None
    summary = wanted_twins.twin_summary(db, key, rep.query, _clip_tuple(clip), user)
    out = _item(key, users, open_users, first_at, has_clip, rep, mine, product, clip, post, summary)

    # Anonymous activity: that someone joined, and when a twin was offered. No names -
    # the board shows demand, not who is asking.
    recent = (
        db.query(TwinSearch.created_at)
        .filter(TwinSearch.request_key == key, TwinSearch.status.in_(UNMET))
        .order_by(TwinSearch.created_at.desc())
        .limit(8)
        .all()
    )
    events = [{"kind": "wanted", "at": r[0]} for r in recent]
    listed_at = (
        db.query(func.max(TwinSearch.notified_at)).filter(TwinSearch.request_key == key, TwinSearch.notified_at.isnot(None)).scalar()
    )
    if listed_at is not None:
        events.append({"kind": "listed", "at": listed_at})
    out["events"] = sorted(events, key=lambda e: e["at"], reverse=True)[:10]
    return out


def join(db: Session, user: User, row: TwinSearch) -> tuple[TwinSearch, list[Hit]]:
    """"Me too": the same search, made by this shopper. If a twin exists by now the
    search simply matches and they're shown it instead of being added to the wait."""
    clip = _clip_rows(db, [row.request_key]).get(row.request_key)
    src = clip or row
    post = db.get(VideoPost, src.video_post_id) if src.video_post_id is not None else None
    return run_search(
        db,
        user,
        query=row.query,
        category_id=src.category_id,
        post=post,
        start_ms=src.start_ms,
        end_ms=src.end_ms,
        box=row_box(src),
        box_at_ms=src.box_at_ms,
        join_key=row.request_key,  # "me too" joins THIS request, even where clips of two overlap
    )


def leave(db: Session, user: User, key: str) -> int:
    n = (
        db.query(TwinSearch)
        .filter(TwinSearch.user_id == user.id, TwinSearch.request_key == key, TwinSearch.status.in_(UNMET))
        .delete(synchronize_session=False)
    )
    db.commit()
    return n


def set_bell(db: Session, user: User, key: str, notify: bool) -> int:
    n = (
        db.query(TwinSearch)
        .filter(TwinSearch.user_id == user.id, TwinSearch.request_key == key, TwinSearch.status.in_(UNMET))
        .update({TwinSearch.notify: notify}, synchronize_session=False)
    )
    db.commit()
    return n


def offer(db: Session, seller: User, row: TwinSearch, product: Product) -> int:
    """A seller says "I have this" (the "Twin it" button): the product is recorded against
    the request, on a video moment the poster can review it, and everyone still waiting
    (with the bell on) is told, once, and pointed at that product. Returns how many were
    told. Raises wanted_twins.OfferBlocked if the video's poster already hid this product
    for the moment."""
    clip = _clip_tuple(_clip_rows(db, [row.request_key]).get(row.request_key))
    _, created = wanted_twins.create_offer(db, seller, row.request_key, clip, product)
    if not created:
        db.commit()
        return 0
    since = datetime.now(timezone.utc) - timedelta(days=SEARCH_WAIT_DAYS)
    waiting = (
        db.query(TwinSearch)
        .filter(
            TwinSearch.request_key == row.request_key,
            TwinSearch.status == TwinSearchStatus.not_found,
            TwinSearch.notify.is_(True),
            TwinSearch.created_at >= since,
            TwinSearch.user_id != seller.id,
        )
        .all()
    )
    now = datetime.now(timezone.utc)
    told = 0
    for s in waiting:
        s.status = TwinSearchStatus.available
        s.matched_product_id = product.id
        s.notified_at = now
        db.add(
            Notification(
                user_id=s.user_id,
                body=f"A seller has a twin for “{s.query[:120]}”: {product.name[:120]}.",
                type=NotificationType.twin_available,
                target_id=product.id,
            )
        )
        told += 1
    db.commit()
    return told


def nearby(
    db: Session, user: User | None, post: VideoPost, start_ms: int, end_ms: int, query: str = "", box=None
) -> list[dict]:
    """Requests already on the wall for this moment of the video: what a shopper sees
    before creating a new one ("join before you create"). Only requests the viewer may
    see (listed, or their own), so one person's unlisted ask is never revealed."""
    root = root_post(db, post)
    out: list[dict] = []
    for rep in nearby_requests(db, root.id, start_ms, end_ms, query, box)[:WANTED_NEARBY_MAX]:
        if request_row(db, rep.id, user) is None:
            continue
        key = rep.request_key
        users, open_users, first_at, has_clip = _group_stats(db, key)
        clip = _clip_rows(db, [key]).get(key) or rep
        summary = wanted_twins.twin_summary(db, key, rep.query, _clip_tuple(clip), user)
        out.append(
            _item(key, users, open_users, first_at, has_clip, rep, _mine(db, user, [key]), None, clip, _posts(db, {key: clip}).get(root.id), summary)
        )
    return out
