"""The twins of a wanted moment: what the compare list shows, and how a seller adds one.

A request on the Wanted board (app/wanted_service.py) can have products twinned to it:

* official  - the video's own poster put it there (their own twin on that moment of
              the video, or their own "Twin it"). The poster is the one party who knows
              what is in their video, so this is the only kind labelled the exact item.
* confirmed - shoppers bought it for that moment and kept it (app/moment_index.py), or
              the poster approved it.
* offered   - a seller says it fits. Nothing more: an offer is a claim, never evidence,
              so it is shown as "Offered" and never feeds the moment index by itself.

Everything that is not official is only called "Similar" when an official twin exists
to compare it with; without one nobody can say what the exact item is.

Reports reuse the platform's Reports queue (kind ``product``): a twin reported by
TWIN_REPORT_HIDE_AT different shoppers is hidden from compare lists until an admin has
looked at it. One report never hides anything.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app import moment_index
from app.models import (
    CategoryBanner,
    MerchantAccount,
    Notification,
    NotificationType,
    Product,
    Report,
    ReportReason,
    ReportStatus,
    ReportTargetType,
    TwinReviewStatus,
    TwinSearch,
    User,
    VideoMomentProduct,
    VideoPost,
    VideoPostTwin,
    WantedOffer,
)
from app.twin_config import (
    MOMENT_LINK_MIN_IOU,
    SEARCH_MIN_SCORE,
    TWIN_MATCH_PARTIAL,
    TWIN_MATCH_STRONG,
    TWIN_REPORT_HIDE_AT,
)
from app.twin_match import score_product, tokens
from app.twin_pool import overlaps
from app.twin_search_service import _extra_attrs
from app.visibility import hide_shadow_banned_products

# (root video post id, start_ms, end_ms) of the moment a request was made on.
Clip = tuple[uuid.UUID, int, int]

_KIND_ORDER = {"official": 0, "confirmed": 1, "offered": 2}


class OfferBlocked(Exception):
    """The video's poster already hid this product for this moment."""


def match_label(score: float) -> str:
    if score >= TWIN_MATCH_STRONG:
        return "strong"
    if score >= SEARCH_MIN_SCORE:
        return "good"
    if score >= TWIN_MATCH_PARTIAL:
        return "partial"
    return "weak"


def text_score(query: str, product: Product) -> float:
    q = tokens(query)
    return score_product(q, product, _extra_attrs(product)).base if q else 0.0


@dataclass
class Option:
    product: Product
    kind: str
    score: float
    kept: int = 0
    mine: bool = False

    @property
    def match(self) -> str:
        return match_label(self.score)


def hidden_product_ids(db: Session, product_ids: list[uuid.UUID]) -> set[uuid.UUID]:
    """Products enough different shoppers have reported as twins to hide them for now."""
    if not product_ids:
        return set()
    rows = (
        db.query(Report.target_id, func.count(func.distinct(Report.reporter_id)))
        .filter(
            Report.target_type == ReportTargetType.product,
            Report.target_id.in_(product_ids),
            Report.status == ReportStatus.pending,
            Report.detail.like("twin:%"),
        )
        .group_by(Report.target_id)
        .all()
    )
    return {pid for pid, n in rows if n >= TWIN_REPORT_HIDE_AT}


def options(db: Session, key: str, query: str, clip: Clip | None, viewer: User | None) -> list[Option]:
    """Every twin of this request, official first, then best match."""
    found: dict[uuid.UUID, Option] = {}

    def put(product: Product, kind: str, kept: int = 0, mine: bool = False) -> None:
        cur = found.get(product.id)
        if cur is not None and _KIND_ORDER[cur.kind] <= _KIND_ORDER[kind]:
            cur.mine = cur.mine or mine
            cur.kept = max(cur.kept, kept)
            return
        found[product.id] = Option(product, kind, text_score(query, product), kept, mine or bool(cur and cur.mine))

    poster_id: uuid.UUID | None = None
    states: dict[uuid.UUID, moment_index.LinkState] = {}
    trusted: list[tuple[VideoMomentProduct, moment_index.LinkState]] = []
    if clip is not None:
        post_id, start, end = clip
        root = db.get(VideoPost, post_id)
        poster_id = root.poster_id if root is not None else None
        for t in (
            db.query(VideoPostTwin)
            .options(joinedload(VideoPostTwin.product).joinedload(Product.images))
            .filter(VideoPostTwin.video_post_id == post_id, VideoPostTwin.review_status != TwinReviewStatus.flagged)
        ):
            if overlaps(start, end, t.start_ms, t.end_ms):
                put(t.product, "official")
        trusted = moment_index.trusted_links(db, post_id)
        states = {l.id: st for l, st in trusted}

    offers = (
        db.query(WantedOffer)
        .options(
            joinedload(WantedOffer.product).joinedload(Product.images),
            joinedload(WantedOffer.link),
        )
        .filter(WantedOffer.request_key == key)
        .order_by(WantedOffer.created_at)
        .all()
    )
    for o in offers:
        link = o.link
        if link is not None and link.review == "rejected":
            continue  # the poster hid it
        mine = viewer is not None and o.seller_user_id == viewer.id
        st = states.get(link.id) if link is not None else None
        if poster_id is not None and o.seller_user_id == poster_id:
            kind = "official"
        elif st is not None:  # trusted: shoppers kept it, or the poster approved it
            kind = "confirmed"
        else:
            kind = "offered"
        put(o.product, kind, st.buyers if st is not None else 0, mine)

    if clip is not None:
        _, start, end = clip
        for link, st in trusted:
            if moment_index.covers(start, end, link.start_ms, link.end_ms):
                put(link.product, "confirmed", st.buyers)

    if not found:
        return []
    ids = list(found)
    visible = {r[0] for r in hide_shadow_banned_products(db.query(Product.id).filter(Product.id.in_(ids)), viewer)}
    hidden = hidden_product_ids(db, ids)
    out = [o for pid, o in found.items() if pid in visible and pid not in hidden]
    out.sort(key=lambda o: (_KIND_ORDER[o.kind], -o.score, -o.kept, float(o.product.price)))
    return out


