"""Keeping every number on screen true: likes, comments, shares, saves, views, "bought & in carts".

Two rules:

1. Every counter that has real rows behind it (a like is a row in post_likes, a comment is a row in
   comments, ...) changes in the SAME statement-level step as the row, and only when the row really
   changed. `add_link` / `remove_link` insert or delete the row and say whether anything happened;
   `bump` then adds or subtracts atomically in SQL (`col = col + 1`), never read-modify-write in
   Python - two people liking at the same moment can no longer overwrite each other, and a double
   tap can no longer count twice.

2. `reconcile()` recounts everything from the rows themselves and fixes any counter that is off
   (rows deleted by an account deletion or a cascade, old bugs, manual edits). `check()` is the
   same thing without changing anything. Run it from the admin endpoints or:

       python -m app.counters          # report only
       python -m app.counters --fix    # report and correct

Product.cart_count ("bought & in carts") = units sitting in carts + units bought and not
cancelled. It is refreshed automatically whenever a cart line or an order is saved (the
`after_flush` listener at the bottom), so no cart/order code has to remember to do it.
"""
import sys
import uuid

from sqlalchemy import Table, delete, event, func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.models import (
    CartItem,
    Comment,
    Order,
    OrderStatus,
    Product,
    VideoPost,
    VideoView,
    comment_reactions,
    post_likes,
    post_shares,
    watchlist_items,
)


# ------------------------------------------------------------------ writing (one real change = one count)
def add_link(db: Session, table: Table, **keys) -> bool:
    """Insert one row of a link table (like, share, save, reaction). True only if it was new, so a double
    tap or two simultaneous requests count once."""
    result = db.execute(pg_insert(table).values(**keys).on_conflict_do_nothing())
    return result.rowcount == 1


def remove_link(db: Session, table: Table, **keys) -> bool:
    """Delete one row of a link table. True only if it existed."""
    result = db.execute(delete(table).where(*[table.c[k] == v for k, v in keys.items()]))
    return result.rowcount >= 1


def bump(db: Session, obj, column: str, delta) -> None:
    """Atomically add `delta` to obj.<column> in SQL (never below zero) and refresh the loaded object."""
    model = type(obj)
    col = getattr(model, column)
    db.execute(
        update(model)
        .where(model.id == obj.id)
        .values({column: func.greatest(col + delta, 0)})
        .execution_options(synchronize_session=False)
    )
    db.expire(obj, [column])


# ------------------------------------------------------------------ expected values, from the rows
def _count(table, where_col, outer_col):
    return select(func.count()).select_from(table).where(where_col == outer_col).scalar_subquery()


def _post_expected():
    vp = VideoPost.__table__
    c = Comment.__table__
    v = VideoView.__table__
    return {
        "likes_count": _count(post_likes, post_likes.c.video_post_id, vp.c.id),
        "shares_count": _count(post_shares, post_shares.c.video_post_id, vp.c.id),
        "saves_count": _count(watchlist_items, watchlist_items.c.video_post_id, vp.c.id),
        "comments_count": _count(c, c.c.video_post_id, vp.c.id),
        "views_count": _count(v, v.c.video_post_id, vp.c.id),
        "unique_viewers_count": select(func.count(func.distinct(v.c.viewer_key))).where(v.c.video_post_id == vp.c.id).scalar_subquery(),
        "completions_count": select(func.count()).select_from(v).where(v.c.video_post_id == vp.c.id, v.c.completed.is_(True)).scalar_subquery(),
    }


def _comment_expected():
    c = Comment.__table__
    child = Comment.__table__.alias("child")
    return {
        "likes_count": _count(comment_reactions, comment_reactions.c.comment_id, c.c.id),
        "replies_count": select(func.count()).select_from(child).where(child.c.parent_id == c.c.id).scalar_subquery(),
    }


def _product_expected():
    p = Product.__table__
    ci = CartItem.__table__
    o = Order.__table__
    in_carts = select(func.coalesce(func.sum(ci.c.quantity), 0)).where(ci.c.product_id == p.c.id).scalar_subquery()
    bought = (
        select(func.count()).select_from(o).where(o.c.product_id == p.c.id, o.c.status != OrderStatus.cancelled).scalar_subquery()
    )
    return {"cart_count": in_carts + bought}


def refresh_cart_counts(connection, product_ids) -> None:
    if not product_ids:
        return
    p = Product.__table__
    connection.execute(update(p).where(p.c.id.in_(list(product_ids))).values(**_product_expected()))


# ------------------------------------------------------------------ check / reconcile
def _sync(db: Session, table: Table, expected: dict, ids, fix: bool) -> dict:
    """Compare stored counters with the recount; optionally correct them. Returns
    {column: {"wrong": n, "examples": [(id, stored, true), ...]}}."""
    cols = list(expected)
    query = select(table.c.id, *[table.c[c] for c in cols], *[expected[c].label(f"_t_{c}") for c in cols])
    if ids is not None:
        query = query.where(table.c.id.in_(list(ids)))
    report = {c: {"wrong": 0, "examples": []} for c in cols}
    wrong_ids = set()
    for row in db.execute(query).mappings():
        for c in cols:
            stored, true = row[c] or 0, row[f"_t_{c}"] or 0
            if stored != true:
                report[c]["wrong"] += 1
                wrong_ids.add(row["id"])
                if len(report[c]["examples"]) < 5:
                    report[c]["examples"].append((str(row["id"]), stored, true))
    if fix and wrong_ids:
        db.execute(update(table).where(table.c.id.in_(list(wrong_ids))).values(**expected))
        db.commit()
    return report


def reconcile(db: Session, *, post_ids=None, product_ids=None, comment_ids=None, fix: bool = True) -> dict:
    """Recount from the rows. With ids, only those rows; otherwise everything. fix=False only reports."""
    return {
        "video_posts": _sync(db, VideoPost.__table__, _post_expected(), post_ids, fix),
        "comments": _sync(db, Comment.__table__, _comment_expected(), comment_ids, fix),
        "products": _sync(db, Product.__table__, _product_expected(), product_ids, fix),
    }


def total_wrong(report: dict) -> int:
    return sum(col["wrong"] for table in report.values() for col in table.values())


# ------------------------------------------------------------------ cart/order changes refresh cart_count
@event.listens_for(Session, "after_flush")
def _refresh_on_flush(session: Session, _ctx) -> None:
    product_ids: set[uuid.UUID] = set()
    for obj in (*session.new, *session.dirty, *session.deleted):
        if isinstance(obj, (CartItem, Order)) and obj.product_id is not None:
            product_ids.add(obj.product_id)
    if product_ids:
        refresh_cart_counts(session.connection(), product_ids)


if __name__ == "__main__":
    from app.database import SessionLocal

    fix = "--fix" in sys.argv
    with SessionLocal() as session:
        rep = reconcile(session, fix=fix)
    for table, cols in rep.items():
        for col, info in cols.items():
            print(f"{table}.{col}: {info['wrong']} wrong" + (f"  e.g. {info['examples'][:2]}" if info["wrong"] else ""))
    print(("Corrected." if fix else "Report only - run with --fix to correct.") if total_wrong(rep) else "Everything matches.")
