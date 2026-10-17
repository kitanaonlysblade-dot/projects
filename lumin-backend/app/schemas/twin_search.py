import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models.twin_search import TwinSearchStatus
from app.twin_config import MAX_REQUEST_CLIP_MS, MIN_TWIN_MS

from .catalog import ProductRead

MAX_VIDEO_MS = 6 * 60 * 60 * 1000


class Box(BaseModel):
    """A circled part of the frame, as fractions of it (left, top, width, height)."""

    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    w: float = Field(ge=0.03, le=1)
    h: float = Field(ge=0.03, le=1)

    @model_validator(mode="after")
    def _inside(self):
        if self.x + self.w > 1.001 or self.y + self.h > 1.001:
            raise ValueError("The circle has to stay inside the frame")
        return self


class TwinSearchCreate(BaseModel):
    """"What is this?" - a description, optionally with the clipped moment of a
    video it is about. A clip needs both ends; a plain discovery search has neither."""

    model_config = ConfigDict(str_strip_whitespace=True)

    query: str = Field(min_length=2, max_length=300)
    category_id: uuid.UUID | None = None
    video_post_id: uuid.UUID | None = None
    start_ms: int | None = Field(default=None, ge=0, le=MAX_VIDEO_MS)
    end_ms: int | None = Field(default=None, ge=0, le=MAX_VIDEO_MS)
    box: Box | None = None
    # The frame (ms into the video) the circle was drawn on; inside the clip.
    box_at_ms: int | None = Field(default=None, ge=0, le=MAX_VIDEO_MS)

    @model_validator(mode="after")
    def _sane_clip(self):
        has = (self.start_ms is not None, self.end_ms is not None)
        if any(has) and not all(has):
            raise ValueError("Send both start_ms and end_ms, or neither")
        if all(has):
            if self.video_post_id is None:
                raise ValueError("A clip needs the video it came from")
            length = self.end_ms - self.start_ms
            if length < MIN_TWIN_MS:
                raise ValueError(f"Clip at least {MIN_TWIN_MS / 1000:g} second(s)")
            if length > MAX_REQUEST_CLIP_MS:
                raise ValueError(f"Clip at most {MAX_REQUEST_CLIP_MS // 1000} seconds")
        if self.box is not None and not all(has):
            raise ValueError("Circle something on a clipped moment of a video")
        if self.box_at_ms is not None:
            if self.box is None:
                raise ValueError("box_at_ms goes with a circle")
            if not (self.start_ms <= self.box_at_ms <= self.end_ms):
                raise ValueError("Circle a frame inside the clip")
        return self


class TwinSearchResult(BaseModel):
    product: ProductRead
    score: float
    # twin: the seller tagged it on this very moment; crowd: shoppers confirmed it
    # there; search: matched the description (and picture, when available).
    source: Literal["twin", "crowd", "search"]


class TwinSearchRead(BaseModel):
    id: uuid.UUID
    query: str
    status: TwinSearchStatus
    video_post_id: uuid.UUID | None = None
    start_ms: int | None = None
    end_ms: int | None = None
    category_id: uuid.UUID | None = None
    results: list[TwinSearchResult] = []
    # Only when results is empty: the nearest products we do have (not matches).
    closest: list[TwinSearchResult] = []
    message: str
    created_at: datetime


class TwinSearchSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    query: str
    status: TwinSearchStatus
    video_post_id: uuid.UUID | None = None
    start_ms: int | None = None
    end_ms: int | None = None
    matched_product: ProductRead | None = None
    created_at: datetime
    notified_at: datetime | None = None


class TwinSearchPick(BaseModel):
    product_id: uuid.UUID
    # cart is a weaker signal than buy; the server weights them 1 and 2.
    action: Literal["cart", "buy"]


class MomentProductRead(BaseModel):
    product: ProductRead
    start_ms: int
    end_ms: int
    # Distinct shoppers who picked it (not how many bought and kept it - see app/moment_index.py).
    confirmations: int
    source: Literal["twin", "crowd"]
    # 0..1; 1.0 for the seller's own twin. Only trusted links are ever returned.
    confidence: float = 1.0
    # Set for crowd links; the poster uses it to confirm or reject.
    link_id: uuid.UUID | None = None
    reviewed: bool = False


class MomentCandidateRead(BaseModel):
    """For the video's poster only: a shopper-suggested link not trusted yet."""

    link_id: uuid.UUID
    product: ProductRead
    start_ms: int
    end_ms: int
    shoppers: int
    buyers: int


class MomentLinkReview(BaseModel):
    decision: Literal["confirm", "reject", "clear"]


class KeywordInsight(BaseModel):
    keyword: str
    example: str
    # Numbers are None on the locked preview.
    searchers: int | None = None
    searches: int | None = None
    unmet_searchers: int | None = None
    last_searched_at: datetime | None = None


class KeywordInsightsRead(BaseModel):
    locked: bool
    window_days: int
    items: list[KeywordInsight]


class InsightsGrant(BaseModel):
    days: int = Field(ge=1, le=366)
