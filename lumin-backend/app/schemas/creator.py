import uuid
from typing import Literal

from pydantic import BaseModel

from .catalog import ProductRead


class CreatorMoment(BaseModel):
    """A moment from the creator's own videos that shoppers are asking about."""

    request_id: uuid.UUID
    query: str
    wants: int
    twinned: int
    video_post_id: uuid.UUID
    thumbnail_url: str | None = None
    start_ms: int | None = None
    end_ms: int | None = None
    mine: bool = False  # the creator has already twinned one of their own products here


class CreatorImpact(BaseModel):
    wanted: int  # different shoppers who asked about moments in the creator's videos
    twins_offered: int  # products sellers have twinned to those moments
    twins_approved: int
    can_tag: bool  # has a shop, so can twin their own products
    moments: list[CreatorMoment]


class CreatorTwin(BaseModel):
    link_id: uuid.UUID
    video_post_id: uuid.UUID
    product: ProductRead
    seller_name: str | None = None
    new_seller: bool = False
    for_query: str | None = None
    match: Literal["strong", "good", "partial", "weak"] | None = None
    kept: int = 0
    state: Literal["review", "approved", "hidden"]
    start_ms: int
    end_ms: int


class CreatorTwins(BaseModel):
    review: int
    approved: int
    hidden: int
    items: list[CreatorTwin]
