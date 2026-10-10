import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, EmailStr

from app.models.user import UserRole

from .address import ShippingAddress, ShippingAddressUpdate


class UserBase(BaseModel):
    username: str
    display_name: str
    bio: str = ""
    avatar_url: str | None = None
    # None on every account until they set one — nothing requires it (no
    # UI collects it at signup; CreateAccountScreen.tsx fakes signup
    # entirely client-side anyway, per the User model's own docstring).
    # The one thing that reads this is sync_birthday_notifications
    # (app/notifications.py), which only ever looks at month/day, never
    # the year — the year is stored because SQL has no "month+day only"
    # date type, not because anything cares how old someone is.
    birthday: date | None = None
    # Settings toggles — defaulted here (not just on the model) so a
    # UserCreate payload that never mentions them still validates; signup
    # doesn't actually pass these through though (see routers/auth.py's
    # explicit field-by-field User(...) construction), so it's the
    # model's own column defaults that end up taking effect either way.
    autoplay_next: bool = False
    default_muted: bool = True
    # See the User model's own comment on this column — gates
    # list_followers/list_following, nothing else.
    private_follow_lists: bool = False
    hide_mutual_followers: bool = False


class UserCreate(UserBase):
    email: EmailStr
    # None for the "Continue with Google" path (handleGoogleSignIn in
    # CreateAccountScreen.tsx) — same reasoning as hashed_password being
    # nullable on the User model.
    password: str | None = None


class UserUpdate(BaseModel):
    """PATCH /users/me — every field optional and applied with
    exclude_unset so a client can send just {"bio": "..."} without
    clobbering display_name back to whatever it happened to send (or
    omit). Three callers now: ProfileScreen.tsx's draftName/draftBio,
    SettingsScreen.tsx's autoplay/mute toggles, and — indirectly —
    checkout, which PATCHes shipping_address after a successful order to
    remember it as "last used" (see payments.py's initialize_payment).
    username, email, and avatar_url aren't editable from any UI screen
    today, so there's nothing calling this with them yet, but leaving
    them here means the route doesn't need to change if one grows an
    avatar picker or a username field later.
    """

    username: str | None = None
    display_name: str | None = None
    bio: str | None = None
    avatar_url: str | None = None
    birthday: date | None = None
    autoplay_next: bool | None = None
    default_muted: bool | None = None
    private_follow_lists: bool | None = None
    hide_mutual_followers: bool | None = None
    # A *partial* address (see ShippingAddressUpdate) — merged onto
    # whatever the user already has saved (users.py's update route does
    # that merge), not a wholesale replacement. Sending just
    # {"shipping_address": {"line2": "Apt 4B"}} only changes line2.
    shipping_address: ShippingAddressUpdate | None = None


class UserRead(UserBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: EmailStr
    # Not plain columns on the User model — computed properties backed by
    # the `following`/`followers` relationships instead (see the model),
    # so from_attributes picks them up like any other field. No special
    # handling needed in the routes that return this.
    following_count: int
    followers_count: int
    # None until every required field of a complete address is set (see
    # ShippingAddressMixin.has_shipping_address) — a brand-new account,
    # or one that's simply never checked out, has no saved default yet.
    shipping_address: ShippingAddress | None = None
    # Deliberately NOT on UserBase (and so not on UserCreate/UserUpdate)
    # — a signup or profile-edit payload setting its own role or ban
    # status would be a privilege-escalation bug, not a feature. Only
    # ever set by the database directly (role) or by routers/admin.py
    # (the ban fields); this schema only ever reads them. is_active and
    # role let the frontend tell a suspended session apart from a
    # normal one (and the admin frontend tell whether it actually logged
    # into an admin account) right from GET /auth/me / login's own
    # response, without a separate request.
    is_active: bool
    role: UserRole
    # Read-only, same reasoning as is_active/role just above — a
    # suspended session needs to actually show why, not just that it
    # is one, for the suspension screen's appeal form to make sense.
    # Both stay None on an account that's never been banned; see the
    # ban_reason/banned_at columns' own comment on User for why they're
    # cleared (not archived) on unban rather than kept as history.
    ban_reason: str | None = None
    banned_at: datetime | None = None
    ban_reason: str | None = None
    banned_at: datetime | None = None
