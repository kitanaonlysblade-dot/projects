import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from .video import VideoPostRead


class ScanSuggestion(BaseModel):
    """A close-but-not-sure result, shown as "Did you mean this video?". Never the same as a match."""

    video_post_id: uuid.UUID
    at_s: float | None = None


class ScanMatchRead(BaseModel):
    """Result of scanning a recording. `video_post_id` is None when nothing was sure enough (never a guess)."""

    found: bool
    video_post_id: uuid.UUID | None = None
    # Where in the original the recording starts, in seconds.
    at_s: float | None = None
    stage: str | None = None
    clip_s: float | None = None
    # Share (0..1) of the screen that looked covered by buttons, captions or stickers; only after a cell match.
    covered: float | None = None
    # True while an admin review of a duplicate upload involving this video is open.
    disputed: bool = False
    # The matched video is a "verified original" (see VideoPost.verified_original).
    verified_original: bool = False
    message: str | None = None
    # Only from POST /scan/match-features: nothing was found from the phone's fingerprint, and sending the recording
    # itself could still find it (it enables the local-details check). The app asks the person first.
    deeper_check: bool = False
    # Only when found is False: one video came close but not close enough to claim. The app asks "Did you mean this?".
    suggestion: ScanSuggestion | None = None


class ScanLinkRequest(BaseModel):
    url: str = Field(min_length=3, max_length=2000)


class ScanVideoPageRead(BaseModel):
    """Everything the public page for one video needs."""

    post: VideoPostRead
    # First time the platform saw this video (when its fingerprint was made); None until that has happened.
    registered_at: datetime | None = None
    disputed: bool = False
    verified_original: bool = False


class ScanMineItem(BaseModel):
    video_post_id: uuid.UUID
    scans: int
    scans_7d: int
    product_taps: int


class ScanPostBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    poster_id: uuid.UUID
    poster_display_name: str
    description: str = ""
    created_at: datetime


class ScanFlagRead(BaseModel):
    id: uuid.UUID
    stage: str
    status: str
    note: str | None = None
    created_at: datetime
    resolved_at: datetime | None = None
    later: ScanPostBrief
    earlier: ScanPostBrief


class ScanFlagResolve(BaseModel):
    # dismissed = not the same video; confirmed = it is a copy
    status: str = Field(pattern="^(dismissed|confirmed)$")
    note: str | None = Field(default=None, max_length=300)
