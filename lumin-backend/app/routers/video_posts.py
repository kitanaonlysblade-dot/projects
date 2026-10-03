import random
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.auth import get_current_active_user, get_optional_user
from app.database import get_db
from app.models import (
    Comment,
    Interest,
    Notification,
    NotificationType,
    Product,
    User,
    VideoFeed,
    VideoPost,
    UserRole,
    comment_reactions,
    post_likes,
    post_shares,
    watchlist_items,
)
from app.schemas import (
    CommentCreate,
    CommentReactionSet,
    CommentReactorRead,
    CommentRead,
    CommentUpdate,
    PersonResult,
    VideoPostCreate,
    VideoPostRead,
    VideoPostUpdate,
)
from app.visibility import hide_shadow_banned, is_hidden_from

router = APIRouter(prefix="/video-posts", tags=["video-posts"])

# Every joinedload a route needs to safely call _resolve_video_post_for_read
# below on whatever it fetches — the plain three (poster/products/
# interests) for a post's own content, plus the same three one level
# down through repost_of, since a repost row's *own* poster/products/
# interests are never populated (see the model's own comment on
# repost_of_id) and resolving one without these would trigger a
# lazy-load per row instead of the single query this is meant to be.
_VIDEO_POST_LOAD_OPTIONS = (
    joinedload(VideoPost.products),
    joinedload(VideoPost.interests),
    joinedload(VideoPost.poster),
    joinedload(VideoPost.repost_of).joinedload(VideoPost.products),
    joinedload(VideoPost.repost_of).joinedload(VideoPost.interests),
    joinedload(VideoPost.repost_of).joinedload(VideoPost.poster),
)


def _resolve_video_post_for_read(post: VideoPost) -> VideoPostRead:
    """Builds the shape every route below actually returns, rather than
    letting response_model's own from_attributes serialize the raw ORM
    row directly — needed because a repost row's own content columns
    are never populated (see create_repost and the model's own comment
    on repost_of_id), so from_attributes alone would serialize an empty
    shell instead of the original's real content. For a plain post
    (repost_of_id is None) this is just that post's normal fields with
    repost_id/reposted_by left at their None defaults."""
    content = post.repost_of if post.repost_of_id is not None else post
    data = VideoPostRead.model_validate(content).model_dump()
    data["created_at"] = post.created_at
    if post.repost_of_id is not None:
        data["repost_id"] = post.id
        data["reposted_by"] = {
            "id": post.poster_id,
            "display_name": post.poster_display_name,
            "avatar_url": post.poster_avatar_url,
        }
    return VideoPostRead(**data)


