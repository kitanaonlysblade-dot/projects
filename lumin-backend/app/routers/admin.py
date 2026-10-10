import uuid
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, joinedload

from app.auth import get_current_admin
from app.database import get_db
from app.escrow import refund_for_defect
from app.models import (
    Appeal,
    AppealStatus,
    Notification,
    NotificationType,
    Order,
    OrderStatus,
    Product,
    Report,
    ReportStatus,
    ReturnClaim,
    ReturnClaimStatus,
    TrafficSource,
    TwinSearch,
    TwinSearchStatus,
    MerchantAccount,
    TwinReviewStatus,
    User,
    UserRole,
    VideoPost,
    VideoPostTwin,
)
from app.schemas import (
    AdminUserRead,
    AnalyticsPoint,
    AppealRead,
    AppealResolve,
    InsightsGrant,
    ReportRead,
    ReportResolve,
    ReturnClaimRead,
    ReturnClaimResolve,
    TopProductRead,
    TrafficSourcePoint,
    TwinReviewAction,
    TwinReviewRead,
    TrendingPostRead,
    UserBanRequest,
)

# dependencies=[...] gates every route below even if a future addition
# forgets to also declare Depends(get_current_admin) on its own params —
# the individual routes that need current_user's actual value (to stamp
# resolved_by_id, say) still declare it themselves too; FastAPI resolves
# a dependency once per request regardless of how many times it's
# depended on, so this isn't a double check, just a value the router
# guarantee alone can't hand back.
router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(get_current_admin)])


def _notify(db: Session, user_id: uuid.UUID, body: str) -> None:
    """Every admin action below that affects a specific person's account
    or listing sends one of these — the first place in this app that
    ever creates a live Notification row; everything the frontend's
    NotificationsScreen has shown until now was seeded fake data."""
    db.add(Notification(user_id=user_id, body=body, type=NotificationType.moderation))


# ---- Users / bans ----------------------------------------------------


@router.get("/users", response_model=list[AdminUserRead])
def list_users(
    q: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
):
    """The search surface for finding who to investigate/ban — not the
    same as GET /search's People section, which is public and
    deliberately thin (see that route's own PersonResult comment). This
    one needs email and ban status, which nobody but an admin should see
    for someone else's account.
    """
    query = db.query(User)
    if q:
        like = f"%{q}%"
        query = query.filter(
            or_(User.username.ilike(like), User.display_name.ilike(like), User.email.ilike(like))
        )
    return query.order_by(User.created_at.desc()).offset(offset).limit(limit).all()


@router.post("/users/{user_id}/ban", response_model=AdminUserRead)
def ban_user(
    user_id: uuid.UUID,
    payload: UserBanRequest,
    db: Session = Depends(get_db),
):
    """is_active=False is the actual enforcement (see
    get_current_active_user in auth/dependencies.py) — a banned account
    can still authenticate at all (get_current_user doesn't check this),
    just not do anything else, specifically so they can still file an
    appeal. Banning an admin account is refused outright — not because
    it's technically dangerous, but because unbanning them would then
    need another admin to already exist and know to do it; simpler to
    just not allow it than to reason through that edge case.
    """
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if user.role == UserRole.admin:
        raise HTTPException(status_code=400, detail="Admin accounts can't be banned")
    if not user.is_active:
        raise HTTPException(status_code=400, detail="This account is already suspended")

    user.is_active = False
    user.ban_reason = payload.reason
    user.banned_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(user)
    return user


@router.post("/users/{user_id}/unban", response_model=AdminUserRead)
def unban_user(user_id: uuid.UUID, db: Session = Depends(get_db)):
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if user.is_active:
        raise HTTPException(status_code=400, detail="This account isn't suspended")

    user.is_active = True
    user.ban_reason = None
    user.banned_at = None
    db.commit()
    db.refresh(user)
    return user


