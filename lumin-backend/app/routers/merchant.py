import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from app.auth import get_current_active_user
from app.database import get_db
from app.models import (
    CartItem,
    CategoryBanner,
    MerchantAccount,
    Notification,
    NotificationType,
    Product,
    ProductImage,
    User,
    video_post_products,
    watchlist_items,
)
from app.paystack import create_transfer_recipient, list_banks, resolve_account
from app.twin_search_service import notify_waiting_searches
from app.schemas import (
    BankRead,
    MerchantAccountCreate,
    MerchantAccountRead,
    MerchantAccountUpdate,
    MerchantPayoutCreate,
    ProductCreate,
    ProductRead,
    ProductUpdate,
)

router = APIRouter(prefix="/merchant", tags=["merchant"])


def _require_merchant(current_user: User) -> MerchantAccount:
    if current_user.merchant_account is None:
        raise HTTPException(status_code=404, detail="No merchant account for this user")
    return current_user.merchant_account


def _notify_product_discount(db: Session, product: Product) -> None:
    """Called from update_merchant_product below, only once a discount
    has just newly appeared or gone up (see that route's own check) —
    notifies everyone with a reason to care: anyone with this exact
    product sitting in their cart right now, and anyone who's saved
    (watchlisted) a video that features it, video_post_products ->
    watchlist_items being the same two-hop join VideoStage's own saved
    state reads use, just walked from the product's side instead of a
    single post's. A cart line and a watchlisted post are otherwise
    unrelated tables with no shared key of their own, so this collects
    both sets of user ids into one dict (not just a set) keyed by id —
    a plain set of two already-loaded User objects would rely on
    SQLAlchemy identity equality across two separate queries, which
    isn't guaranteed; deduplicating by the id each query actually
    returns is.
    """
    cart_user_ids = {
        row.user_id for row in db.query(CartItem.user_id).filter(CartItem.product_id == product.id).distinct()
    }
    watchlist_user_ids = {
        row.user_id
        for row in db.query(watchlist_items.c.user_id)
        .join(video_post_products, video_post_products.c.video_post_id == watchlist_items.c.video_post_id)
        .filter(video_post_products.c.product_id == product.id)
        .distinct()
    }
    body = f"{product.name} just dropped {product.discount_percent}% — you saved it, grab it before it's gone."
    for user_id in cart_user_ids | watchlist_user_ids:
        db.add(Notification(user_id=user_id, body=body, type=NotificationType.product, target_id=product.id))


