import uuid

from sqlalchemy import ARRAY, Boolean, ForeignKey, Integer, Numeric, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin, uuid_pk


class Category(Base):
    """Maps to Category in lib/types.ts — the sidebar/CategorySheet list."""

    __tablename__ = "categories"

    id: Mapped[uuid.UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(100), unique=True)
    icon_url: Mapped[str | None] = mapped_column(String(500), nullable=True)

    banners: Mapped[list["CategoryBanner"]] = relationship(back_populates="category")
    deals: Mapped[list["Deal"]] = relationship(back_populates="category")


class CategoryBanner(Base):
    """Maps to CategoryBanner in lib/types.ts — a promo banner on a
    category's landing page (CategoryLanding.tsx), e.g. "T-Shirts Under
    $20" inside Apparel. Products belong to a banner via Product.banner_id
    below rather than a join table, matching the one-banner-per-product
    assumption the frontend's CategoryBanner.products array already makes.
    """

    __tablename__ = "category_banners"

    id: Mapped[uuid.UUID] = uuid_pk()
    category_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("categories.id", ondelete="CASCADE")
    )
    title: Mapped[str] = mapped_column(String(150))
    subtitle: Mapped[str | None] = mapped_column(String(250), nullable=True)

    category: Mapped["Category"] = relationship(back_populates="banners")
    products: Mapped[list["Product"]] = relationship(back_populates="banner")


class Deal(Base):
    """Maps to Deal in lib/types.ts — DealBanner.tsx. category_id is
    nullable for storewide deals (e.g. "free shipping") that don't
    belong to one category, same as the frontend's optional categoryId.
    """

    __tablename__ = "deals"

    id: Mapped[uuid.UUID] = uuid_pk()
    text: Mapped[str] = mapped_column(String(150))
    sub: Mapped[str] = mapped_column(String(250))
    category_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("categories.id", ondelete="SET NULL"), nullable=True
    )

    category: Mapped["Category | None"] = relationship(back_populates="deals")


class Product(Base, TimestampMixin):
    """Maps to Product in lib/types.ts. merchant_id is nullable because
    the frontend's seed products (everything in lib/data.ts that isn't
    created via the merchant dashboard's Products tab) have no real
    merchant behind them — same reasoning as the optional bannerId
    comment in lib/types.ts.
    """

    __tablename__ = "products"

    id: Mapped[uuid.UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(200))
    price: Mapped[float] = mapped_column(Numeric(10, 2))
    description: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    colors: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    sizes: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    is_new: Mapped[bool] = mapped_column(Boolean, default=False)
    # Denormalized counter, same as Product.cartCount on the frontend —
    # bumped by handleBuyNowFromShopFeed's bumpProductActivity call, not
    # recomputed from cart_items on every read (that count is meant to
    # keep climbing even after items are removed from carts, so it can't
    # just be `count(*) from cart_items`).
    cart_count: Mapped[int] = mapped_column(Integer, default=0)
    # None means untracked/unlimited stock — the default, so every
    # existing product (seed data, anything created before this column
    # existed) keeps behaving exactly as it did with no inventory concept
    # at all. A merchant who actually wants stock enforced sets a real
    # number; from then on app/inventory.py's reserve_stock() is what
    # enforces and decrements it at purchase time, not this column being
    # read directly anywhere purchase logic lives.
    stock_quantity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # None/0 = no discount, the default for every product. A merchant
    # raising this (routers/merchant.py's update_merchant_product) is
    # what fires the "an item you saved just went on sale" notification
    # — see that route's own comment — to anyone with this product in
    # their cart, or who's watchlisted a video that features it. Not
    # connected to DiscountCode (app/models/discount.py) at all: that's
    # a platform-wide promo code applied at checkout, this is a single
    # product's own listed discount, shown right on its price.
    discount_percent: Mapped[int | None] = mapped_column(Integer, nullable=True)

    banner_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("category_banners.id", ondelete="SET NULL"), nullable=True
    )
    merchant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("merchant_accounts.id", ondelete="CASCADE"), nullable=True
    )

    banner: Mapped["CategoryBanner | None"] = relationship(back_populates="products")
    merchant: Mapped["MerchantAccount | None"] = relationship(back_populates="products")
    images: Mapped[list["ProductImage"]] = relationship(
        back_populates="product", order_by="ProductImage.position", cascade="all, delete-orphan"
    )
    # passive_deletes=True — without it, deleting a Product makes
    # SQLAlchemy's ORM try to null out cart_items.product_id on any cart
    # line pointing at it (the default relationship behavior when no
    # explicit delete-cascade is configured), which crashes with a
    # NOT NULL violation, since a cart item without a product doesn't
    # make sense and the column is declared accordingly. The FK's own
    # ondelete="CASCADE" (CartItem.product_id) already says what should
    # actually happen — this just gets the ORM out of the way and lets
    # the database enforce it, instead of the ORM trying to manage it in
    # Python first and failing. images above avoids the same problem a
    # different way (cascade="all, delete-orphan" — real ORM-level
    # deletes, appropriate there since a product's images have no
    # independent meaning); cart_items takes this path instead since an
    # ORM-level delete-orphan would mean loading and deleting every
    # affected cart row in Python for something the database can already
    # do in one statement.
    cart_items: Mapped[list["CartItem"]] = relationship(back_populates="product", passive_deletes=True)
    # Same passive_deletes reasoning as cart_items above, though this one
    # was never a crash — Order.product_id is nullable (ondelete="SET
    # NULL"), so the ORM's default null-it-out behavior actually
    # succeeds here. Without passive_deletes=True though, that still
    # means one UPDATE per matching Order issued by the ORM in Python,
    # rather than a single ON DELETE SET NULL the database handles
    # itself — a real cost for a product with a lot of order history,
    # even though nothing about it was broken.
    order_lines: Mapped[list["Order"]] = relationship(back_populates="product", passive_deletes=True)

    # Not a column — see stock_quantity's own comment for why None means
    # unlimited. Same pattern as User.following_count elsewhere (a plain
    # property that from_attributes picks up like any other field, so
    # ProductRead.model_validate(product) just works without extra
    # handling in the routes that return one).
    @property
    def in_stock(self) -> bool:
        return self.stock_quantity is None or self.stock_quantity > 0


class ProductImage(Base):
    """Product.images on the frontend is a plain string[] gallery — split
    into its own table here instead of a Postgres array so ordering
    (`position`) and any future per-image metadata aren't a pain later.
    Product.imageUrl (the single legacy field lib/types.ts keeps "for
    backward compatibility") doesn't need its own column — it's just
    `images[0]` once this table exists.
    """

    __tablename__ = "product_images"

    id: Mapped[uuid.UUID] = uuid_pk()
    product_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("products.id", ondelete="CASCADE")
    )
    url: Mapped[str] = mapped_column(String(500))
    position: Mapped[int] = mapped_column(Integer, default=0)

    product: Mapped["Product"] = relationship(back_populates="images")
