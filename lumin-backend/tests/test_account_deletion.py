"""Deleting an account from the app: what goes, what stays, and when it is refused."""
from app.auth.security import hash_password
from app.models import (
    Comment,
    MerchantAccount,
    Order,
    OrderStatus,
    Payment,
    PaymentMode,
    PayoutStatus,
    Product,
    User,
    UserRole,
    VideoPost,
)
from tests.conftest import auth, make_post, make_product, make_user
from tests.test_twins import make_merchant

PW = "correct horse"


def person(db, name="leaver", password=PW):
    u = make_user(db, name)
    u.hashed_password = hash_password(password) if password else None
    db.commit()
    return u


def delete(client, user, **body):
    return client.post("/users/me/delete", headers=auth(user), json=body)


def order(db, buyer, product, **kw):
    o = Order(buyer_id=buyer.id, product_id=product.id, product_name=product.name, price=10, buyer_name="Leaver Person", **kw)
    db.add(o)
    db.commit()
    return o


def test_deleting_needs_the_word_and_the_password(client, db):
    u = person(db)
    check = client.get("/users/me/deletion-check", headers=auth(u)).json()
    assert check == {"can_delete": True, "reasons": [], "has_password": True}

    assert delete(client, u, confirm="nope", password=PW).status_code == 400
    assert delete(client, u, confirm="DELETE", password="wrong").status_code == 403
    assert delete(client, u, confirm="DELETE").status_code == 403  # a password account must give it
    assert db.get(User, u.id) is not None

    assert delete(client, u, confirm=" delete ", password=PW).status_code == 204
    db.expire_all()
    assert db.get(User, u.id) is None
    assert client.get("/auth/me", headers=auth(u)).status_code == 401  # the old token is dead


def test_a_google_only_account_confirms_with_the_word_alone(client, db):
    u = person(db, "google", password=None)
    assert client.get("/users/me/deletion-check", headers=auth(u)).json()["has_password"] is False
    assert delete(client, u, confirm="DELETE").status_code == 204


def test_their_content_goes_and_order_and_payment_records_stay_detached(client, db, monkeypatch):
    removed = []
    monkeypatch.setattr("app.routers.users.storage.delete_view_urls", lambda urls: removed.extend(urls))
    seller = make_merchant(db)
    product = make_product(db, merchant_id=seller.merchant_account.id)
    other_post = make_post(db, seller)
    u = person(db)
    u.avatar_url = "https://cdn.test/me.jpg"
    mine = make_post(db, u)
    db.add(Comment(video_post_id=other_post.id, author_id=u.id, text="love this"))
    delivered = order(db, u, product, status=OrderStatus.delivered, payout_status=PayoutStatus.released)
    delivered.shipping_line1 = "12 Long Road"
    pay = Payment(user_id=u.id, reference="ref-1", amount=10, mode=PaymentMode.buy_now, shipping_line1="12 Long Road")
    db.add(pay)
    db.commit()
    mine_id, order_id, pay_id = mine.id, delivered.id, pay.id

    assert delete(client, u, confirm="DELETE", password=PW).status_code == 204
    db.expire_all()

    assert db.get(VideoPost, mine_id) is None
    assert db.query(Comment).filter_by(text="love this").count() == 0
    kept = db.get(Order, order_id)
    assert kept.buyer_id is None and kept.buyer_name == "Deleted user" and kept.shipping_line1 is None
    kept_pay = db.get(Payment, pay_id)
    assert kept_pay.user_id is None and kept_pay.shipping_line1 is None and kept_pay.reference == "ref-1"
    assert "https://cdn.test/me.jpg" in removed and "https://cdn.test/v.mp4" in removed  # their files are removed


def test_an_order_in_progress_blocks_deleting_until_it_settles(client, db):
    seller = make_merchant(db)
    product = make_product(db, merchant_id=seller.merchant_account.id)
    u = person(db)
    o = order(db, u, product)  # pending

    check = client.get("/users/me/deletion-check", headers=auth(u)).json()
    assert check["can_delete"] is False and "1 order" in check["reasons"][0]
    r = delete(client, u, confirm="DELETE", password=PW)
    assert r.status_code == 409 and "can't delete your account yet" in r.json()["detail"]
    assert db.get(User, u.id) is not None

    o.status, o.payout_status = OrderStatus.delivered, PayoutStatus.held  # delivered, still in the claim window
    db.commit()
    assert delete(client, u, confirm="DELETE", password=PW).status_code == 409

    o.payout_status = PayoutStatus.released
    db.commit()
    assert delete(client, u, confirm="DELETE", password=PW).status_code == 204


def test_a_payment_still_being_confirmed_blocks_deleting(client, db):
    u = person(db)
    db.add(Payment(user_id=u.id, reference="ref-2", amount=10, mode=PaymentMode.buy_now))
    db.commit()
    check = client.get("/users/me/deletion-check", headers=auth(u)).json()
    assert check["can_delete"] is False and "payment" in check["reasons"][0]


def test_a_seller_is_blocked_by_their_stores_open_orders_and_otherwise_takes_the_store_with_them(client, db):
    shop = make_merchant(db, "shopowner")
    shop.hashed_password = hash_password(PW)
    db.commit()
    product = make_product(db, merchant_id=shop.merchant_account.id)
    buyer = person(db, "buyer")
    sold = order(db, buyer, product)  # pending, on THEIR store

    check = client.get("/users/me/deletion-check", headers=auth(shop)).json()
    assert check["can_delete"] is False and "store" in check["reasons"][0]
    assert delete(client, shop, confirm="DELETE", password=PW).status_code == 409

    sold.status, sold.payout_status = OrderStatus.delivered, PayoutStatus.released
    db.commit()
    shop_id, product_id, sold_id = shop.id, product.id, sold.id
    assert delete(client, shop, confirm="DELETE", password=PW).status_code == 204
    db.expire_all()
    assert db.query(MerchantAccount).filter_by(user_id=shop_id).count() == 0
    assert db.get(Product, product_id) is None
    kept = db.get(Order, sold_id)  # the buyer's history survives the store going away
    assert kept is not None and kept.product_id is None and kept.buyer_id == buyer.id


def test_admins_cannot_delete_themselves_here(client, db):
    admin = person(db, "boss")
    admin.role = UserRole.admin
    db.commit()
    assert client.get("/users/me/deletion-check", headers=auth(admin)).json()["can_delete"] is False
    assert delete(client, admin, confirm="DELETE", password=PW).status_code == 403


def test_someone_elses_video_retwin_of_a_deleted_video_survives(client, db):
    u = person(db)
    original = make_post(db, u)
    fan = make_user(db, "fan")
    retwin = VideoPost(feed=original.feed, poster_id=fan.id, video_url="https://cdn.test/fan.mp4", retwin_of_id=original.id, retwin_kind="video")
    db.add(retwin)
    db.commit()
    retwin_id = retwin.id
    assert delete(client, u, confirm="DELETE", password=PW).status_code == 204
    db.expire_all()
    survivor = db.get(VideoPost, retwin_id)
    assert survivor is not None and survivor.retwin_of_id is None  # carries on as a post of its own
