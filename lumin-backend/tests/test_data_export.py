import json

from app.auth.security import hash_password
from app.data_export import OWN_TABLES
from app.models import Base
from tests.conftest import auth, make_post, make_product, make_user


def test_every_export_rule_points_at_a_real_column():
    for table, column in OWN_TABLES.items():
        assert table in Base.metadata.tables, table
        assert column in Base.metadata.tables[table].c, f"{table}.{column}"


def export(client, user, password=None):
    return client.post("/users/me/export", json={"password": password}, headers=auth(user))


def test_export_has_my_data_and_no_secrets(client, db):
    me = make_user(db, "me")
    me.hashed_password = hash_password("pw-12345678")
    me.totp_secret = "SECRET-VALUE"
    db.commit()
    make_post(db, me)
    r = export(client, me, "pw-12345678")
    assert r.status_code == 200
    assert "attachment" in r.headers["content-disposition"] and r.headers["cache-control"] == "no-store"
    body = r.json()
    assert body["account"]["email"] == me.email
    assert len(body["records"]["video_posts"]) == 1
    text = r.text
    for secret in ("hashed_password", "totp_secret", "SECRET-VALUE", "sessions_valid_after", "failed_logins"):
        assert secret not in text


def test_password_required_and_checked(client, db):
    me = make_user(db, "me")
    me.hashed_password = hash_password("pw-12345678")
    db.commit()
    assert export(client, me).status_code == 403
    assert export(client, me, "wrong").status_code == 403


def test_google_only_account_needs_no_password(client, db):
    me = make_user(db, "g")
    me.hashed_password = None
    db.commit()
    assert export(client, me).status_code == 200


def test_needs_login(client):
    assert client.post("/users/me/export", json={}).status_code == 401


def test_other_peoples_data_is_not_in_it(client, db):
    me, other = make_user(db, "me"), make_user(db, "other")
    me.hashed_password = None
    db.commit()
    make_post(db, other)
    other_email = other.email
    body = export(client, me).json()
    assert "video_posts" not in body["records"]
    assert other_email not in json.dumps(body)


def test_seller_gets_products_and_anonymised_sales(client, db):
    from app.models import MerchantAccount, Order

    seller, buyer = make_user(db, "shop"), make_user(db, "buyer")
    seller.hashed_password = None
    db.commit()
    merchant = MerchantAccount(user_id=seller.id, business_name="Shop", category="Fashion")
    db.add(merchant)
    db.commit()
    product = make_product(db, merchant_id=merchant.id)
    db.add(Order(buyer_id=buyer.id, buyer_name="Ada Buyer", product_id=product.id, product_name="Widget", price=10, shipping_line1="1 Secret St"))
    db.commit()
    body = export(client, seller).json()
    assert len(body["records"]["products"]) == 1
    assert len(body["records"]["sales"]) == 1
    blob = json.dumps(body)
    assert "Ada Buyer" not in blob and "1 Secret St" not in blob and buyer.email not in blob