def option_dict(o: Option, has_official: bool) -> dict:
    merchant = o.product.merchant
    return {
        "product": o.product,
        "kind": o.kind,
        "similar": has_official and o.kind != "official",
        "match": o.match,
        "kept": o.kept,
        "seller_name": merchant.business_name if merchant is not None else None,
        "mine": o.mine,
    }


def options_payload(opts: list[Option]) -> dict:
    has_official = any(o.kind == "official" for o in opts)
    return {"items": [option_dict(o, has_official) for o in opts], "has_official": has_official}


def my_choices(db: Session, merchant: MerchantAccount, key: str, query: str) -> list[tuple[Product, str, bool]]:
    """The seller's own products for the "Twin it" sheet: best match first."""
    products = (
        db.query(Product)
        .options(joinedload(Product.images), joinedload(Product.banner).joinedload(CategoryBanner.category))
        .filter(Product.merchant_id == merchant.id)
        .order_by(Product.created_at.desc())
        .limit(200)
        .all()
    )
    done = {r[0] for r in db.query(WantedOffer.product_id).filter(WantedOffer.request_key == key)}
    scored = [(p, text_score(query, p)) for p in products]
    scored.sort(key=lambda ps: (-ps[1], ps[0].name.lower()))
    return [(p, match_label(s), p.id in done) for p, s in scored]


def create_offer(db: Session, seller: User, key: str, clip: Clip | None, product: Product) -> tuple[WantedOffer, bool]:
    """Record "my product fits this request". Returns (offer, created); asking twice is a
    no-op. On a video moment it also makes the moment link so the poster can review it,
    and an offer by the poster themselves is approved on the spot (their own video)."""
    existing = db.query(WantedOffer).filter(WantedOffer.request_key == key, WantedOffer.product_id == product.id).first()
    if existing is not None:
        return existing, False
    link: VideoMomentProduct | None = None
    poster_to_tell: User | None = None
    if clip is not None:
        post_id, start, end = clip
        post = db.get(VideoPost, post_id)
        if post is not None:
            link = next(
                (
                    l
                    for l in db.query(VideoMomentProduct).filter(
                        VideoMomentProduct.video_post_id == post_id, VideoMomentProduct.product_id == product.id
                    )
                    if moment_index.iou(l.start_ms, l.end_ms, start, end) >= MOMENT_LINK_MIN_IOU
                ),
                None,
            )
            if link is not None and link.review == "rejected":
                raise OfferBlocked()
            if link is None:
                link = VideoMomentProduct(video_post_id=post_id, product_id=product.id, start_ms=start, end_ms=max(end, start + 1), confirmations=0)
                db.add(link)
                db.flush()
            if post.poster_id == seller.id:
                link.review = "confirmed"
            elif post.poster_id is not None:
                poster_to_tell = db.get(User, post.poster_id)
    offer = WantedOffer(request_key=key, product_id=product.id, seller_user_id=seller.id, link_id=link.id if link is not None else None)
    db.add(offer)
    db.flush()
    if poster_to_tell is not None and link is not None:
        _tell_poster(db, poster_to_tell, link.video_post_id, product)
    return offer, True


def _tell_poster(db: Session, poster: User, post_id: uuid.UUID, product: Product) -> None:
    """The video's creator has something waiting in their twins inbox. One unread notice
    per video at a time: further offers on the same video join the inbox quietly instead of
    pinging again until they have looked."""
    already = (
        db.query(Notification.id)
        .filter(
            Notification.user_id == poster.id,
            Notification.type == NotificationType.twin_offered,
            Notification.target_id == post_id,
            Notification.read.is_(False),
        )
        .first()
    )
    if already is not None:
        return
    db.add(
        Notification(
            user_id=poster.id,
            body=f"A seller offered “{product.name[:80]}” as a twin for a moment of your video. Review it in Twins on your videos.",
            type=NotificationType.twin_offered,
            target_id=post_id,
        )
    )


