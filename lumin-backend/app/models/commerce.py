import enum
import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Integer, Numeric, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, ShippingAddressMixin, TimestampMixin, uuid_pk


class CartItem(Base, TimestampMixin):
    """Maps to CartItem in lib/types.ts. Kept as its own row per
    product+color+size combination rather than one row per product,
    same as the frontend treats a re-added item with different options
    as a distinct cart line (see handleAddToCart's matching logic in
    page.tsx)."""

    __tablename__ = "cart_items"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE")
    )
    product_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("products.id", ondelete="CASCADE")
    )
    color: Mapped[str | None] = mapped_column(String(50), nullable=True)
    size: Mapped[str | None] = mapped_column(String(50), nullable=True)
    quantity: Mapped[int] = mapped_column(Integer, default=1)
    # Mirrors CartItem.countsAsShopActivity — only items added while
    # actively swiping the shop feed count toward the "shop activity"
    # signal, not ones added from a product page or category browse.
    counts_as_shop_activity: Mapped[bool] = mapped_column(Boolean, default=False)
    # Which video post the buyer was watching when they added this / bought
    # it — set only when that post really has this product tagged (see
    # app/attribution.py), so a merchant's "orders per video" can't be
    # inflated or spoofed by a client naming an arbitrary post.
    source_video_post_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("video_posts.id", ondelete="SET NULL"), nullable=True
    )

    user: Mapped["User"] = relationship(back_populates="cart_items")
    product: Mapped["Product"] = relationship(back_populates="cart_items")


class OrderStatus(str, enum.Enum):
    pending = "pending"
    shipped = "shipped"
    delivered = "delivered"
    # Terminal, not part of the forward pending → shipped → delivered
    # progression — reachable from pending or shipped (see cancel_order
    # in routers/orders.py), never from delivered: once something has
    # actually arrived, "I don't want this" is a return, which this app
    # doesn't model, not a cancellation.
    cancelled = "cancelled"


class PayoutStatus(str, enum.Enum):
    """Separate from OrderStatus on purpose — "has this shipped" and "has
    the merchant actually been paid for it" are genuinely different
    questions once escrow exists. See app/escrow.py for the module that
    actually moves money between these states; this enum just names
    them.

    Defined here, before Order, rather than down near PaymentStatus
    where it might read as more naturally grouped — Order.payout_status
    references this by name at class-body evaluation time (Python runs
    a class body top-to-bottom immediately, not lazily), so it has to
    already exist by the time that line runs or the whole module fails
    to import.
    """

    # Money's been collected (into the platform's own Paystack balance —
    # see Payment's own comment) but not yet paid out to the merchant.
    # Every order starts here.
    held = "held"
    # Paid out to the merchant via Paystack Transfer — either the buyer
    # explicitly confirmed receipt, or the 24-hour claim window closed
    # with nothing filed (see CLAIM_WINDOW in app/return_policy.py and
    # the auto-release sweep in app/escrow.py).
    released = "released"
    # Sent back to the buyer instead — either an ordinary pre-delivery
    # cancellation (routers/orders.py's cancel_order) or a valid
    # post-delivery defect claim (app/return_policy.py +
    # routers/orders.py's report_defect). The merchant gets nothing
    # either way.
    refunded = "refunded"


