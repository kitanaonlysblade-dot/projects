import uuid
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, model_validator

from app.models.discount import DiscountKind


class DiscountPreviewRequest(BaseModel):
    """Body for POST /discounts/preview — a person typing a code before
    paying anything, so the cart/buy-now screen can show "-$5.00"
    immediately rather than only finding out whether a code works once
    they've already opened Paystack's popup. Mirrors
    PaymentInitializeCreate's own mode/product_id/quantity shape (not
    reused directly — this never touches shipping_address or the rest
    of the payment-specific fields).
    """

    code: str
    mode: Literal["cart", "buy_now"]
    product_id: uuid.UUID | None = None
    quantity: int = 1

    @model_validator(mode="after")
    def _product_id_required_for_buy_now(self) -> "DiscountPreviewRequest":
        if self.mode == "buy_now" and self.product_id is None:
            raise ValueError("product_id is required when mode is 'buy_now'")
        return self


class DiscountPreviewRead(BaseModel):
    code: str
    kind: DiscountKind
    subtotal: Decimal
    discount_amount: Decimal
    new_subtotal: Decimal
