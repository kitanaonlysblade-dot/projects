import uuid
from decimal import Decimal

from sqlalchemy import Boolean, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin, uuid_pk


class DeliveryCompany(Base, TimestampMixin):
    """A logistics/courier partner embedded in the platform — not a
    merchant, not a buyer. Delivery pricing is this entity's own
    business, independent of who's selling the product: a merchant's
    settings say nothing about what it costs to actually ship something,
    the same way a real seller on a marketplace doesn't set FedEx's
    rates.

    Built to hold more than one row so a second courier can be added
    later without a schema change (a different rate for a different
    region, a backup carrier, etc.) — but nothing in this app assigns
    a shipment to a *specific* company yet beyond "whichever one is
    active". `is_active` is how exactly one gets picked for that:
    compute_shipping_fee (app/shipping.py) always prices a checkout
    against the single company with is_active=True, falling back to a
    fixed platform default (DEFAULT_SHIPPING_FLAT_FEE) if none is
    active at all — never against more than one at once, since nothing
    here yet decides which company should handle which order. Enabling
    a second at the same time as the first is meaningless with today's
    lookup (compute_shipping_fee takes whichever one comes back first)
    and worth guarding against — see the same function's own comment —
    once this actually needs more than one company active
    simultaneously.

    free_shipping_threshold is nullable, not zero, because "no
    free-shipping tier at all" and "free shipping above $0" are
    genuinely different settings — same reasoning MerchantAccount's
    now-removed shipping fields used to document before this model took
    over that responsibility.
    """

    __tablename__ = "delivery_companies"

    id: Mapped[uuid.UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(150))
    shipping_flat_fee: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("4.99"))
    free_shipping_threshold: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=False)