class Order(Base, TimestampMixin, ShippingAddressMixin):
    """Maps to Order in lib/types.ts. product_name and buyer_name are
    snapshotted onto the row itself rather than only read through the
    product_id / buyer_id joins — the frontend's Order already does the
    same (it stores productName and buyerName directly), and it matters
    for the same reason a real store needs it: if a product is renamed
    or deleted, or an account's display name changes, past orders should
    keep showing what was actually true at purchase time. The shipping_*
    columns (ShippingAddressMixin) follow the exact same reasoning —
    copied from the Payment that funded this order (_snapshot_order in
    both orders.py and payments.py) at creation time, so a later edit to
    the buyer's saved default address never rewrites where a past order
    actually shipped to.
    """

    __tablename__ = "orders"

    id: Mapped[uuid.UUID] = uuid_pk()
    buyer_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    product_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("products.id", ondelete="SET NULL"), nullable=True
    )
    product_name: Mapped[str] = mapped_column(String(200))
    price: Mapped[float] = mapped_column(Numeric(10, 2))
    color: Mapped[str | None] = mapped_column(String(50), nullable=True)
    size: Mapped[str | None] = mapped_column(String(50), nullable=True)
    buyer_name: Mapped[str] = mapped_column(String(100))
    status: Mapped[OrderStatus] = mapped_column(
        Enum(OrderStatus, name="order_status"), default=OrderStatus.pending
    )
    # Set only by cancel_order (routers/orders.py) at the moment of
    # cancellation — null on every order that's never been cancelled,
    # not an empty string. Optional even then: a merchant-initiated
    # cancellation especially benefits from recording why (out of stock,
    # can't fulfill, ...), but a buyer cancelling isn't forced to give
    # one.
    cancel_reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # Which video post the buyer was watching when they added this / bought
    # it — set only when that post really has this product tagged (see
    # app/attribution.py), so a merchant's "orders per video" can't be
    # inflated or spoofed by a client naming an arbitrary post.
    source_video_post_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("video_posts.id", ondelete="SET NULL"), nullable=True
    )
    # Null for an order created before payments existed, or (in theory)
    # one a future non-Paystack path creates directly. Set once, at
    # creation, by whichever payments.Payment row's verify/webhook
    # fulfillment actually produced this row — see Payment.orders below.
    # ondelete="SET NULL" so a Payment row can never be removed out from
    # under an Order that still needs to show up in someone's history.
    payment_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("payments.id", ondelete="SET NULL"), nullable=True
    )
    # Set once, by advance_order_status (routers/orders.py) the moment
    # status actually transitions to delivered — deliberately its own
    # column rather than reading TimestampMixin's updated_at for this,
    # since updated_at bumps on ANY change to the row (a status edit, a
    # cancel_reason being set, ...) and would silently drift if this
    # order were ever touched again after delivery for an unrelated
    # reason. app/return_policy.py's CLAIM_WINDOW counts from this
    # timestamp, not updated_at.
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    payout_status: Mapped[PayoutStatus] = mapped_column(
        Enum(PayoutStatus, name="payout_status"), default=PayoutStatus.held
    )
    # Paystack's own transfer_code once release_to_merchant (app/
    # escrow.py) actually pays the merchant out — null until then, and
    # stays null forever for an order that ends up refunded instead.
    # Purely an audit trail; nothing re-reads this to decide anything.
    payout_transfer_code: Mapped[str | None] = mapped_column(String(100), nullable=True)

    buyer: Mapped["User | None"] = relationship(back_populates="orders")
    product: Mapped["Product | None"] = relationship(back_populates="order_lines")
    payment: Mapped["Payment | None"] = relationship(back_populates="orders")


class PaymentStatus(str, enum.Enum):
    pending = "pending"
    success = "success"
    failed = "failed"
    # The charge itself succeeded, but there wasn't enough stock left by
    # the time _fulfill() actually tried to create the Order row(s) —
    # someone else bought the last unit in the gap between this person
    # paying and Paystack's confirmation coming back. Distinct from
    # `failed` (which means the charge itself didn't go through) because
    # here Paystack really did collect the money; see the comment on
    # _fulfill in routers/payments.py for what happens next (currently:
    # nothing automatic — same "no refund automation yet" limitation as
    # everywhere else a charge is handled in this app).
    fulfillment_failed = "fulfillment_failed"
    # Set by cancel_order (routers/orders.py) once every Order this
    # Payment funds has been cancelled — a Payment funding several
    # orders (a cart checkout) only reaches this when the LAST of them
    # is cancelled, not the first; see that route's own comment on why
    # cancelling one line shouldn't relabel a payment still legitimately
    # funding others still on their way.
    refunded = "refunded"


class PaymentMode(str, enum.Enum):
    """Which checkout path this payment is for — mirrors the two ways an
    Order already gets created without payment (buy_now vs. checkout in
    orders.py): a single product bought straight off a product card, or
    everything currently in the cart. Decided once at /payments/initialize
    and snapshotted here so /payments/verify (and the webhook, which has
    no request body from the person to re-derive it from) both know
    exactly what to fulfil once Paystack confirms the charge.
    """

    cart = "cart"
    buy_now = "buy_now"


