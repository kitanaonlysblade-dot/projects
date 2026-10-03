import uuid
from decimal import Decimal

from pydantic import BaseModel, ConfigDict


class CategoryRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    icon_url: str | None = None


class CategoryBannerRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    category_id: uuid.UUID
    title: str
    subtitle: str | None = None


class DealRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    text: str
    sub: str
    category_id: uuid.UUID | None = None


class ProductImageRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    url: str
    position: int


class ProductBase(BaseModel):
    name: str
    price: Decimal
    description: str | None = None
    colors: list[str] = []
    sizes: list[str] = []
    is_new: bool = False
    # None (the default) means untracked/unlimited — see the same field
    # on the Product model for why. A merchant who wants stock enforced
    # sets a real number here; app/inventory.py's reserve_stock is what
    # actually enforces and decrements it at purchase time.
    stock_quantity: int | None = None
    # 0-100, None/0 meaning no discount — see the same field on the
    # Product model for what raising this actually triggers.
    discount_percent: int | None = None


class ProductCreate(ProductBase):
    banner_id: uuid.UUID | None = None
    # Becomes ProductImage rows on create — position is just this list's
    # index, matching the frontend's Product.images ordering.
    image_urls: list[str] = []


class ProductUpdate(BaseModel):
    """Every field optional — a PATCH only needs to send what's changing.
    image_urls, when present, REPLACES the product's whole image list
    (simpler than a separate add/remove/reorder API for a gallery this
    small); omit it entirely to leave existing images untouched."""

    name: str | None = None
    price: Decimal | None = None
    description: str | None = None
    colors: list[str] | None = None
    sizes: list[str] | None = None
    is_new: bool | None = None
    banner_id: uuid.UUID | None = None
    image_urls: list[str] | None = None
    # Distinguishing "leave stock alone" from "set it to unlimited" needs
    # the same exclude_unset handling the merchant router already gives
    # every other field here — see update_merchant_product in
    # routers/merchant.py, which reads this correctly via
    # model_dump(exclude_unset=True) rather than treating an omitted
    # field the same as an explicit null.
    stock_quantity: int | None = None
    discount_percent: int | None = None


class ProductRead(ProductBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    cart_count: int
    banner_id: uuid.UUID | None = None
    merchant_id: uuid.UUID | None = None
    images: list[ProductImageRead] = []
    # Not a column — a property on the model (see its own comment) that
    # from_attributes picks up here the same way. Saves the frontend from
    # reimplementing "stock_quantity is None or > 0" itself everywhere a
    # Buy/Add-to-cart button needs to know whether to disable.
    in_stock: bool = True
