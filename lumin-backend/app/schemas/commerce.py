import uuid
from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, model_validator

from app.models.commerce import OrderStatus, PayoutStatus
from app.schemas.address import ShippingAddress
from app.schemas.catalog import ProductRead


class CartItemBase(BaseModel):
    color: str | None = None
    size: str | None = None
    quantity: int = 1
    counts_as_shop_activity: bool = False


class CartItemCreate(CartItemBase):
    product_id: uuid.UUID
    # The video post being watched when this was added (shop feed only).
    source_video_post_id: uuid.UUID | None = None


class CartItemRead(CartItemBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    product_id: uuid.UUID
    # Nested rather than product_id alone: the cart screen renders a name
    # and price per line and sums a total, so returning just the id would
    # force the client into one extra GET /products/{id} per cart line.
    # Read-only — CartItemCreate still takes product_id on its own.
    product: ProductRead


class CartItemUpdate(BaseModel):
    quantity: int


class OrderCreate(BaseModel):
    product_id: uuid.UUID
    color: str | None = None
    size: str | None = None
    source_video_post_id: uuid.UUID | None = None
    # None falls back to the buyer's saved default (see buy_now in
    # orders.py) — same resolution /payments/initialize does for the
    # real payment path. product_name, price, and buyer_name are still
    # never accepted from the client here, only the address is —
    # everything else stays server-derived from the product + the
    # authenticated user at creation time.
    shipping_address: ShippingAddress | None = None


class OrderStatusUpdate(BaseModel):
    status: OrderStatus


class OrderCancelRequest(BaseModel):
    # Optional either way — a merchant cancelling because they can't
    # fulfill something benefits from recording why, but a buyer
    # cancelling isn't forced to give one.
    reason: str | None = None


class CheckoutCreate(BaseModel):
    """orders.py's checkout() previously took no request body at all —
    now needs somewhere for an address to come from, same as OrderCreate
    just above. None falls back to the buyer's saved default."""

    shipping_address: ShippingAddress | None = None


class OrderRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    buyer_id: uuid.UUID | None = None
    product_id: uuid.UUID | None = None
    product_name: str
    price: Decimal
    color: str | None = None
    size: str | None = None
    buyer_name: str
    status: OrderStatus
    created_at: datetime
    # Null on every order that's never been cancelled — see the same
    # column's own comment on the Order model.
    cancel_reason: str | None = None
    # None only for an order placed before this existed — every new one
    # going through _snapshot_order always has one, since both creation
    # paths (orders.py's legacy no-payment route, payments.py's real
    # one) require an address to resolve before an Order gets created at
    # all. See ShippingAddressMixin for why this is column-nullable
    # despite that.
    shipping_address: ShippingAddress | None = None
    # Set once, the moment status actually transitions to delivered —
    # see the same column's own comment on the Order model for why this
    # isn't just updated_at repurposed.
    delivered_at: datetime | None = None
    # held until app/escrow.py moves it — see PayoutStatus's own comment
    # for what each value means and what can trigger the move.
    payout_status: PayoutStatus = PayoutStatus.held


class PaymentInitializeCreate(BaseModel):
    """mode == 'buy_now' needs product_id (color/size/quantity match the
    same product card fields OrderCreate takes for the no-payment path);
    mode == 'cart' takes none of those — amount is computed from the
    person's current cart_items instead, same as checkout() already did.

    shipping_address applies to both modes — every order needs a
    destination regardless of how it was placed. None falls back to the
    buyer's saved default (User.shipping_address); if neither exists,
    initialize_payment rejects the request rather than silently starting
    a charge for an order with nowhere to ship to.

    discount_code is optional and validated against the resolved
    subtotal by app/discounts.py's preview_discount — an invalid,
    expired, or already-exhausted code fails the whole request (400/404/
    409) rather than silently charging full price, so the frontend knows
    to clear it rather than proceed as if it had applied.
    """

    mode: Literal["cart", "buy_now"]
    product_id: uuid.UUID | None = None
    color: str | None = None
    size: str | None = None
    quantity: int = 1
    source_video_post_id: uuid.UUID | None = None
    shipping_address: ShippingAddress | None = None
    discount_code: str | None = None

    @model_validator(mode="after")
    def _product_id_required_for_buy_now(self) -> "PaymentInitializeCreate":
        if self.mode == "buy_now" and self.product_id is None:
            raise ValueError("product_id is required when mode is 'buy_now'")
        return self


class PaymentInitializeRead(BaseModel):
    """Everything Paystack Inline needs client-side (PaystackPop.setup /
    newTransaction takes key, email, amount, currency, and a reference).
    amount_subunit is in the smallest unit of `currency` (Paystack's
    convention regardless of currency — cents for USD, kobo for NGN,
    etc.) purely for that popup call; verify below re-derives the actual
    amount from the Payment row itself, never from anything this
    response said.

    subtotal_subunit and shipping_subunit are the same breakdown
    CartScreen.tsx/ProductDrawer.tsx need to actually show "Subtotal /
    Shipping / Total" before the Paystack popup opens — amount_subunit
    is always subtotal_subunit - discount_subunit + shipping_subunit,
    never a number Paystack sees independently of the other three.
    discount_subunit is 0 (not null) when no code was applied, same
    "0 means none, not absent" reasoning as Payment.discount_amount's
    own default; discount_code echoes back the normalized (uppercase)
    code that was actually applied, so the frontend can show it without
    keeping its own copy of whatever the person originally typed.
    """

    reference: str
    amount_subunit: int
    subtotal_subunit: int
    shipping_subunit: int
    discount_subunit: int
    discount_code: str | None
    currency: str
    email: str
    public_key: str


class PaymentVerifyRequest(BaseModel):
    reference: str
