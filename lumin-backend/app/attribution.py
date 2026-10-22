import uuid

from sqlalchemy.orm import Session

from app.models import VideoPost


def resolve_source_post(
    db: Session, video_post_id: uuid.UUID | None, product_id: uuid.UUID | None
) -> VideoPost | None:
    """The video post a purchase/cart-add should be credited to, or None.

    The client says which post the buyer was watching; this only believes
    it when that post (a repost resolves to its original) actually has the
    product tagged. Anything else — unknown post, product not tagged
    there, a made-up id — is treated as "no source", never an error:
    attribution must not be able to break a purchase.
    """
    if video_post_id is None or product_id is None:
        return None
    post = db.get(VideoPost, video_post_id)
    if post is None:
        return None
    if post.repost_of_id is not None:
        post = db.get(VideoPost, post.repost_of_id)
        if post is None:
            return None
    if any(p.id == product_id for p in post.products):
        return post
    # A retwin shows the original's products alongside its own: a product
    # that isn't the retwin's own is credited to the original.
    if post.retwin_of_id is not None:
        root = db.get(VideoPost, post.retwin_of_id)
        if root is not None and any(p.id == product_id for p in root.products):
            return root
    return None
