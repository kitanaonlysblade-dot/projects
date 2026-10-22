import uuid
from datetime import datetime

from sqlalchemy import DateTime, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    """Shared declarative base — every model in app/models/ inherits from
    this so they all register on the same MetaData, which is what lets
    Alembic autogenerate migrations that see every table at once."""

    pass


class TimestampMixin:
    """created_at / updated_at columns. None of the mock data in the
    frontend's lib/data.ts tracks these (it's just static seed arrays),
    but a real backend needs them for ordering feeds, auditing edits,
    and debugging — so every table below that represents something a
    user creates or edits picks this up."""

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


def uuid_pk() -> Mapped[uuid.UUID]:
    """Every table's primary key. The frontend's mock ids are plain
    strings like 'prod-1' — fine for a hardcoded seed file, but a real
    backend generates its own ids rather than trusting the client, so
    every table here gets a server-generated UUID instead. Called once
    per model as `id: Mapped[uuid.UUID] = uuid_pk()` — each call makes a
    fresh Column, so it's safe to reuse across every file in this folder.
    """
    return mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)


class ShippingAddressMixin:
    """Eight flat, individually-nullable columns, reused (via multiple
    inheritance) on three models: User (a saved default — nullable at
    the column level because a brand-new account hasn't set one yet),
    Payment (captured once at /payments/initialize — the point where a
    person actually confirms what address a charge is for, before the
    Order rows for it exist), and Order (copied from the Payment at
    fulfillment time, same snapshot philosophy as product_name/price/
    buyer_name on Order itself — a later edit to a saved default address
    must never rewrite where a past order already shipped to).

    Not a separate Address table with a foreign key: nothing in this app
    needs more than one saved address per user, or an address book, so a
    table built for that would be unused complexity. If a real address
    book is ever needed, that's the point to actually introduce one —
    this mixin's shape is the natural schema to lift into it.

    Column-nullable rather than NOT NULL even on Payment/Order, where an
    address is conceptually always required by the time either row
    exists: a hard DB constraint here would break the very first
    migration against any pre-existing data (nothing before this had
    addresses at all), and "does this row have a usable address" is
    already the kind of thing application code — not a DB constraint —
    should be deciding, the same way payment_id on Order is nullable
    for pre-payments rows rather than backfilled.

    state and postal_code are the two components genuinely optional
    across countries generally (not every country uses a postal code
    in common practice, or has a first-level administrative division
    the way a US state does); the rest are treated as always required
    once an address exists at all.
    """

    shipping_recipient_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    shipping_phone: Mapped[str | None] = mapped_column(String(30), nullable=True)
    shipping_line1: Mapped[str | None] = mapped_column(String(200), nullable=True)
    shipping_line2: Mapped[str | None] = mapped_column(String(200), nullable=True)
    shipping_city: Mapped[str | None] = mapped_column(String(100), nullable=True)
    shipping_state: Mapped[str | None] = mapped_column(String(100), nullable=True)
    shipping_postal_code: Mapped[str | None] = mapped_column(String(20), nullable=True)
    shipping_country: Mapped[str | None] = mapped_column(String(100), nullable=True)

    @property
    def has_shipping_address(self) -> bool:
        """True once every field that isn't allowed to be optional (see
        the class docstring) is actually set — the app-level substitute
        for a NOT NULL constraint this mixin deliberately doesn't have.
        """
        return all(
            [
                self.shipping_recipient_name,
                self.shipping_phone,
                self.shipping_line1,
                self.shipping_city,
                self.shipping_country,
            ]
        )

    @property
    def shipping_address(self):
        """None until has_shipping_address is true — lets
        UserRead/OrderRead expose a single optional nested object
        (ShippingAddress in schemas/address.py) rather than eight
        possibly-null top-level fields each caller has to assemble
        itself. A plain dict, not a ShippingAddress instance: importing
        that schema here would make app/models depend on app/schemas,
        the reverse of every other direction in this codebase — Pydantic's
        from_attributes validates this dict against ShippingAddress's
        fields just as well as it would a real instance.
        """
        if not self.has_shipping_address:
            return None
        return {
            "recipient_name": self.shipping_recipient_name,
            "phone": self.shipping_phone,
            "line1": self.shipping_line1,
            "line2": self.shipping_line2,
            "city": self.shipping_city,
            "state": self.shipping_state,
            "postal_code": self.shipping_postal_code,
            "country": self.shipping_country,
        }

    def set_shipping_address(self, address: dict) -> None:
        """Applied from a validated ShippingAddress (never straight from
        a client payload — see PaymentInitializeCreate/UserUpdate's own
        handling) via address.model_dump(). Always sets every column
        together rather than a partial update at this level, since a
        half-old-half-new address (someone's old city with a new line1)
        is worse than requiring the caller send a complete one — the
        partial-update case (UserUpdate's ShippingAddressUpdate) is
        resolved by the router merging onto the existing saved address
        before calling this, not by this method accepting partial data
        itself.
        """
        self.shipping_recipient_name = address["recipient_name"]
        self.shipping_phone = address["phone"]
        self.shipping_line1 = address["line1"]
        self.shipping_line2 = address.get("line2")
        self.shipping_city = address["city"]
        self.shipping_state = address.get("state")
        self.shipping_postal_code = address.get("postal_code")
        self.shipping_country = address["country"]
