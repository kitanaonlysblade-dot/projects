from pydantic import BaseModel, ConfigDict


class ShippingAddress(BaseModel):
    """Nested shape used in three places: as a saved default on
    UserRead, as what's sent once at checkout (PaymentInitializeCreate,
    or orders.py's OrderCreate for the legacy no-payment path) and never
    again per-order after that, and as the permanent snapshot read back
    on OrderRead. All three read this off a model's computed
    `shipping_address` property (see ShippingAddressMixin in
    models/base.py) — from_attributes validates straight off the dict
    that property returns.

    state and postal_code are optional — not every country's addressing
    scheme uses either. Every other field is required: this type
    describes a *complete, usable* address, not a form-in-progress (see
    ShippingAddressUpdate for that).
    """

    model_config = ConfigDict(from_attributes=True)

    recipient_name: str
    phone: str
    line1: str
    line2: str | None = None
    city: str
    state: str | None = None
    postal_code: str | None = None
    country: str


class ShippingAddressUpdate(BaseModel):
    """Same fields as ShippingAddress, all optional — PATCH /users/me
    accepts a partial address the same way it already accepts a partial
    display_name/bio (see UserUpdate's exclude_unset handling). Kept as
    its own type rather than reusing ShippingAddress with defaults,
    because "recipient_name omitted" and "recipient_name required but
    missing" need to mean different things here than they do on
    ShippingAddress itself.
    """

    recipient_name: str | None = None
    phone: str | None = None
    line1: str | None = None
    line2: str | None = None
    city: str | None = None
    state: str | None = None
    postal_code: str | None = None
    country: str | None = None
