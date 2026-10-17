import enum
import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Integer, Numeric, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin, uuid_pk


class DiscountKind(str, enum.Enum):
    percent = "percent"
    fixed = "fixed"


class DiscountCode(Base, TimestampMixin):
    """A platform-wide promo code (SAVE10, WELCOME5) — same "platform
    business, not a merchant setting" reasoning as DeliveryCompany
    (app/models/delivery.py): nothing here is scoped to a single
    merchant, since a cart can span several merchants and one code
    needs to make sense against the whole checkout subtotal, not one
    seller's line items.

    No creation endpoint yet — same limitation as DeliveryCompany (see
    its own comment for why), codes exist via seed.py until there's an
    admin surface to manage them from (missing-pieces list item #12).
    What IS real: app/discounts.py's preview_discount/redeem_discount
    are what actually validate and apply one at checkout, called from
    /payments/initialize (the amount a code produces) and
    routers/payments.py's _fulfill (where a code is actually "spent" —
    see redeem_discount's own comment on why that's a separate step
    from previewing one).
    """

    __tablename__ = "discount_codes"

    id: Mapped[uuid.UUID] = uuid_pk()
    # Stored and matched uppercase — codes are case-insensitive from the
    # person's side (SAVE10 and save10 mean the same thing), normalized
    # once in app/discounts.py rather than at every comparison site.
    code: Mapped[str] = mapped_column(String(30), unique=True, index=True)
    kind: Mapped[DiscountKind] = mapped_column(Enum(DiscountKind, name="discount_kind"))
    # percent: a 0-100 number (15 means 15% off). fixed: a currency
    # amount off, in the same units as Product.price (whatever
    # PAYSTACK_CURRENCY is set to) — not Paystack's subunit convention,
    # matching every other Numeric(10, 2) money column in this app.
    value: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    # Only meaningful for kind == percent — caps how much a percentage
    # can knock off a large order ("15% off, up to $20"). Ignored for
    # kind == fixed, where `value` is already the exact amount.
    max_discount_amount: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    # Checked against the product subtotal only, before shipping is
    # added — same "subtotal" PaymentInitializeRead already breaks out
    # as its own number from shipping_fee.
    min_subtotal: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # None = unlimited overall redemptions.
    max_redemptions: Mapped[int | None] = mapped_column(Integer, nullable=True)
    redemption_count: Mapped[int] = mapped_column(Integer, default=0)
    # None = no per-person cap; 1 (the usual case for a welcome code)
    # means each account can redeem this exactly once, ever — checked
    # against DiscountRedemption rows for (code, user), not a counter
    # on User itself, so a given account's history stays auditable per
    # code rather than collapsed into one number.
    max_redemptions_per_user: Mapped[int | None] = mapped_column(Integer, nullable=True, default=1)

    redemptions: Mapped[list["DiscountRedemption"]] = relationship(back_populates="discount_code")


class DiscountRedemption(Base, TimestampMixin):
    """One row per successful use — created in redeem_discount
    (app/discounts.py), called from routers/payments.py's _fulfill at
    the same moment reserve_stock() actually decrements stock, not at
    /payments/initialize: an abandoned Paystack popup must not count
    against a one-per-person code, the same reasoning reserve_stock's
    own comment gives for why it isn't called at initialize either.
    amount_off is a snapshot of what this specific redemption actually
    saved — the code's own value/kind can change later without
    rewriting what a past order's receipt should keep showing.
    """

    __tablename__ = "discount_redemptions"

    id: Mapped[uuid.UUID] = uuid_pk()
    discount_code_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("discount_codes.id", ondelete="CASCADE")
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE")
    )
    # Nullable, SET NULL — same reasoning as Order.payment_id: a Payment
    # row must never be blocked from deletion by a redemption record
    # still pointing at it.
    payment_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("payments.id", ondelete="SET NULL"), nullable=True
    )
    amount_off: Mapped[Decimal] = mapped_column(Numeric(10, 2))

    discount_code: Mapped["DiscountCode"] = relationship(back_populates="redemptions")
