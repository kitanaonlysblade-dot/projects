import uuid
from typing import Generic, TypeVar

from pydantic import BaseModel, ConfigDict

from .catalog import ProductRead
from .video import VideoPostRead

T = TypeVar("T")


class PersonResult(BaseModel):
    """A thin, public-safe slice of User for SearchScreen.tsx's People
    section — search results are visible to anyone, logged in or not,
    so this deliberately leaves out email, shipping_address, and the
    settings toggles UserRead exposes to the account's own owner.

    bio/following_count/followers_count are public on any profile (the
    same numbers a UserRead-holding viewer sees on their own account),
    so they're included here too — this is also the shape
    get_user_public_profile returns, which is PosterProfileScreen.tsx's
    only source for another account's counts. from_attributes picks up
    following_count/followers_count from User's computed properties the
    same way UserRead does, so they're never stale: reflect whatever the
    `follows` table now says, not a client-cached number."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    username: str
    display_name: str
    avatar_url: str | None = None
    bio: str = ""
    following_count: int
    followers_count: int
    # Lets PosterProfileScreen.tsx decide upfront whether the Followers/
    # Following labels should be tappable, rather than rendering them as
    # live buttons and only discovering they're gated after a 403 comes
    # back from list_followers/list_following. See the User model's own
    # comment on the underlying column for what this does and doesn't
    # restrict — the counts above are still always shown even when true.
    private_follow_lists: bool = False
    # Same idea, for list_mutual_followers — lets PosterProfileScreen.tsx
    # skip even offering the "X mutual followers" row for an account
    # that's hidden it, rather than showing it and having the request
    # 403. private_follow_lists implies this too (see the User model's
    # comment), but the frontend still needs this one to catch the case
    # where only hide_mutual_followers is set.
    hide_mutual_followers: bool = False


class SearchSection(BaseModel, Generic[T]):
    """One of the four result groups on SearchScreen.tsx (People/
    Products/Feed/Discover). `total` is the full match count regardless
    of limit/offset, so the frontend can show e.g. "Products (137)" in
    a section header even though `items` only holds one page of it."""

    items: list[T]
    total: int


class SearchResponse(BaseModel):
    """GET /search's response — one optional section per SearchScreen.tsx
    category. A section is None when `filter` didn't ask for it (so
    picking a specific tab doesn't pay for the other three queries),
    not when it matched zero results — a requested-but-empty section is
    still a SearchSection with an empty items list, not None."""

    people: SearchSection[PersonResult] | None = None
    products: SearchSection[ProductRead] | None = None
    feed: SearchSection[VideoPostRead] | None = None
    discover: SearchSection[VideoPostRead] | None = None