class Payment(Base, TimestampMixin, ShippingAddressMixin):
    """One row per Paystack transaction attempt. `reference` is generated
    here (not by Paystack's own /transaction/initialize) because the
    frontend drives payment entirely through Paystack Inline — it never
    calls Paystack's initialize endpoint, just opens the popup with a
    reference this row already exists under, so /payments/verify (or the
    webhook) has something to look up no matter which one lands first.
    `amount` is computed and stored server-side at initialize time from
    the product/cart the person actually has right now — never trusted
    from the client — and re-checked against what Paystack says was
    actually paid before anything is fulfilled. `amount` is the grand
    total actually charged, i.e. subtotal + shipping_fee — shipping_fee
    is broken out into its own column (rather than folded silently into
    amount) so a receipt or order history can show what was paid for
    products vs. delivery, the same way PaymentInitializeRead breaks it
    out for the frontend before the charge even happens. The shipping_*
    columns (ShippingAddressMixin) are captured here too, at that same
    initialize moment, for the same reason color/size/quantity are —
    _fulfill below can't ask the person anything by the time it runs
    (verify has no address in its request body, and the webhook has no
    person attached to the request at all), so whatever address they
    confirmed at checkout has to already be sitting on this row,
    waiting to be copied onto each Order it produces. discount_amount
    (below) is folded into `amount` the same way shipping_fee is added
    to it — see that column's own comment.
    """

    __tablename__ = "payments"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE")
    )
    reference: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    amount: Mapped[float] = mapped_column(Numeric(10, 2))
    # See compute_shipping_fee in app/shipping.py for how this is derived
    # — each merchant represented in the cart charges their own flat fee
    # (or nothing, above their own free-shipping threshold), summed here
    # into one number. Default 0 covers a row from before this column
    # existed, not a real "free shipping" outcome for a new one.
    shipping_fee: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("0"))
    status: Mapped[PaymentStatus] = mapped_column(
        Enum(PaymentStatus, name="payment_status"), default=PaymentStatus.pending
    )
    mode: Mapped[PaymentMode] = mapped_column(Enum(PaymentMode, name="payment_mode"))
    # Only set for mode == buy_now — the one product/variant/quantity this
    # payment is for. For mode == cart, fulfillment reads the person's
    # cart_items directly (same as orders.py's checkout already did),
    # since a cart can hold several products and quantities can still
    # change quantity between initialize and verify.
    product_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("products.id", ondelete="SET NULL"), nullable=True
    )
    color: Mapped[str | None] = mapped_column(String(50), nullable=True)
    size: Mapped[str | None] = mapped_column(String(50), nullable=True)
    quantity: Mapped[int] = mapped_column(Integer, default=1)
    # Which video post the buyer was watching when they added this / bought
    # it — set only when that post really has this product tagged (see
    # app/attribution.py), so a merchant's "orders per video" can't be
    # inflated or spoofed by a client naming an arbitrary post.
    source_video_post_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("video_posts.id", ondelete="SET NULL"), nullable=True
    )
    # Set together at /payments/initialize by app/discounts.py's
    # preview_discount, and folded into `amount` above the same moment
    # (amount = subtotal - discount_amount + shipping_fee) — never
    # recomputed later, since by the time _fulfill runs Paystack has
    # already collected exactly `amount`. discount_amount defaults to 0
    # (not nullable) so "no code applied" and "a $0 code" don't need
    # distinguishing anywhere that just wants a number to display or add
    # up; discount_code_id stays nullable/SET NULL so a removed code
    # doesn't retroactively break a Payment row that already used it.
    discount_code_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("discount_codes.id", ondelete="SET NULL"), nullable=True
    )
    discount_amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("0"))

    user: Mapped["User"] = relationship()
    product: Mapped["Product | None"] = relationship()
    discount_code: Mapped["DiscountCode | None"] = relationship()
    # One payment can fan out into several Orders (one per cart line's
    # quantity, same expansion checkout() already did) — kept so
    # fulfillment can be replayed safely: if verify and the webhook both
    # land, the second one finds these already here instead of double-
    # creating orders for the same charge.
    orders: Mapped[list["Order"]] = relationship(back_populates="payment")
