import uuid

from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin, uuid_pk


class MerchantAccount(Base, TimestampMixin):
    """Maps to MerchantAccount in lib/types.ts. One per user — the "v1
    scope" page.tsx's own comment describes above its `merchantAccount`
    state — enforced here with unique=True on user_id rather than a
    separate join table, since a second merchant account per user isn't
    a supported case yet.

    No shipping-fee settings here on purpose — delivery pricing belongs
    to whichever DeliveryCompany (models/delivery.py) actually fulfils
    it, not to the merchant selling the product. See that model's own
    comment, and compute_shipping_fee in app/shipping.py, for how a
    fee is actually resolved at checkout.
    """

    __tablename__ = "merchant_accounts"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), unique=True
    )
    business_name: Mapped[str] = mapped_column(String(150))
    category: Mapped[str] = mapped_column(String(100))
    description: Mapped[str] = mapped_column(String(1000), default="")
    # Set together, once, by POST /merchant/payout — never edited
    # piecemeal, since account_name and paystack_recipient_code are both
    # derived FROM bank_code+account_number via Paystack's own API
    # (create_transfer_recipient in app/paystack.py), not independently
    # user-editable facts. All four null until a merchant actually adds
    # payout details; app/escrow.py's release_to_merchant refuses to pay
    # out to a merchant who hasn't yet.
    bank_code: Mapped[str | None] = mapped_column(String(20), nullable=True)
    account_number: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # Resolved from Paystack, not typed in by the merchant — the point is
    # confirming "yes, this account number really does belong to this
    # name" before money ever gets sent to it.
    account_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    paystack_recipient_code: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # Keyword insights (what shoppers search for and can't find) are a paid
    # feature: active while this is in the future. Null = never subscribed.
    # Set by an admin for now (POST /admin/merchants/{id}/insights); the
    # Paystack subscription flow that renews it is not built yet.
    insights_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped["User"] = relationship(back_populates="merchant_account")
    products: Mapped[list["Product"]] = relationship(back_populates="merchant")
    video_posts: Mapped[list["VideoPost"]] = relationship(back_populates="merchant")

    # Not a column — see paystack_recipient_code's own comment. Picked
    # up by MerchantAccountRead (from_attributes) the same way
    # Product.in_stock is picked up by ProductRead.
    @property
    def payout_ready(self) -> bool:
        return self.paystack_recipient_code is not None

    @property
    def insights_active(self) -> bool:
        return self.insights_until is not None and self.insights_until > datetime.now(timezone.utc)
