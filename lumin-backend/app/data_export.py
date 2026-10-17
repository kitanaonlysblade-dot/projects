"""Download my data: everything we hold that belongs to one account, as a single JSON file.

Rules, so the file is useful without leaking anyone else:
* The account row, minus secrets (password hash, two-step secret, lockout counters, session cut-off).
* Records the person made or owns: videos, comments, likes, saves, cart, orders and payments (their own, with the
  address they used), notifications, reports they filed, appeals, blocks they set, who they follow, searches, ...
* A seller also gets their store, products, and a list of sales with buyers' names and addresses removed.
* Not included: other people's data (who blocked or reported them, buyers' details), internal fingerprints, and
  one-time codes. Uploaded files are listed as links, not bundled.
"""
from __future__ import annotations

from app.brand import APP_NAME

import enum
import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Base, MerchantAccount, User

# table name -> the column that points at this user. Only what the person owns or did.
OWN_TABLES: dict[str, str] = {
    "video_posts": "poster_id",
    "comments": "author_id",
    "video_views": "viewer_id",
    "watchlist_items": "user_id",
    "post_likes": "user_id",
    "post_shares": "user_id",
    "comment_likes": "user_id",
    "comment_reactions": "user_id",
    "twin_requests": "requester_id",
    "twin_request_supporters": "user_id",
    "twin_searches": "user_id",
    "moment_evidence": "user_id",
    "wanted_offers": "seller_user_id",
    "cart_items": "user_id",
    "orders": "buyer_id",
    "payments": "user_id",
    "return_claims": "buyer_id",
    "discount_redemptions": "user_id",
    "notifications": "user_id",
    "reports": "reporter_id",
    "appeals": "user_id",
    "user_blocks": "blocker_id",
    "follows": "follower_id",
    "video_scans": "user_id",
    "traffic_sources": "user_id",
}

# Never exported, even from the account row.
SECRET_USER_COLUMNS = {
    "hashed_password",
    "totp_secret",
    "totp_enabled",
    "totp_last_step",
    "failed_logins",
    "locked_until",
    "sessions_valid_after",
}
# Removed from the sales list: the buyer is someone else.
BUYER_COLUMNS = {"buyer_id", "buyer_name"}
MAX_ROWS = 20000


def _plain(value):
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, (uuid.UUID, Decimal)):
        return str(value)
    if isinstance(value, enum.Enum):
        return value.value
    if isinstance(value, (list, tuple, set)):
        return [_plain(v) for v in value]
    if isinstance(value, dict):
        return {str(k): _plain(v) for k, v in value.items()}
    if isinstance(value, (bytes, bytearray, memoryview)):
        return None
    return str(value)


def _rows(db: Session, table_name: str, where, drop=lambda col: False) -> list[dict]:
    table = Base.metadata.tables.get(table_name)
    if table is None:
        return []
    out = []
    for row in db.execute(select(table).where(where(table)).limit(MAX_ROWS)).mappings():
        out.append({k: _plain(v) for k, v in row.items() if not drop(k)})
    return out


def build_export(db: Session, user: User) -> dict:
    users = Base.metadata.tables["users"]
    account = db.execute(select(users).where(users.c.id == user.id)).mappings().first() or {}
    data: dict = {
        "exported_at": datetime.utcnow().isoformat() + "Z",
        "about": f"Your {APP_NAME} data. Dates are UTC. Files you uploaded (videos, photos) are listed as links.",
        "account": {k: _plain(v) for k, v in account.items() if k not in SECRET_USER_COLUMNS},
        "records": {},
    }
    records = data["records"]
    for name, column in OWN_TABLES.items():
        rows = _rows(db, name, lambda t, c=column: t.c[c] == user.id)
        if rows:
            records[name] = rows

    merchant = db.query(MerchantAccount).filter(MerchantAccount.user_id == user.id).first()
    if merchant is not None:
        records["merchant_account"] = _rows(db, "merchant_accounts", lambda t: t.c.id == merchant.id)
        records["seller_verification"] = _rows(
            db, "seller_verifications", lambda t: t.c.merchant_id == merchant.id, drop=lambda col: col in ("document_key", "selfie_key")
        )
        products = _rows(db, "products", lambda t: t.c.merchant_id == merchant.id)
        records["products"] = products
        ids = [uuid.UUID(p["id"]) for p in products]
        if ids:
            images = _rows(db, "product_images", lambda t: t.c.product_id.in_(ids))
            if images:
                records["product_images"] = images
            sales = _rows(
                db,
                "orders",
                lambda t: t.c.product_id.in_(ids),
                drop=lambda col: col in BUYER_COLUMNS or col.startswith("shipping_"),
            )
            if sales:
                records["sales"] = sales
    return data
