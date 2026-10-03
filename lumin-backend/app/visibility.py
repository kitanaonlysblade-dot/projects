from sqlalchemy import or_
from sqlalchemy.orm import Query

from app.models import MerchantAccount, Product, User, UserRole

# Shared shadow-ban read-side filtering — see User.is_shadow_banned's own
# comment for the design (nothing changes for the shadow-banned account
# itself; everyone else just stops seeing its content). Originally lived
# only in routers/video_posts.py; moved here once routers/search.py
# needed the identical logic too — correctness-sensitive filtering like
# this is exactly the kind of thing that shouldn't drift between two
# copies if one gets a fix and the other doesn't, unlike the smaller
# per-router helpers (_snapshot_order, etc.) this codebase deliberately
# keeps duplicated.
#
# Two entry points, because "what's the shadow-banned account's id
# column, and how far away is it" differs by model: VideoPost/Comment
# point straight at a User (poster_id/author_id); Product is one hop
# further, through Product.merchant_id -> MerchantAccount.user_id.
#
# There's deliberately no third one for User rows directly. The point of
# a shadow ban is that a banned account's *content* stops getting
# engagement — it never reaches the shop/discover/product-category feeds
# — not that the account itself becomes unfindable. Searching for the
# person by name still works for everyone, same as it would if they'd
# simply never posted anything; routers/search.py's people-search branch
# intentionally runs unfiltered.


def hide_shadow_banned(query: Query, owner_relationship, owner_id_col, current_user: User | None) -> Query:
    """For a query of a model with a direct many-to-one relationship to
    User — VideoPost.poster/poster_id, Comment.author/author_id.
    `.has(...)` rather than an explicit `.join(User, ...)` so this
    doesn't interact with a `joinedload()` already eager-loading that
    same relationship on the query.
    """
    if current_user is not None and current_user.role == UserRole.admin:
        return query
    # owner_id_col.is_(None) first — Comment.author_id is nullable (SET
    # NULL on account deletion); `.has(...)` against a relationship with
    # nothing on the other end evaluates to false, not true, so without
    # this a comment from a deleted account would wrongly get hidden
    # from everyone instead of staying visible (there's no shadow-ban
    # status left to check for a poster that no longer exists). No-op
    # for VideoPost, whose poster_id is never null.
    visible = owner_id_col.is_(None) | owner_relationship.has(User.is_shadow_banned == False)  # noqa: E712
    if current_user is not None:
        visible = or_(visible, owner_id_col == current_user.id)
    return query.filter(visible)


def hide_shadow_banned_products(query: Query, current_user: User | None) -> Query:
    """Product is one hop further than VideoPost/Comment — merchant_id
    points at a MerchantAccount, not a User directly, and merchant_id
    itself is nullable (a product with no merchant, if that's ever
    possible, has nothing to hide and always stays visible, same
    NULL-safety reasoning as owner_id_col.is_(None) above).
    """
    if current_user is not None and current_user.role == UserRole.admin:
        return query
    not_shadow_banned = Product.merchant.has(MerchantAccount.user.has(User.is_shadow_banned == False))  # noqa: E712
    visible = Product.merchant_id.is_(None) | not_shadow_banned
    if current_user is not None:
        visible = or_(
            visible,
            Product.merchant.has(MerchantAccount.user_id == current_user.id),
        )
    return query.filter(visible)


def is_hidden_from(owner: User | None, owner_id, current_user: User | None) -> bool:
    """Single-object equivalent of hide_shadow_banned, for a route that
    fetches one row by id rather than filtering a list —
    GET /video-posts/{id}, which a shadow-banned account's own share
    links (ShareSheet.tsx's ?post=<id>) point at just as much as
    anyone else's. `owner` is None-safe the same way the query-based
    version is (nothing to hide for content with no owner at all).
    """
    if owner is None or not owner.is_shadow_banned:
        return False
    if current_user is None:
        return True
    return current_user.role != UserRole.admin and current_user.id != owner_id