@router.post("", response_model=MerchantAccountRead, status_code=status.HTTP_201_CREATED)
def create_merchant_account(
    payload: MerchantAccountCreate,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Maps to handleCreateMerchant — one account per user, enforced by
    the unique constraint on MerchantAccount.user_id.
    """
    if current_user.merchant_account is not None:
        raise HTTPException(status_code=400, detail="This user already has a merchant account")

    account = MerchantAccount(user_id=current_user.id, **payload.model_dump())
    db.add(account)
    db.commit()
    db.refresh(account)
    return account


@router.get("/me", response_model=MerchantAccountRead)
def read_my_merchant_account(current_user: User = Depends(get_current_active_user)):
    return _require_merchant(current_user)


@router.patch("/account", response_model=MerchantAccountRead)
def update_merchant_account(
    payload: MerchantAccountUpdate,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """No dashboard UI calls this yet (see MerchantAccountUpdate's own
    comment) — kept in place for editing business_name/category/
    description once one exists. exclude_unset so an omitted field is
    left alone rather than reset, same convention as PATCH /users/me.
    """
    merchant = _require_merchant(current_user)
    updates = payload.model_dump(exclude_unset=True)
    for field, value in updates.items():
        setattr(merchant, field, value)
    db.commit()
    db.refresh(merchant)
    return merchant


@router.get("/banks", response_model=list[BankRead])
def get_banks():
    """No auth required — this is just reference data (which banks
    Paystack can transfer to), not anything scoped to a particular
    merchant. Backs the bank picker in the payout-setup UI.
    """
    return list_banks()


@router.post("/payout", response_model=MerchantAccountRead)
def add_payout_details(
    payload: MerchantPayoutCreate,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Two real Paystack calls, in order: resolve_account confirms this
    account_number+bank_code actually belongs to a real account and
    returns the name on file for it (never trusting a name the merchant
    might type in themselves), then create_transfer_recipient registers
    that verified account with Paystack for future payouts and returns
    the recipient_code app/escrow.py's release_to_merchant needs.
    Calling this again replaces whatever payout details were there
    before with a fresh Paystack recipient for the new ones — there's
    no "remove payout details" path separate from just adding new ones.
    """
    merchant = _require_merchant(current_user)

    resolved = resolve_account(payload.account_number, payload.bank_code)
    account_name = resolved["account_name"]

    recipient = create_transfer_recipient(
        account_number=payload.account_number,
        bank_code=payload.bank_code,
        name=account_name,
    )

    merchant.bank_code = payload.bank_code
    merchant.account_number = payload.account_number
    merchant.account_name = account_name
    merchant.paystack_recipient_code = recipient["recipient_code"]
    db.commit()
    db.refresh(merchant)
    return merchant


@router.get("/products", response_model=list[ProductRead])
def list_merchant_products(
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Everything this merchant has listed — powers the dashboard's
    Products tab, and the product picker the Posts tab uses when
    attaching products to a shop video.

    Deliberately not a `merchant_id` filter on the public GET /products:
    that route is the consumer-facing catalog, and "show me my own
    listings" is an authenticated, owner-scoped question rather than a
    way to browse someone else's shelf.
    """
    merchant = _require_merchant(current_user)
    return (
        db.query(Product)
        .options(joinedload(Product.images))
        .filter(Product.merchant_id == merchant.id)
        .all()
    )


@router.post("/products", response_model=ProductRead, status_code=status.HTTP_201_CREATED)
def add_merchant_product(
    payload: ProductCreate,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Maps to handleAddMerchantProduct — step one of the dashboard's
    required sequence before a shop post can reference this product."""
    merchant = _require_merchant(current_user)
    if payload.banner_id is not None and db.get(CategoryBanner, payload.banner_id) is None:
        raise HTTPException(status_code=404, detail="Banner not found")

    product = Product(
        merchant_id=merchant.id,
        name=payload.name,
        price=payload.price,
        description=payload.description,
        colors=payload.colors,
        sizes=payload.sizes,
        is_new=payload.is_new,
        banner_id=payload.banner_id,
        stock_quantity=payload.stock_quantity,
        images=[ProductImage(url=url, position=i) for i, url in enumerate(payload.image_urls)],
    )
    db.add(product)
    db.flush()
    # Shoppers who searched for something like this and found nothing hear about it.
    notify_waiting_searches(db, product)
    db.commit()
    db.refresh(product)
    return product


@router.patch("/products/{product_id}", response_model=ProductRead)
def update_merchant_product(
    product_id: uuid.UUID,
    payload: ProductUpdate,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Maps to handleUpdateMerchantProduct."""
    merchant = _require_merchant(current_user)
    product = db.get(Product, product_id)
    if product is None or product.merchant_id != merchant.id:
        raise HTTPException(status_code=404, detail="Product not found")

    old_discount = product.discount_percent or 0
    updates = payload.model_dump(exclude_unset=True, exclude={"image_urls"})
    for field, value in updates.items():
        setattr(product, field, value)

    # Replaces the whole gallery when present — see the note on
    # ProductUpdate.image_urls for why that's simpler than a separate
    # add/remove/reorder API for a list this small.
    if payload.image_urls is not None:
        product.images = [ProductImage(url=url, position=i) for i, url in enumerate(payload.image_urls)]

    # Fires on a discount newly appearing OR going up (5% -> 20%), never
    # on it being removed or lowered — nobody wants a "the thing you
    # saved got more expensive" notification. Checked against the
    # *previous* value captured above, not just "is discount_percent in
    # this payload", so resending the same value (an idempotent retry,
    # or a PATCH that touches other fields and happens to also resend
    # the current discount) doesn't re-notify everyone.
    new_discount = product.discount_percent or 0
    if new_discount > old_discount:
        _notify_product_discount(db, product)

    # Rewriting a listing's words can make it the twin someone was waiting for.
    if {"name", "description", "colors", "banner_id"} & updates.keys():
        db.flush()
        notify_waiting_searches(db, product)

    db.commit()
    db.refresh(product)
    return product


@router.delete("/products/{product_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_merchant_product(
    product_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Maps to handleDeleteMerchantProduct."""
    merchant = _require_merchant(current_user)
    product = db.get(Product, product_id)
    if product is None or product.merchant_id != merchant.id:
        raise HTTPException(status_code=404, detail="Product not found")
    db.delete(product)
    db.commit()
