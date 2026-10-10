import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from .catalog import ProductRead
from .twin_search import Box


class WantedItem(BaseModel):
    # The earliest search in the group (preferring one made on a video moment): the
    # handle for every /wanted/{id} call.
    id: uuid.UUID
    query: str
    count: int  # different shoppers who want it
    status: Literal["open", "fulfilled"]
    upvoted: bool = False
    notifying: bool = False
    has_clip: bool = False
    created_at: datetime
    # How many products sellers have twinned to it (what the compare list shows).
    twinned: int = 0
    # The moment, for the wall tile. A short clip is shown as a still, a longer one loops.
    video_post_id: uuid.UUID | None = None
    start_ms: int | None = None
    end_ms: int | None = None
    # The circled part of the frame, if the first shopper circled something.
    box: Box | None = None
    box_at_ms: int | None = None  # the frame it was circled on
    video_url: str | None = None
    thumbnail_url: str | None = None
    width: int | None = None
    height: int | None = None
    creator_name: str | None = None
    creator_avatar_url: str | None = None
    # Photos of the first few twins (official first), for the stack on the tile.
    twin_previews: list[str] = []
    # fulfilled only: the product a seller offered / that was listed for it.
    fulfilled_product: ProductRead | None = None


class WantedList(BaseModel):
    open_count: int
    items: list[WantedItem]


class WantedEvent(BaseModel):
    kind: Literal["wanted", "listed"]
    at: datetime


class WantedDetail(WantedItem):
    events: list[WantedEvent] = []


class WantedNotify(BaseModel):
    notify: bool


class WantedOffer(BaseModel):
    product_id: uuid.UUID = Field(...)


class TwinOption(BaseModel):
    """One product twinned to a wanted moment, as the compare list shows it."""

    product: ProductRead
    # official: the video's own poster put it there; confirmed: shoppers bought and kept
    # it (or the poster approved it); offered: a seller says it fits, nobody has confirmed.
    kind: Literal["official", "confirmed", "offered"]
    # Only true when an official twin exists and this isn't it - never claimed otherwise.
    similar: bool = False
    match: Literal["strong", "good", "partial", "weak"]
    kept: int = 0  # different shoppers who bought it and kept it
    seller_name: str | None = None
    mine: bool = False  # offered by the viewer (so they can withdraw it)


class WantedTwins(BaseModel):
    items: list[TwinOption]
    has_official: bool = False


class WantedLead(BaseModel):
    """An open request one of the seller's own products already fits."""

    request: WantedItem
    product: ProductRead  # the seller's best-fitting product
    match: Literal["strong", "good", "partial", "weak"]


class TwinChoice(BaseModel):
    """One of the viewer's own products in the "Twin it" sheet."""

    product: ProductRead
    match: Literal["strong", "good", "partial", "weak"]
    twinned: bool = False  # already offered for this request


class WantedTwinResult(BaseModel):
    notified: int
    option: TwinOption


TwinReportReason = Literal["counterfeit", "likeness", "mismatch", "ownership"]


class TwinReportCreate(BaseModel):
    reason: TwinReportReason
    detail: str | None = Field(default=None, max_length=500)


class MomentWord(BaseModel):
    word: str
    count: int  # different shoppers who used it


class MomentSignals(BaseModel):
    """What others did on this moment: counts and shared words only, never who."""

    asked: int = 0
    circled: int = 0
    words: list[MomentWord] = []