@router.post("/users/{user_id}/shadow-ban", response_model=AdminUserRead)
def shadow_ban_user(user_id: uuid.UUID, db: Session = Depends(get_db)):
    """Unlike ban_user above, nothing here touches is_active, and no
    Notification is sent (compare _notify's use in every other action in
    this file) — telling the account anything at all, even indirectly
    through a notification that arrives right as their reach quietly
    drops, defeats the entire point. Enforcement lives entirely in
    routers/video_posts.py's read-side filtering, not here; this route
    just flips the one column that filter checks. Admin accounts are
    refused the same as ban_user refuses banning one, for the same
    reason (nobody else could undo it if the one admin account able to
    were the one shadow-banned).
    """
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if user.role == UserRole.admin:
        raise HTTPException(status_code=400, detail="Admin accounts can't be shadow-banned")
    if user.is_shadow_banned:
        raise HTTPException(status_code=400, detail="This account is already shadow-banned")

    user.is_shadow_banned = True
    db.commit()
    db.refresh(user)
    return user


@router.post("/users/{user_id}/unshadow-ban", response_model=AdminUserRead)
def unshadow_ban_user(user_id: uuid.UUID, db: Session = Depends(get_db)):
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if not user.is_shadow_banned:
        raise HTTPException(status_code=400, detail="This account isn't shadow-banned")

    user.is_shadow_banned = False
    db.commit()
    db.refresh(user)
    return user


# ---- Appeals -----------------------------------------------------------
# Filing/viewing your own live in routers/users.py (POST/GET /users/me/
# appeal(s)), reachable by a banned account itself — reviewing every
# appeal is the admin-only half, here.


@router.get("/appeals", response_model=list[AppealRead])
def list_appeals(
    status_filter: AppealStatus | None = Query(default=None, alias="status"),
    db: Session = Depends(get_db),
):
    query = db.query(Appeal)
    if status_filter is not None:
        query = query.filter(Appeal.status == status_filter)
    return query.order_by(Appeal.created_at.desc()).all()