@router.get("", response_model=list[VideoPostRead])
def list_video_posts(
    feed: VideoFeed = Query(..., description="'shop' or 'discover' — the two feeds are never mixed in one response, same as shopPosts/discoverPosts being separate arrays on the frontend"),
    limit: int = Query(default=10, le=50),
    before: uuid.UUID | None = Query(
        default=None,
        description="Cursor pagination — pass the last post id from the previous page to get the next batch.",
    ),
    current_user: User | None = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    query = (
        db.query(VideoPost)
        .options(*_VIDEO_POST_LOAD_OPTIONS)
        .filter(VideoPost.feed == feed)
    )
    query = hide_shadow_banned(query, VideoPost.poster, VideoPost.poster_id, current_user)
    if before is not None:
        anchor = db.get(VideoPost, before)
        if anchor is not None:
            query = query.filter(VideoPost.created_at < anchor.created_at)
    posts = query.order_by(VideoPost.created_at.desc()).limit(limit).all()
    # `ORDER BY created_at DESC` on its own means every fresh load (app
    # reopen, pull-to-refresh, revisiting the tab) fetches the exact same
    # `limit` rows in the exact same order — nothing here ever reshuffled.
    # Randomizing only the first page (before is None) gives each visit a
    # different pick/order of what's shown, while a `before` page — an
    # older batch fetched further down an already-open feed — stays in
    # recency order so "keep scrolling" doesn't reorder posts the person
    # is mid-way through.
    if before is None:
        random.shuffle(posts)
    return [_resolve_video_post_for_read(p) for p in posts]


# Registered ahead of GET /{video_post_id} below on purpose — FastAPI/
# Starlette match routes in declaration order, and "watchlist" would
# otherwise be swallowed by that route's {video_post_id}: uuid.UUID
# parameter (Pydantic would reject it as an invalid UUID with a 422
# rather than falling through to this one).
@router.get("/watchlist", response_model=list[VideoPostRead])
def list_my_watchlist(current_user: User = Depends(get_current_active_user), db: Session = Depends(get_db)):
    """Powers WatchlistScreen.tsx — every post the current user has saved,
    most recently watchlisted first. There was previously no way to read
    this back at all; POST/DELETE .../watchlist could only ever toggle."""
    return [
        _resolve_video_post_for_read(p)
        for p in (
            db.query(VideoPost)
            .options(*_VIDEO_POST_LOAD_OPTIONS)
            .join(watchlist_items, watchlist_items.c.video_post_id == VideoPost.id)
            .filter(watchlist_items.c.user_id == current_user.id)
            .order_by(VideoPost.created_at.desc())
            .all()
        )
    ]


# Same route-ordering reason as /watchlist above. Bare ids rather than
# full VideoPostRead objects — unlike watchlist, there's no "liked
# posts" screen to browse, so the frontend only ever needs these for a
# cheap membership check (post_id in likedIds) to know which posts show
# the Like button already filled in.
@router.get("/likes", response_model=list[uuid.UUID])
def list_my_liked_post_ids(current_user: User = Depends(get_current_active_user), db: Session = Depends(get_db)):
    return [
        row.video_post_id
        for row in db.query(post_likes.c.video_post_id).filter(post_likes.c.user_id == current_user.id).all()
    ]


# Same idea as list_my_liked_post_ids, for the Share toggle.
@router.get("/shares", response_model=list[uuid.UUID])
def list_my_shared_post_ids(current_user: User = Depends(get_current_active_user), db: Session = Depends(get_db)):
    return [
        row.video_post_id
        for row in db.query(post_shares.c.video_post_id).filter(post_shares.c.user_id == current_user.id).all()
    ]


# Same idea as list_my_liked_post_ids/list_my_shared_post_ids above, for
# the Repost toggle in ShareSheet.tsx. Reposts aren't a many-to-many
# table like post_likes/post_shares — a repost is its own VideoPost row
# — so this queries those rows directly rather than joining a
# link table, but the shape returned is the same kind of "ids I've
# already reposted" list. Returns the ORIGINAL posts' ids
# (repost_of_id), not the repost rows' own ids, since page.tsx's
# repostedPostIds is keyed by the original's id — same reasoning as
# _resolve_video_post_for_read routing every interaction through the
# original rather than the repost row.
@router.get("/reposts", response_model=list[uuid.UUID])
def list_my_repost_post_ids(current_user: User = Depends(get_current_active_user), db: Session = Depends(get_db)):
    return [
        row.repost_of_id
        for row in db.query(VideoPost.repost_of_id)
        .filter(VideoPost.poster_id == current_user.id, VideoPost.repost_of_id.isnot(None))
        .all()
    ]


@router.get("/mine", response_model=list[VideoPostRead])
def list_my_video_posts(
    feed: VideoFeed = Query(..., description="'shop' or 'discover'"),
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Powers "Your posts" on ProfileScreen.tsx (and, for symmetry,
    could back the same grid on the merchant side). Every row this
    person actually posted into `feed` — their own original uploads
    *and* their own reposts, since both share the same poster_id;
    repost_of_id doesn't factor into the filter at all, it's not "posts
    I created", it's "posts sitting in my feed."

    This exists because ProfileScreen used to just filter whatever
    happened to already be loaded in the main, shuffled/paginated
    discoverPosts feed by display name — which quietly failed for two
    reasons: a post you made that the general feed hasn't paged into
    yet simply wouldn't be in that list, and a repost's own poster_id/
    display_name are never actually yours to match against (see
    _resolve_video_post_for_read: a repost reads back with the
    ORIGINAL poster's identity so the content stays attributed to
    them — reposted_by is the only field that's actually the
    reposter's). Querying poster_id directly here sidesteps both."""
    posts = (
        db.query(VideoPost)
        .options(*_VIDEO_POST_LOAD_OPTIONS)
        .filter(VideoPost.poster_id == current_user.id, VideoPost.feed == feed)
        .order_by(VideoPost.created_at.desc())
        .all()
    )
    return [_resolve_video_post_for_read(p) for p in posts]


@router.get("/by-poster/{poster_id}", response_model=list[VideoPostRead])
def list_video_posts_by_poster(
    poster_id: uuid.UUID,
    feed: VideoFeed = Query(..., description="'shop' or 'discover'"),
    current_user: User | None = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    """The public equivalent of list_my_video_posts (/mine) — everything
    `poster_id` has posted or reposted into `feed`, most recent first.
    Powers PosterProfileScreen.tsx viewing someone else's profile, same
    reason /mine exists: filtering whatever's already loaded in the
    general feed by display name misses posts that feed hasn't paged
    into yet, and misses that poster's own reposts entirely (a repost
    reads back with the ORIGINAL poster's identity, not the reposter's
    — see _resolve_video_post_for_read). No auth required — these are
    the same public posts anyone scrolling that feed would see — but
    shadow-banned from anyone but the account itself/an admin, same as
    everywhere else this app filters by that.
    """
    query = db.query(VideoPost).options(*_VIDEO_POST_LOAD_OPTIONS).filter(
        VideoPost.poster_id == poster_id, VideoPost.feed == feed
    )
    query = hide_shadow_banned(query, VideoPost.poster, VideoPost.poster_id, current_user)
    posts = query.order_by(VideoPost.created_at.desc()).all()
    return [_resolve_video_post_for_read(p) for p in posts]


@router.get("/{video_post_id}", response_model=VideoPostRead)
def get_video_post(
    video_post_id: uuid.UUID,
    current_user: User | None = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    """Backs page.tsx's own ?post=<id> deep-link resolution (a shared
    link opened fresh, no post already in memory) as well as ShareSheet.
    tsx's copy-link feature that generates those links in the first
    place — same route either way, no separate "resolve a share link"
    endpoint.
    """
    post = (
        db.query(VideoPost)
        .options(*_VIDEO_POST_LOAD_OPTIONS)
        .filter(VideoPost.id == video_post_id)
        .first()
    )
    if post is None or is_hidden_from(post.poster, post.poster_id, current_user):
        # Same 404 either way — a shadow-banned poster's post has to
        # look exactly like it doesn't exist to anyone but themselves/an
        # admin, including via a direct link (this app's own
        # ShareSheet-generated ?post=<id> links included), not just
        # absent from list_video_posts above.
        raise HTTPException(status_code=404, detail="Video post not found")
    return _resolve_video_post_for_read(post)


def _annotate_comments(comments: list[Comment], current_user: User | None, db: Session) -> list[Comment]:
    """Sets the per-request, non-column fields CommentRead needs on each
    Comment instance — my_reaction / liked_by_me (the viewer's own pick)
    and reaction_counts (reaction -> how many people) — in two queries
    for the whole batch rather than two per comment. A logged-out reader
    never has a reaction of their own, same as isLiked defaulting false
    anywhere else in this app for a signed-out view."""
    ids = [c.id for c in comments]
    counts: dict[uuid.UUID, dict[str, int]] = {}
    mine: dict[uuid.UUID, str] = {}
    if ids:
        for cid, reaction, n in (
            db.query(comment_reactions.c.comment_id, comment_reactions.c.reaction, func.count())
            .filter(comment_reactions.c.comment_id.in_(ids))
            .group_by(comment_reactions.c.comment_id, comment_reactions.c.reaction)
            .all()
        ):
            counts.setdefault(cid, {})[reaction] = n
        if current_user is not None:
            mine = {
                row.comment_id: row.reaction
                for row in db.query(comment_reactions.c.comment_id, comment_reactions.c.reaction).filter(
                    comment_reactions.c.user_id == current_user.id,
                    comment_reactions.c.comment_id.in_(ids),
                )
            }
    for c in comments:
        c.reaction_counts = counts.get(c.id, {})
        c.my_reaction = mine.get(c.id)
        c.liked_by_me = c.id in mine
    return comments


def _get_comment_or_404(db: Session, comment_id: uuid.UUID) -> Comment:
    comment = db.get(Comment, comment_id)
    if comment is None:
        raise HTTPException(status_code=404, detail="Comment not found")
    return comment


@router.get("/{video_post_id}/comments", response_model=list[CommentRead])
def list_comments(
    video_post_id: uuid.UUID,
    current_user: User | None = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    """Powers CommentsPanel.tsx / the mobile comments sheet. Returns a
    flat list — top-level comments and replies alike, distinguished by
    parent_id — same "flat with a parent pointer" shape the model uses;
    CommentsPanel groups replies under their parent client-side."""
    post = db.get(VideoPost, video_post_id)
    if post is None:
        raise HTTPException(status_code=404, detail="Video post not found")
    query = (
        db.query(Comment)
        .options(joinedload(Comment.author))
        .filter(Comment.video_post_id == video_post_id)
    )
    query = hide_shadow_banned(query, Comment.author, Comment.author_id, current_user)
    comments = query.order_by(Comment.created_at.asc()).all()
    return _annotate_comments(comments, current_user, db)


def _resolve_products_and_interests(
    db: Session, product_ids: list[uuid.UUID], interest_ids: list[uuid.UUID]
) -> tuple[list[Product], list[Interest]]:
    products = db.query(Product).filter(Product.id.in_(product_ids)).all() if product_ids else []
    if len(products) != len(set(product_ids)):
        raise HTTPException(status_code=404, detail="One or more products not found")

    interests = db.query(Interest).filter(Interest.id.in_(interest_ids)).all() if interest_ids else []
    if len(interests) != len(set(interest_ids)):
        raise HTTPException(status_code=404, detail="One or more interests not found")

    return products, interests


@router.post("", response_model=VideoPostRead, status_code=status.HTTP_201_CREATED)
def create_video_post(
    payload: VideoPostCreate,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Maps to handleAddShopPost (feed='shop') and handleAddDiscoverPost
    (feed='discover') — one endpoint for both, distinguished by
    payload.feed rather than two separate routes, since they differ only
    in whether a merchant account gets attached and whether products are
    allowed. A shop post requires the poster to actually have a merchant
    account; a discover post never attaches one, matching the model's
    own comment that merchant_id stays null for personal content.
    """
    merchant_id = None
    if payload.feed == VideoFeed.shop:
        if current_user.merchant_account is None:
            raise HTTPException(
                status_code=400, detail="Only a merchant account can post to the shop feed"
            )
        merchant_id = current_user.merchant_account.id

    products, interests = _resolve_products_and_interests(db, payload.product_ids, payload.interest_ids)

    post = VideoPost(
        feed=payload.feed,
        poster_id=current_user.id,
        merchant_id=merchant_id,
        description=payload.description,
        video_url=payload.video_url,
        thumbnail_url=payload.thumbnail_url,
        width=payload.width,
        height=payload.height,
        products=products,
        interests=interests,
    )
    db.add(post)
    db.commit()
    db.refresh(post)
    return post


@router.patch("/{video_post_id}", response_model=VideoPostRead)
def update_video_post(
    video_post_id: uuid.UUID,
    payload: VideoPostUpdate,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Maps to handleUpdateShopPost — only the post's own poster can
    edit it, whether it's a shop or discover post."""
    post = db.get(VideoPost, video_post_id)
    if post is None or post.poster_id != current_user.id:
        raise HTTPException(status_code=404, detail="Video post not found")

    updates = payload.model_dump(exclude_unset=True, exclude={"product_ids", "interest_ids"})
    for field, value in updates.items():
        setattr(post, field, value)

    if payload.product_ids is not None or payload.interest_ids is not None:
        products, interests = _resolve_products_and_interests(
            db, payload.product_ids or [], payload.interest_ids or []
        )
        if payload.product_ids is not None:
            post.products = products
        if payload.interest_ids is not None:
            post.interests = interests

    db.commit()
    db.refresh(post)
    return post


@router.delete("/{video_post_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_video_post(
    video_post_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Maps to handleDeleteShopPost / handleDeleteDiscoverPost."""
    post = db.get(VideoPost, video_post_id)
    if post is None or post.poster_id != current_user.id:
        raise HTTPException(status_code=404, detail="Video post not found")
    db.delete(post)
    db.commit()


@router.post("/{video_post_id}/comments", response_model=CommentRead, status_code=status.HTTP_201_CREATED)
def add_comment(
    video_post_id: uuid.UUID,
    payload: CommentCreate,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Maps to handleAddComment. payload.parent_id posts a reply instead
    of a new top-level comment — must point at a comment that's already
    on *this* post, same "the two ids have to agree" check
    _resolve_products_and_interests does for product/interest ids.

    Replying to a reply is allowed (Facebook-style): threads stay one
    level deep, so the new comment is filed under the reply's top-level
    comment (parent_id = the root) and remembers who it was aimed at
    (reply_to_name) so the UI can show the mention."""
    post = db.get(VideoPost, video_post_id)
    if post is None:
        raise HTTPException(status_code=404, detail="Video post not found")

    root: Comment | None = None
    target: Comment | None = None
    reply_to_user_id = None
    reply_to_name = None
    if payload.parent_id is not None:
        target = db.get(Comment, payload.parent_id)
        if target is None or target.video_post_id != video_post_id:
            raise HTTPException(status_code=404, detail="Comment being replied to not found")
        if target.parent_id is not None:
            # Replying to a reply: attach to its top-level comment and
            # keep the mention of whoever wrote it.
            root = db.get(Comment, target.parent_id)
            reply_to_user_id = target.author_id
            reply_to_name = target.author_display_name
        else:
            root = target

    comment = Comment(
        video_post_id=video_post_id,
        author=current_user,
        text=payload.text,
        parent_id=root.id if root else None,
        reply_to_user_id=reply_to_user_id,
        reply_to_name=reply_to_name,
    )
    db.add(comment)
    post.comments_count += 1
    if root is not None:
        root.replies_count += 1

    # Notify whoever should hear about this — at most two people, never
    # yourself. A reply notifies the author of the specific comment it
    # was aimed at (`target`: the top-level comment for a direct reply,
    # or the reply itself when replying to a reply — see the
    # reply-to-a-reply handling above), the same person Facebook's own
    # "replied to your comment" notification targets. A brand-new
    # top-level comment has no such target, so only the post owner
    # hears about it. The post owner also hears about a reply — unless
    # they're the same person the reply-to notification already went
    # to, which would otherwise double up whenever someone replies to
    # the post owner's own comment.
    notify_ids: set[uuid.UUID] = set()
    if target is not None and target.author_id is not None and target.author_id != current_user.id:
        db.add(
            Notification(
                user_id=target.author_id,
                body=f"{current_user.display_name} replied to your comment.",
                type=NotificationType.comment_reply,
                target_id=video_post_id,
            )
        )
        notify_ids.add(target.author_id)
    if post.poster_id != current_user.id and post.poster_id not in notify_ids:
        db.add(
            Notification(
                user_id=post.poster_id,
                body=f"{current_user.display_name} commented on your video.",
                type=NotificationType.post_comment,
                target_id=video_post_id,
            )
        )

    db.commit()
    db.refresh(comment)
    return _annotate_comments([comment], current_user, db)[0]


@router.patch("/comments/{comment_id}", response_model=CommentRead)
def edit_comment(
    comment_id: uuid.UUID,
    payload: CommentUpdate,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """The "Edit" option on a comment's own menu in CommentsPanel.tsx —
    only the comment's author can do this (not the video's poster, unlike
    moderation-flavored actions elsewhere in this app; a comment stays
    the commenter's own words to edit or not). Sets edited_at, which is
    what drives the "(edited)" marker."""
    comment = _get_comment_or_404(db, comment_id)
    if comment.author_id != current_user.id:
        raise HTTPException(status_code=403, detail="You can only edit your own comments")
    if payload.text != comment.text:
        comment.text = payload.text
        comment.edited_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(comment)
    return _annotate_comments([comment], current_user, db)[0]


@router.delete("/comments/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_comment(
    comment_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """The "Delete" option alongside edit_comment's "Edit". The comment's
    author can delete it, and — like Facebook — so can the owner of the
    post it's on (to clean up their own thread) and an admin.
    Comment.replies has cascade="all, delete-orphan" (see the model), so
    deleting a top-level comment deletes every reply under it too;
    comments_count drops by that whole removed count, not just 1, since
    add_comment increments it for replies as well as top-level comments."""
    comment = _get_comment_or_404(db, comment_id)
    post = comment.video_post
    is_post_owner = post is not None and post.poster_id == current_user.id
    if comment.author_id != current_user.id and not is_post_owner and current_user.role != UserRole.admin:
        raise HTTPException(status_code=403, detail="You can't delete this comment")
    removed = 1 + len(comment.replies)
    post.comments_count = max(0, post.comments_count - removed)
    if comment.parent_id is not None:
        parent = db.get(Comment, comment.parent_id)
        if parent is not None:
            parent.replies_count = max(0, parent.replies_count - 1)
    db.delete(comment)
    db.commit()


def _set_reaction(db: Session, comment: Comment, user: User, reaction: str | None) -> None:
    """Sets (or with None, clears) `user`'s single reaction on `comment`
    and keeps Comment.likes_count (= total reactions) in step. Notifies
    the comment's author only the first time this person reacts to it
    (existing is None) — switching from one reaction to another, or
    clearing it, doesn't fire again, same "don't renotify for the same
    underlying action" reasoning add_comment's own notification skips
    apply. Never notifies for reacting to your own comment."""
    existing = db.execute(
        comment_reactions.select().where(
            comment_reactions.c.user_id == user.id, comment_reactions.c.comment_id == comment.id
        )
    ).first()
    if reaction is None:
        if existing is not None:
            db.execute(
                comment_reactions.delete().where(
                    comment_reactions.c.user_id == user.id, comment_reactions.c.comment_id == comment.id
                )
            )
            comment.likes_count = max(0, comment.likes_count - 1)
    elif existing is None:
        db.execute(comment_reactions.insert().values(user_id=user.id, comment_id=comment.id, reaction=reaction))
        comment.likes_count += 1
        if comment.author_id is not None and comment.author_id != user.id:
            db.add(
                Notification(
                    user_id=comment.author_id,
                    body=f"{user.display_name} reacted to your comment.",
                    type=NotificationType.comment_reaction,
                    target_id=comment.video_post_id,
                )
            )
    elif existing.reaction != reaction:
        db.execute(
            comment_reactions.update()
            .where(comment_reactions.c.user_id == user.id, comment_reactions.c.comment_id == comment.id)
            .values(reaction=reaction)
        )
    db.commit()
    db.refresh(comment)


@router.put("/comments/{comment_id}/reaction", response_model=CommentRead)
def react_to_comment(
    comment_id: uuid.UUID,
    payload: CommentReactionSet,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Pick (or change to) one of like/love/care/haha/wow/sad/angry.
    PUT rather than POST: setting the same reaction twice is a no-op, and
    picking a different one replaces the old — a person has at most one
    reaction per comment."""
    comment = _get_comment_or_404(db, comment_id)
    _set_reaction(db, comment, current_user, payload.reaction)
    return _annotate_comments([comment], current_user, db)[0]


@router.delete("/comments/{comment_id}/reaction", response_model=CommentRead)
def remove_comment_reaction(
    comment_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    comment = _get_comment_or_404(db, comment_id)
    _set_reaction(db, comment, current_user, None)
    return _annotate_comments([comment], current_user, db)[0]


# The two original like verbs stay as thin aliases (a "like" reaction) so
# an older frontend build keeps working.
@router.post("/comments/{comment_id}/like", status_code=status.HTTP_204_NO_CONTENT)
def like_comment(
    comment_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    _set_reaction(db, _get_comment_or_404(db, comment_id), current_user, "like")


@router.delete("/comments/{comment_id}/like", status_code=status.HTTP_204_NO_CONTENT)
def unlike_comment(
    comment_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    _set_reaction(db, _get_comment_or_404(db, comment_id), current_user, None)


@router.get("/comments/{comment_id}/reactions", response_model=list[CommentReactorRead])
def list_comment_reactors(
    comment_id: uuid.UUID,
    reaction: str | None = Query(default=None),
    current_user: User | None = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    """The "who reacted" sheet (tap the emoji summary under a comment).
    Public like list_video_post_likers; optionally filtered to one
    reaction for the per-reaction tabs. Shadow-banned people are hidden
    from everyone but themselves/admins, same as everywhere else."""
    _get_comment_or_404(db, comment_id)
    query = (
        db.query(User, comment_reactions.c.reaction)
        .join(comment_reactions, comment_reactions.c.user_id == User.id)
        .filter(comment_reactions.c.comment_id == comment_id)
    )
    if reaction:
        query = query.filter(comment_reactions.c.reaction == reaction)
    rows = query.order_by(comment_reactions.c.created_at.desc()).limit(200).all()
    hide = current_user is None or current_user.role != UserRole.admin
    return [
        CommentReactorRead(id=u.id, display_name=u.display_name, avatar_url=u.avatar_url, reaction=r)
        for u, r in rows
        if not (hide and u.is_shadow_banned and (current_user is None or u.id != current_user.id))
    ]


@router.post("/comments/{comment_id}/pin", response_model=CommentRead)
def pin_comment(
    comment_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Post owner only. Pins a top-level comment to the top of the thread;
    one pinned comment per post, so pinning another moves the pin."""
    comment = _get_comment_or_404(db, comment_id)
    post = comment.video_post
    if post.poster_id != current_user.id:
        raise HTTPException(status_code=403, detail="Only the post's owner can pin comments")
    if comment.parent_id is not None:
        raise HTTPException(status_code=400, detail="Only top-level comments can be pinned")
    db.query(Comment).filter(Comment.video_post_id == post.id, Comment.is_pinned.is_(True)).update(
        {Comment.is_pinned: False}, synchronize_session=False
    )
    comment.is_pinned = True
    db.commit()
    db.refresh(comment)
    return _annotate_comments([comment], current_user, db)[0]


@router.delete("/comments/{comment_id}/pin", response_model=CommentRead)
def unpin_comment(
    comment_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    comment = _get_comment_or_404(db, comment_id)
    if comment.video_post.poster_id != current_user.id:
        raise HTTPException(status_code=403, detail="Only the post's owner can unpin comments")
    comment.is_pinned = False
    db.commit()
    db.refresh(comment)
    return _annotate_comments([comment], current_user, db)[0]


@router.post("/{video_post_id}/watchlist", status_code=status.HTTP_204_NO_CONTENT)
def add_to_watchlist(
    video_post_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Maps to the "save" side of handleToggleSave."""
    post = db.get(VideoPost, video_post_id)
    if post is None:
        raise HTTPException(status_code=404, detail="Video post not found")
    if post not in current_user.watchlist:
        current_user.watchlist.append(post)
        db.commit()


@router.delete("/{video_post_id}/watchlist", status_code=status.HTTP_204_NO_CONTENT)
def remove_from_watchlist(
    video_post_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Maps to the "un-save" side of handleToggleSave. A toggle in the
    frontend, but two separate REST verbs here — POST to add, DELETE to
    remove — rather than one endpoint that flips state, so the client
    always knows which way it just went instead of having to track it
    itself."""
    post = db.get(VideoPost, video_post_id)
    if post is None:
        raise HTTPException(status_code=404, detail="Video post not found")
    if post in current_user.watchlist:
        current_user.watchlist.remove(post)
        db.commit()


@router.get("/{video_post_id}/likes", response_model=list[PersonResult])
def list_video_post_likers(video_post_id: uuid.UUID, db: Session = Depends(get_db)):
    """Who's liked this post — tapping the like count on VideoStage opens
    this list. Public, no auth required, same PersonResult shape and
    reasoning as list_followers/list_following on users.py: a post's
    likes are visible to anyone who can see the post itself. Reads
    `post.liked_by` (the real post_likes-table relationship) rather than
    `likes_count` (a denormalized counter bumped alongside it in
    like_video_post/unlike_video_post below) — the counter is what
    powers the cheap display number everywhere else, but this needs the
    actual people, not just how many."""
    post = db.get(VideoPost, video_post_id)
    if post is None:
        raise HTTPException(status_code=404, detail="Video post not found")
    return post.liked_by


@router.post("/{video_post_id}/like", status_code=status.HTTP_204_NO_CONTENT)
def like_video_post(
    video_post_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Maps to the "like" side of VideoStage's Like toggle — was purely
    local optimistic state before (activeEngagement in VideoStage), never
    sent anywhere. likes_count is bumped here rather than derived by
    counting post_likes on every read, same as watchlist_items describes.
    Notifies the poster (skipped when liking your own post — nobody
    needs telling they liked their own video)."""
    post = db.get(VideoPost, video_post_id)
    if post is None:
        raise HTTPException(status_code=404, detail="Video post not found")
    if post not in current_user.liked_posts:
        current_user.liked_posts.append(post)
        post.likes_count += 1
        if post.poster_id != current_user.id:
            db.add(
                Notification(
                    user_id=post.poster_id,
                    body=f"{current_user.display_name} liked your video.",
                    type=NotificationType.post_like,
                    target_id=post.id,
                )
            )
        db.commit()


@router.delete("/{video_post_id}/like", status_code=status.HTTP_204_NO_CONTENT)
def unlike_video_post(
    video_post_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Maps to the "unlike" side. Two verbs rather than one flip-state
    endpoint, same reasoning as remove_from_watchlist above."""
    post = db.get(VideoPost, video_post_id)
    if post is None:
        raise HTTPException(status_code=404, detail="Video post not found")
    if post in current_user.liked_posts:
        current_user.liked_posts.remove(post)
        post.likes_count = max(0, post.likes_count - 1)
        db.commit()


@router.post("/{video_post_id}/share", status_code=status.HTTP_204_NO_CONTENT)
def share_video_post(
    video_post_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Maps to the "share" side of VideoStage's Share toggle. Real
    platforms don't usually let you "unshare," but the frontend already
    treated this as a symmetric toggle right alongside Like before this
    — see post_shares' own comment in models/video.py — so this persists
    that behavior rather than quietly redesigning it."""
    post = db.get(VideoPost, video_post_id)
    if post is None:
        raise HTTPException(status_code=404, detail="Video post not found")
    if post not in current_user.shared_posts:
        current_user.shared_posts.append(post)
        post.shares_count += 1
        db.commit()


@router.delete("/{video_post_id}/share", status_code=status.HTTP_204_NO_CONTENT)
def unshare_video_post(
    video_post_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Maps to the "unshare" side."""
    post = db.get(VideoPost, video_post_id)
    if post is None:
        raise HTTPException(status_code=404, detail="Video post not found")
    if post in current_user.shared_posts:
        current_user.shared_posts.remove(post)
        post.shares_count = max(0, post.shares_count - 1)
        db.commit()


@router.post("/{video_post_id}/repost", response_model=VideoPostRead, status_code=status.HTTP_201_CREATED)
def create_repost(
    video_post_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """The "Repost" option in ShareSheet.tsx — reposts video_post_id
    into current_user's own presence in whichever feed it already lives
    in. There's deliberately no `feed` on this request: the new row
    always takes original.feed, so a shop post can only ever be
    reposted into the shop feed and a discover post into discover —
    there's no field here that could cross the two.

    video_post_id may itself already be a repost (reposting something
    from your own feed that's someone else's repost) — this always
    resolves down to the real original first, so reposts never chain
    and a shop repost's product tags/merchant always trace back to one
    actual original post, never to an intermediate repost with no
    content of its own.

    Idempotent: reposting something you've already reposted returns
    your existing repost rather than creating a second feed entry for
    the same content.
    """
    post = db.get(VideoPost, video_post_id)
    if post is None:
        raise HTTPException(status_code=404, detail="Video post not found")
    original = post.repost_of if post.repost_of_id is not None else post
    if original.poster_id == current_user.id:
        raise HTTPException(status_code=400, detail="You can't repost your own post")
    existing = (
        db.query(VideoPost)
        .options(*_VIDEO_POST_LOAD_OPTIONS)
        .filter(VideoPost.poster_id == current_user.id, VideoPost.repost_of_id == original.id)
        .first()
    )
    if existing is not None:
        return _resolve_video_post_for_read(existing)
    repost = VideoPost(feed=original.feed, poster_id=current_user.id, repost_of_id=original.id, description="")
    db.add(repost)
    db.commit()
    db.refresh(repost)
    repost = (
        db.query(VideoPost).options(*_VIDEO_POST_LOAD_OPTIONS).filter(VideoPost.id == repost.id).first()
    )
    return _resolve_video_post_for_read(repost)


@router.delete("/{video_post_id}/repost", status_code=status.HTTP_204_NO_CONTENT)
def delete_repost(
    video_post_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Removes current_user's own repost of video_post_id. Works whether
    video_post_id is the original's own id or another repost of the
    same original (see create_repost's own comment on resolving down to
    the real original first) — either way this looks up and removes the
    one repost row that's actually current_user's. No-op if they never
    reposted it; doesn't touch the original post or anyone else's
    repost of it."""
    post = db.get(VideoPost, video_post_id)
    if post is None:
        raise HTTPException(status_code=404, detail="Video post not found")
    original = post.repost_of if post.repost_of_id is not None else post
    existing = (
        db.query(VideoPost)
        .filter(VideoPost.poster_id == current_user.id, VideoPost.repost_of_id == original.id)
        .first()
    )
    if existing is not None:
        db.delete(existing)
        db.commit()