def withdraw(db: Session, seller: User, key: str, product_id: uuid.UUID) -> bool:
    offer = (
        db.query(WantedOffer)
        .filter(WantedOffer.request_key == key, WantedOffer.product_id == product_id, WantedOffer.seller_user_id == seller.id)
        .first()
    )
    if offer is None:
        return False
    link = offer.link
    db.delete(offer)
    db.flush()
    if link is not None and not link.evidence and not db.query(WantedOffer.id).filter(WantedOffer.link_id == link.id).first():
        db.delete(link)  # nothing else stands behind it
    db.commit()
    return True


_REPORT_REASON = {
    "counterfeit": ReportReason.counterfeit,
    "likeness": ReportReason.other,
    "mismatch": ReportReason.spam,
    "ownership": ReportReason.other,
}


def file_report(
    db: Session, reporter: User, request_id: uuid.UUID, product: Product, reason: str, detail: str | None
) -> bool:
    """Put a twin into the admin Reports queue. Returns False when this shopper already
    has an open report on the product (so one person can't pile up the count)."""
    open_already = (
        db.query(Report.id)
        .filter(
            Report.reporter_id == reporter.id,
            Report.target_type == ReportTargetType.product,
            Report.target_id == product.id,
            Report.status == ReportStatus.pending,
            Report.detail.like("twin:%"),
        )
        .first()
    )
    if open_already is not None:
        return False
    note = f"twin:{reason} request:{request_id}"
    if detail and detail.strip():
        note += f" - {detail.strip()}"
    db.add(
        Report(
            reporter_id=reporter.id,
            target_type=ReportTargetType.product,
            target_id=product.id,
            reason=_REPORT_REASON[reason],
            detail=note[:1000],
        )
    )
    db.commit()
    return True


def preview_urls(opts: list[Option], limit: int = 3) -> list[str]:
    """Photos of the first few twins that have one (options are already official-first)."""
    out: list[str] = []
    for o in opts:
        imgs = sorted(o.product.images or [], key=lambda i: i.position)
        if imgs:
            out.append(imgs[0].url)
        if len(out) >= limit:
            break
    return out


def twin_summary(db: Session, key: str, query: str, clip: Clip | None, viewer: User | None) -> tuple[int, list[str]]:
    """(how many twins, photos of the first few) - what a wall tile shows."""
    opts = options(db, key, query, clip, viewer)
    return len(opts), preview_urls(opts)


def twinned_count(db: Session, key: str, query: str, clip: Clip | None, viewer: User | None) -> int:
    return len(options(db, key, query, clip, viewer))


def search_user_ids(db: Session, post_ids: list[uuid.UUID]) -> int:
    """Different shoppers who asked about any moment of these videos."""
    if not post_ids:
        return 0
    return (
        db.query(func.count(func.distinct(TwinSearch.user_id))).filter(TwinSearch.video_post_id.in_(post_ids)).scalar() or 0
    )



def leads(db: Session, seller: User, merchant: MerchantAccount, board_items: list[dict], limit: int = 20) -> list[tuple[dict, Product, str]]:
    """Open requests on the wall that one of this seller's own products already fits, best
    fit first, skipping any they have already twinned. Free for every seller: it is the
    shortest path from "a shopper wants this" to "I have it", and the more sellers answer,
    the sooner shoppers stop hitting "no twin yet". Weak fits are left out; the Twin it
    sheet still lets a seller offer one by hand."""
    open_items = [i for i in board_items if i["status"] == "open"]
    if not open_items:
        return []
    products = (
        db.query(Product)
        .options(joinedload(Product.images), joinedload(Product.banner).joinedload(CategoryBanner.category))
        .filter(Product.merchant_id == merchant.id)
        .limit(200)
        .all()
    )
    if not products:
        return []
    keys = {
        r.id: r.request_key
        for r in db.query(TwinSearch).filter(TwinSearch.id.in_([i["id"] for i in open_items]))
    }
    mine_done = {
        r[0]
        for r in db.query(WantedOffer.request_key).filter(
            WantedOffer.seller_user_id == seller.id, WantedOffer.request_key.in_(list(keys.values()))
        )
    }
    out: list[tuple[dict, Product, str, float]] = []
    for item in open_items:
        key = keys.get(item["id"])
        if key is None or key in mine_done:
            continue
        best_p, best_s = max(((p, text_score(item["query"], p)) for p in products), key=lambda ps: ps[1])
        if best_s < TWIN_MATCH_PARTIAL:
            continue
        out.append((item, best_p, match_label(best_s), best_s))
    out.sort(key=lambda t: (-t[3], -t[0]["count"]))
    return [(i, p, m) for i, p, m, _ in out[:limit]]