@router.patch("/appeals/{appeal_id}", response_model=AppealRead)
def resolve_appeal(
    appeal_id: uuid.UUID,
    payload: AppealResolve,
    current_user: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """Approving doesn't just update this row — it's the actual unban:
    clears is_active/ban_reason/banned_at on the account itself, the
    same fields unban_user above resets. Denying only updates the
    appeal; the account stays exactly as suspended as it was.
    """
    appeal = db.get(Appeal, appeal_id)
    if appeal is None:
        raise HTTPException(status_code=404, detail="Appeal not found")
    if appeal.status != AppealStatus.pending:
        raise HTTPException(status_code=400, detail="This appeal has already been resolved")
    if payload.status == AppealStatus.pending:
        raise HTTPException(status_code=400, detail="status must be 'approved' or 'denied'")

    appeal.status = payload.status
    appeal.admin_response = payload.admin_response
    appeal.resolved_by_id = current_user.id

    if payload.status == AppealStatus.approved:
        user = appeal.user
        user.is_active = True
        user.ban_reason = None
        user.banned_at = None
        _notify(db, user.id, "Your appeal was approved — your account has been reinstated.")
    else:
        body = "Your appeal was reviewed and denied."
        if payload.admin_response:
            body += f" {payload.admin_response}"
        _notify(db, appeal.user_id, body)

    db.commit()
    db.refresh(appeal)
    return appeal


# ---- Reports -------------------------------------------------------------
# Filing lives in routers/reports.py (any active user can file one) —
# reviewing every report is the admin-only half, here.


@router.get("/reports", response_model=list[ReportRead])
def list_reports(
    status_filter: ReportStatus | None = Query(default=None, alias="status"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
):
    query = db.query(Report)
    if status_filter is not None:
        query = query.filter(Report.status == status_filter)
    return query.order_by(Report.created_at.desc()).offset(offset).limit(limit).all()


@router.patch("/reports/{report_id}", response_model=ReportRead)
def resolve_report(
    report_id: uuid.UUID,
    payload: ReportResolve,
    current_user: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """No notification fired from here directly — a report resolved as
    `actioned` normally means a separate remove_product/remove_video_post
    or ban_user call happened alongside it, and each of those already
    notifies whoever they affect on their own. A `reviewed` resolution
    (nothing acted on) has nobody to notify.
    """
    report = db.get(Report, report_id)
    if report is None:
        raise HTTPException(status_code=404, detail="Report not found")
    if payload.status == ReportStatus.pending:
        raise HTTPException(status_code=400, detail="status must be 'reviewed' or 'actioned'")

    report.status = payload.status
    report.resolution_note = payload.resolution_note
    report.resolved_by_id = current_user.id
    db.commit()
    db.refresh(report)
    return report


# ---- Content removal -------------------------------------------------


@router.delete("/products/{product_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_product(
    product_id: uuid.UUID,
    reason: str | None = Query(default=None),
    db: Session = Depends(get_db),
):
    """Admin-scoped equivalent of DELETE /merchant/products/{id} — the
    same real delete (Order.product_id's own ON DELETE SET NULL, plus
    product_name/price snapshotted onto every Order already, is what
    makes that safe even against a product with real order history —
    see that column's own comment), just without the "must own this"
    check merchant.py's version has. Notifies the owning merchant, if
    there is one — a product with no merchant_id (inline shop-post
    products, or seeded catalog data) has nobody to tell.
    """
    product = db.get(Product, product_id)
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")
    if product.merchant is not None:
        body = f'Your listing "{product.name}" was removed for not following platform guidelines.'
        if reason:
            body += f" Reason: {reason}"
        _notify(db, product.merchant.user_id, body)
    db.delete(product)
    db.commit()


@router.delete("/video-posts/{video_post_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_video_post(
    video_post_id: uuid.UUID,
    reason: str | None = Query(default=None),
    db: Session = Depends(get_db),
):
    """Admin-scoped equivalent of DELETE /video-posts/{id}, without the
    "must be your own post" check that route has."""
    post = db.get(VideoPost, video_post_id)
    if post is None:
        raise HTTPException(status_code=404, detail="Video post not found")
    body = "Your post was removed for not following platform guidelines."
    if reason:
        body += f" Reason: {reason}"
    _notify(db, post.poster_id, body)
    db.delete(post)
    db.commit()


# ---- Twin review --------------------------------------------------------
# Merchants pair each tagged product with the stretch of video where it
# appears ("twinning"). Posts go live immediately; admins review twins
# afterwards. Flagging one stops it driving the shop pill and tells the
# merchant to re-twin.


@router.get("/twins", response_model=list[TwinReviewRead])
def list_twins(
    status_filter: Literal["pending", "approved", "flagged"] = Query(default="pending", alias="status"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(VideoPostTwin)
        .options(joinedload(VideoPostTwin.video_post).joinedload(VideoPost.poster), joinedload(VideoPostTwin.product))
        .filter(VideoPostTwin.review_status == TwinReviewStatus(status_filter))
        .order_by(VideoPostTwin.created_at.asc(), VideoPostTwin.id)
        .offset(offset)
        .limit(limit)
        .all()
    )
    return [
        TwinReviewRead(
            id=t.id,
            video_post_id=t.video_post_id,
            video_url=t.video_post.video_url,
            thumbnail_url=t.video_post.thumbnail_url,
            poster_name=t.video_post.poster_display_name,
            product_id=t.product_id,
            product_name=t.product.name,
            label=t.label,
            start_ms=t.start_ms,
            end_ms=t.end_ms,
            review_status=t.review_status,
            created_at=t.created_at,
        )
        for t in rows
    ]


@router.patch("/twins/{twin_id}", response_model=TwinReviewRead)
def review_twin(twin_id: uuid.UUID, payload: TwinReviewAction, db: Session = Depends(get_db)):
    twin = db.get(VideoPostTwin, twin_id)
    if twin is None:
        raise HTTPException(status_code=404, detail="Twin not found")
    twin.review_status = TwinReviewStatus(payload.status)
    twin.reviewed_at = datetime.now(timezone.utc)
    twin.flag_reason = payload.reason if payload.status == "flagged" else None
    if payload.status == "flagged":
        body = f'A product on your video ("{twin.label}") doesn\'t appear where you marked it, so it was hidden. Please edit the post and twin it again.'
        if payload.reason:
            body += f" Reason: {payload.reason}"
        _notify(db, twin.video_post.poster_id, body)
    db.commit()
    db.refresh(twin)
    post = twin.video_post
    return TwinReviewRead(
        id=twin.id,
        video_post_id=twin.video_post_id,
        video_url=post.video_url,
        thumbnail_url=post.thumbnail_url,
        poster_name=post.poster_display_name,
        product_id=twin.product_id,
        product_name=twin.product.name,
        label=twin.label,
        start_ms=twin.start_ms,
        end_ms=twin.end_ms,
        review_status=twin.review_status,
        created_at=twin.created_at,
    )


# ---- Return claims / disputes -----------------------------------------
# Filing (report_defect) and the seller's rebuttal
# (respond_to_return_claim) both live in routers/orders.py — actually
# resolving one is the admin-only half, here.


@router.get("/return-claims", response_model=list[ReturnClaimRead])
def list_return_claims(
    status_filter: ReturnClaimStatus | None = Query(default=None, alias="status"),
    db: Session = Depends(get_db),
):
    query = db.query(ReturnClaim)
    if status_filter is not None:
        query = query.filter(ReturnClaim.status == status_filter)
    return query.order_by(ReturnClaim.created_at.desc()).all()


@router.patch("/return-claims/{claim_id}", response_model=ReturnClaimRead)
def resolve_return_claim(
    claim_id: uuid.UUID,
    payload: ReturnClaimResolve,
    current_user: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """The actual dispute resolution. Approving triggers the same
    refund_for_defect (app/escrow.py) that used to run automatically the
    instant a claim was filed, before this feature existed — now it only
    ever runs from here. Denying leaves the order's payout_status
    untouched (still `held`), which is exactly what lets
    sweep_auto_releases (app/escrow.py) pick the order back up for a
    normal release next time someone looks at their orders, the same as
    if nothing had ever been filed against it.
    """
    claim = db.get(ReturnClaim, claim_id)
    if claim is None:
        raise HTTPException(status_code=404, detail="Claim not found")
    if claim.status != ReturnClaimStatus.pending_review:
        raise HTTPException(status_code=400, detail="This claim has already been resolved")

    order = claim.order
    if payload.approve:
        refund_for_defect(db, order)
        claim.status = ReturnClaimStatus.refunded
        buyer_body = "Your return claim was approved and refunded."
        seller_body = f"A return claim against order {order.id} was approved; the buyer has been refunded."
    else:
        claim.status = ReturnClaimStatus.denied
        buyer_body = "Your return claim was reviewed and denied."
        seller_body = f"A return claim against order {order.id} was reviewed and denied."
    if payload.resolution_note:
        buyer_body += f" {payload.resolution_note}"

    claim.resolution_note = payload.resolution_note
    claim.resolved_by_id = current_user.id
    claim.resolved_at = datetime.now(timezone.utc)

    if claim.buyer_id is not None:
        _notify(db, claim.buyer_id, buyer_body)
    if order.product is not None and order.product.merchant is not None:
        _notify(db, order.product.merchant.user_id, seller_body)

    db.commit()
    db.refresh(claim)
    return claim


# ---- Platform analytics -------------------------------------------------
# Same real order/engagement/traffic data the merchant's own analytics
# tab (MerchantAnalytics.tsx) already charts per-merchant — these just
# aren't scoped to one merchant's products or one poster's videos.


@router.get("/analytics/summary", response_model=list[AnalyticsPoint])
def analytics_summary(
    period: Literal["day", "month", "year"] = Query(default="day"),
    db: Session = Depends(get_db),
):
    """Order volume and revenue over time, platform-wide. Excludes
    cancelled orders — those never became real revenue. Sums Order.price
    only, not shipping_fee/discount_amount: those apply at the Payment
    level, shared across every order in one multi-item checkout, so
    they're not cleanly attributable to any single order — same
    reasoning cancel_order's own comment on partial refunds already
    uses for the identical problem.
    """
    bucket = func.date_trunc(period, Order.created_at).label("period_start")
    rows = (
        db.query(bucket, func.count(Order.id), func.coalesce(func.sum(Order.price), 0))
        .filter(Order.status != OrderStatus.cancelled)
        .group_by(bucket)
        .order_by(bucket)
        .all()
    )
    return [
        AnalyticsPoint(period_start=row[0].date(), order_count=row[1], revenue=row[2]) for row in rows
    ]


@router.get("/analytics/top-products", response_model=list[TopProductRead])
def analytics_top_products(
    limit: int = Query(default=10, ge=1, le=50),
    db: Session = Depends(get_db),
):
    """Ranked by units sold — one Order row per unit (see the model's
    own comment on checkout's Array.from expansion), not by revenue, so
    a cheap high-volume item and an expensive low-volume one aren't just
    ranked by whichever happens to cost more. Revenue is the tiebreaker,
    not the primary sort.
    """
    rows = (
        db.query(
            Order.product_id,
            Order.product_name,
            func.count(Order.id),
            func.coalesce(func.sum(Order.price), 0),
        )
        .filter(Order.status != OrderStatus.cancelled, Order.product_id.isnot(None))
        .group_by(Order.product_id, Order.product_name)
        .order_by(func.count(Order.id).desc(), func.sum(Order.price).desc())
        .limit(limit)
        .all()
    )
    return [TopProductRead(product_id=row[0], name=row[1], units_sold=row[2], revenue=row[3]) for row in rows]


@router.get("/analytics/trending-posts", response_model=list[TrendingPostRead])
def analytics_trending_posts(
    limit: int = Query(default=10, ge=1, le=50),
    db: Session = Depends(get_db),
):
    """"What's working" across every merchant and every personal account
    — ranked by total engagement (likes+comments+shares+saves), the same
    four real counters MerchantAnalytics.tsx already charts per merchant,
    just summed and ranked platform-wide instead of scoped to one
    poster's own videos.
    """
    total = VideoPost.likes_count + VideoPost.comments_count + VideoPost.shares_count + VideoPost.saves_count
    posts = (
        db.query(VideoPost)
        .options(joinedload(VideoPost.poster))
        .order_by(total.desc())
        .limit(limit)
        .all()
    )
    return [
        TrendingPostRead(
            video_post_id=p.id,
            description=p.description,
            poster_display_name=p.poster_display_name,
            likes_count=p.likes_count,
            comments_count=p.comments_count,
            shares_count=p.shares_count,
            saves_count=p.saves_count,
            engagement_total=p.likes_count + p.comments_count + p.shares_count + p.saves_count,
        )
        for p in posts
    ]


@router.get("/analytics/traffic", response_model=list[TrafficSourcePoint])
def analytics_traffic(
    period: Literal["day", "month", "year"] = Query(default="day"),
    db: Session = Depends(get_db),
):
    """Where sessions come from, over time — built from TrafficSource
    rows POST /traffic (routers/traffic.py) ingests once per app load.
    Falls back utm_source -> referrer -> the literal "direct": a session
    with neither is a real, meaningful bucket (someone typed the URL, or
    opened an existing bookmark/tab), not missing data. See
    TrafficSource's own comment for why this is session-start
    acquisition tracking, not full pageview tracking.
    """
    bucket = func.date_trunc(period, TrafficSource.created_at).label("period_start")
    source = func.coalesce(TrafficSource.utm_source, TrafficSource.referrer, "direct").label("source")
    rows = (
        db.query(bucket, source, func.count(TrafficSource.id))
        .group_by(bucket, source)
        .order_by(bucket)
        .all()
    )
    return [
        TrafficSourcePoint(period_start=row[0].date(), source=row[1], session_count=row[2]) for row in rows
    ]


# ---- Twin health --------------------------------------------------------
# A few daily numbers that say whether twin search is working: are sellers
# twinning, are shoppers searching, do they find something, does it end in a
# cart? Watch these before tightening any rule.


@router.get("/twin-stats")
def twin_stats(days: int = Query(default=30, ge=1, le=180), db: Session = Depends(get_db)):
    today = datetime.now(timezone.utc).date()
    first = today - timedelta(days=days - 1)
    since = datetime.combine(first, datetime.min.time(), tzinfo=timezone.utc)

    def per_day(column, *filters) -> dict:
        day = func.date(column)
        rows = db.query(day, func.count()).filter(column >= since, *filters).group_by(day).all()
        return {str(d): n for d, n in rows}

    twins = per_day(VideoPostTwin.created_at)
    searches = per_day(TwinSearch.created_at)
    not_found = per_day(TwinSearch.created_at, TwinSearch.status.in_([TwinSearchStatus.not_found, TwinSearchStatus.available]))
    picked = per_day(TwinSearch.created_at, TwinSearch.picked_product_id.isnot(None))
    keys = ("twins_created", "searches", "searches_not_found", "searches_picked")
    series = []
    for i in range(days):
        d = str(first + timedelta(days=i))
        series.append(
            {
                "date": d,
                "twins_created": twins.get(d, 0),
                "searches": searches.get(d, 0),
                "searches_not_found": not_found.get(d, 0),
                "searches_picked": picked.get(d, 0),
            }
        )
    totals = {k: sum(row[k] for row in series) for k in keys}
    reviewed = (
        db.query(VideoPostTwin.review_status, func.count())
        .filter(VideoPostTwin.review_status != TwinReviewStatus.pending)
        .group_by(VideoPostTwin.review_status)
        .all()
    )
    reviewed_counts = {status.value: n for status, n in reviewed}
    approved, flagged = reviewed_counts.get("approved", 0), reviewed_counts.get("flagged", 0)
    searched = totals["searches"]
    return {
        "days": days,
        "series": series,
        "totals": totals,
        # Share of searches in this window that found at least one twin.
        "match_rate": round(1 - totals["searches_not_found"] / searched, 3) if searched else None,
        # Share of searches that ended with the shopper adding a result to cart / buying.
        "pick_rate": round(totals["searches_picked"] / searched, 3) if searched else None,
        # Share of reviewed twins an admin flagged — a rough measure of lazy twinning.
        "flag_rate": round(flagged / (approved + flagged), 3) if (approved + flagged) else None,
        "pending_review": db.query(func.count(VideoPostTwin.id))
        .filter(VideoPostTwin.review_status == TwinReviewStatus.pending)
        .scalar()
        or 0,
        # Shoppers waiting for a product right now.
        "waiting_searches": db.query(func.count(TwinSearch.id))
        .filter(TwinSearch.status == TwinSearchStatus.not_found)
        .scalar()
        or 0,
    }


@router.post("/merchants/{merchant_id}/insights")
def grant_merchant_insights(merchant_id: uuid.UUID, payload: InsightsGrant, db: Session = Depends(get_db)):
    """Turn on (or extend) a merchant's keyword insights by N days. Stands in for the
    paid subscription flow until that exists; extends from the current end if still active."""
    merchant = db.get(MerchantAccount, merchant_id)
    if merchant is None:
        raise HTTPException(status_code=404, detail="Merchant not found")
    now = datetime.now(timezone.utc)
    base = merchant.insights_until if merchant.insights_until and merchant.insights_until > now else now
    merchant.insights_until = base + timedelta(days=payload.days)
    db.commit()
    return {"merchant_id": str(merchant.id), "insights_until": merchant.insights_until.isoformat()}
