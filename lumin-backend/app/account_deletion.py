"""Deleting an account from inside the app (Settings > Account > Delete account).

What "delete" means here, because a marketplace can't just erase everything:

* Gone: the profile, login, avatar, followers/following, likes, comments, watchlist, cart,
  notifications, saved address, the person's videos (and their uploaded files), and - for a
  seller - the store, its products and their photos.
* Kept but detached: order and payment records, which other people (the seller, the buyer,
  accounting) depend on. They stay with the person removed ("Deleted user") and the
  delivery address scrubbed. Reports and moderation records stay too, detached.
* Refused while money or an order is in flight: an order not yet delivered, a delivered one
  still in the claim window (payout held), an open return claim, or a payment still being
  confirmed. Deleting then would strand someone else's money or order.

The schema already anticipated this: every foreign key to users has an ON DELETE rule, so
once the cleanup below is done a plain DELETE of the user row lets the database do the rest.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import and_, delete, or_, select
from sqlalchemy.orm import Session

from app import storage
from app.counters import reconcile
from app.models import (
    CartItem,
    Comment,
    Order,
    OrderStatus,
    Payment,
    PaymentStatus,
    PayoutStatus,
    Product,
    ReturnClaim,
    ReturnClaimStatus,
    SellerVerification,
    User,
    VideoPost,
    comment_reactions,
    post_likes,
    post_shares,
    watchlist_items,
)
from app.post_removal import remove_post

_SHIPPING_COLUMNS = (
    "shipping_recipient_name",
    "shipping_phone",
    "shipping_line1",
    "shipping_line2",
    "shipping_city",
    "shipping_state",
    "shipping_postal_code",
    "shipping_country",
)
# A charge the buyer has started but Paystack hasn't confirmed yet is "in flight" for this long.
_PAYMENT_GRACE = timedelta(hours=24)


def _in_progress():
    """An order that isn't finished: not delivered yet, or delivered but its payout is still held
    (the buyer's claim window)."""
    return or_(
        Order.status.in_([OrderStatus.pending, OrderStatus.shipped]),
        and_(Order.status == OrderStatus.delivered, Order.payout_status == PayoutStatus.held),
    )


def _plural(n: int, word: str) -> str:
    return f"{n} {word}{'' if n == 1 else 's'}"


def blockers(db: Session, user: User) -> list[str]:
    """Plain-language reasons this account can't be deleted yet (empty = it can)."""
    reasons: list[str] = []

    n = db.query(Order).filter(Order.buyer_id == user.id, _in_progress()).count()
    if n:
        reasons.append(f"You have {_plural(n, 'order')} still in progress. Wait until they are delivered and settled.")
    n = (
        db.query(ReturnClaim)
        .filter(ReturnClaim.buyer_id == user.id, ReturnClaim.status == ReturnClaimStatus.pending_review)
        .count()
    )
    if n:
        reasons.append(f"You have {_plural(n, 'return claim')} waiting for review.")
    n = (
        db.query(Payment)
        .filter(
            Payment.user_id == user.id,
            Payment.status == PaymentStatus.pending,
            Payment.created_at >= datetime.now(timezone.utc) - _PAYMENT_GRACE,
        )
        .count()
    )
    if n:
        reasons.append("A payment is still being confirmed. Try again in a little while.")

    merchant = user.merchant_account
    if merchant is not None:
        sold = db.query(Order).join(Product, Order.product_id == Product.id).filter(Product.merchant_id == merchant.id)
        n = sold.filter(_in_progress()).count()
        if n:
            reasons.append(f"Your store has {_plural(n, 'order')} still in progress. Ship them and let the payouts settle first.")
        n = (
            db.query(ReturnClaim)
            .join(Order, ReturnClaim.order_id == Order.id)
            .join(Product, Order.product_id == Product.id)
            .filter(Product.merchant_id == merchant.id, ReturnClaim.status == ReturnClaimStatus.pending_review)
            .count()
        )
        if n:
            reasons.append(f"Your store has {_plural(n, 'return claim')} waiting for review.")
    return reasons


def delete_account(db: Session, user: User) -> list[str]:
    """Delete the account (callers check blockers() and the password first). Returns the public
    URLs of the uploaded files that belonged to it, for storage.delete_view_urls to remove
    AFTER this commits, so a storage hiccup can never undo the deletion."""
    uid = user.id
    urls: list[str | None] = [user.avatar_url]

    private_keys: list[str | None] = []
    merchant = user.merchant_account
    if merchant is not None:
        for product in merchant.products:
            urls += [image.url for image in product.images]
        # ID photos still waiting for review (they are deleted at review time otherwise).
        for v in db.query(SellerVerification).filter(SellerVerification.merchant_id == merchant.id):
            private_keys += [v.document_key, v.selfie_key]

    for post in db.query(VideoPost).filter(VideoPost.poster_id == uid).all():
        urls += [post.video_url, post.thumbnail_url, post.lite_video_url, post.hls_url]
        remove_post(db, post)

    # Whatever this person liked, shared, saved, commented on, reacted to or had in a cart is about to
    # disappear with them; remember which counters that touches so they can be recounted afterwards.
    affected_posts = {
        r[0]
        for table in (post_likes, post_shares, watchlist_items)
        for r in db.execute(select(table.c.video_post_id).where(table.c.user_id == uid))
    } | {r[0] for r in db.execute(select(Comment.video_post_id).where(Comment.author_id == uid))}
    affected_comments = {r[0] for r in db.execute(select(comment_reactions.c.comment_id).where(comment_reactions.c.user_id == uid))} | {
        r[0] for r in db.execute(select(Comment.parent_id).where(Comment.author_id == uid, Comment.parent_id.isnot(None)))
    }
    affected_products = {r[0] for r in db.execute(select(CartItem.product_id).where(CartItem.user_id == uid))}

    # Their comments on other people's videos (replies under them go with them).
    db.execute(delete(Comment).where(Comment.author_id == uid))

    # Order and payment records stay; the person and where it shipped to do not.
    scrub = {col: None for col in _SHIPPING_COLUMNS}
    db.query(Order).filter(Order.buyer_id == uid).update({"buyer_name": "Deleted user", **scrub}, synchronize_session=False)
    db.query(Payment).filter(Payment.user_id == uid).update(scrub, synchronize_session=False)
    db.flush()

    # A plain DELETE: the database applies each foreign key's ON DELETE rule (cascade the
    # store, follows, likes, cart, notifications...; set null on orders, payments, reports).
    db.expunge_all()
    db.execute(delete(User).where(User.id == uid))
    db.commit()
    reconcile(
        db,
        post_ids=list(affected_posts),
        comment_ids=list(affected_comments),
        product_ids=list(affected_products),
    )
    storage.delete_private(private_keys)  # after the commit, best effort
    return [u for u in urls if u]
