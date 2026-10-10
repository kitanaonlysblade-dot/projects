"""Checkout money path: initialize -> verify/webhook -> orders, stock, attribution."""
import hashlib
import hmac
import json

import app.routers.payments as payments
from app.models import CartItem, Order, Payment, PaymentStatus, Product
from tests.conftest import auth, make_post, make_product, make_user


def paid(amount_usd, status="success"):
    return lambda reference: {"status": status, "amount": int(float(amount_usd) * 100)}


def init_buy_now(client, buyer, product, qty=1, **extra):
    r = client.post(
        "/payments/initialize",
        headers=auth(buyer),
        json={"mode": "buy_now", "product_id": str(product.id), "quantity": qty, **extra},
    )
    assert r.status_code == 201, r.text
    return r.json()


def test_initialize_computes_amount_server_side(client, db, buyer):
    p = make_product(db, price="10.00", stock=5)
    data = init_buy_now(client, buyer, p, qty=2)
    pay = db.query(Payment).filter_by(reference=data["reference"]).one()
    # amount = subtotal + shipping, never anything the client sent
    assert data["subtotal_subunit"] == 2000
    assert data["amount_subunit"] == int(pay.amount * 100)
    assert pay.status == PaymentStatus.pending
    db.refresh(p)
    assert p.stock_quantity == 5  # nothing reserved until fulfilment


def test_initialize_rejects_more_than_stock(client, db, buyer):
    p = make_product(db, stock=1)
    r = client.post(
        "/payments/initialize",
        headers=auth(buyer),
        json={"mode": "buy_now", "product_id": str(p.id), "quantity": 2},
    )
    assert r.status_code == 409


def test_initialize_requires_login(client, db):
    p = make_product(db)
    r = client.post("/payments/initialize", json={"mode": "buy_now", "product_id": str(p.id)})
    assert r.status_code == 401


def test_verify_success_creates_orders_and_reserves_stock(client, db, buyer, monkeypatch):
    p = make_product(db, price="10.00", stock=5)
    data = init_buy_now(client, buyer, p, qty=2)
    monkeypatch.setattr(payments, "verify_transaction", paid(data["amount_subunit"] / 100))
    r = client.post("/payments/verify", headers=auth(buyer), json={"reference": data["reference"]})
    assert r.status_code == 200, r.text
    assert len(r.json()) == 2
    db.expire_all()
    assert db.query(Order).count() == 2
    assert db.get(Product, p.id).stock_quantity == 3
    assert db.query(Payment).one().status == PaymentStatus.success


def test_verify_is_idempotent(client, db, buyer, monkeypatch):
    p = make_product(db, stock=5)
    data = init_buy_now(client, buyer, p)
    monkeypatch.setattr(payments, "verify_transaction", paid(data["amount_subunit"] / 100))
    body = {"reference": data["reference"]}
    client.post("/payments/verify", headers=auth(buyer), json=body)
    client.post("/payments/verify", headers=auth(buyer), json=body)
    db.expire_all()
    assert db.query(Order).count() == 1
    assert db.get(Product, p.id).stock_quantity == 4  # reserved once, not twice


def test_underpayment_is_rejected_and_creates_nothing(client, db, buyer, monkeypatch):
    p = make_product(db, price="10.00", stock=5)
    data = init_buy_now(client, buyer, p)
    monkeypatch.setattr(payments, "verify_transaction", paid(1))
    r = client.post("/payments/verify", headers=auth(buyer), json={"reference": data["reference"]})
    assert r.status_code == 402
    db.expire_all()
    assert db.query(Order).count() == 0
    assert db.get(Product, p.id).stock_quantity == 5
    assert db.query(Payment).one().status == PaymentStatus.failed


def test_unsuccessful_charge_is_rejected(client, db, buyer, monkeypatch):
    p = make_product(db)
    data = init_buy_now(client, buyer, p)
    monkeypatch.setattr(payments, "verify_transaction", paid(99, status="failed"))
    r = client.post("/payments/verify", headers=auth(buyer), json={"reference": data["reference"]})
    assert r.status_code == 402
    assert db.query(Order).count() == 0


def test_cannot_verify_someone_elses_payment(client, db, buyer, monkeypatch):
    p = make_product(db)
    data = init_buy_now(client, buyer, p)
    other = make_user(db, "other")
    monkeypatch.setattr(payments, "verify_transaction", paid(data["amount_subunit"] / 100))
    r = client.post("/payments/verify", headers=auth(other), json={"reference": data["reference"]})
    assert r.status_code == 404
    assert db.query(Order).count() == 0


def test_sold_out_between_pay_and_verify_marks_fulfillment_failed(client, db, buyer, monkeypatch):
    p = make_product(db, stock=1)
    data = init_buy_now(client, buyer, p)
    p.stock_quantity = 0  # someone else took the last unit
    db.commit()
    monkeypatch.setattr(payments, "verify_transaction", paid(data["amount_subunit"] / 100))
    r = client.post("/payments/verify", headers=auth(buyer), json={"reference": data["reference"]})
    assert r.status_code == 409
    db.expire_all()
    assert db.query(Order).count() == 0
    assert db.query(Payment).one().status == PaymentStatus.fulfillment_failed


def test_cart_checkout_creates_orders_and_clears_cart(client, db, buyer, monkeypatch):
    a, b = make_product(db, price="5.00", stock=3), make_product(db, price="7.00", stock=3)
    db.add_all([CartItem(user_id=buyer.id, product_id=a.id, quantity=2), CartItem(user_id=buyer.id, product_id=b.id, quantity=1)])
    db.commit()
    r = client.post("/payments/initialize", headers=auth(buyer), json={"mode": "cart"})
    assert r.status_code == 201, r.text
    data = r.json()
    assert data["subtotal_subunit"] == 1700
    monkeypatch.setattr(payments, "verify_transaction", paid(data["amount_subunit"] / 100))
    r = client.post("/payments/verify", headers=auth(buyer), json={"reference": data["reference"]})
    assert r.status_code == 200, r.text
    db.expire_all()
    assert db.query(Order).count() == 3
    assert db.query(CartItem).count() == 0
    assert db.get(Product, a.id).stock_quantity == 1
    assert db.get(Product, b.id).stock_quantity == 2


def test_orders_are_attributed_to_the_video_they_came_from(client, db, buyer, monkeypatch):
    owner = make_user(db, "owner")
    p = make_product(db, stock=5)
    post = make_post(db, owner, [p])
    data = init_buy_now(client, buyer, p, source_video_post_id=str(post.id))
    monkeypatch.setattr(payments, "verify_transaction", paid(data["amount_subunit"] / 100))
    client.post("/payments/verify", headers=auth(buyer), json={"reference": data["reference"]})
    order = db.query(Order).one()
    assert order.source_video_post_id == post.id


def test_bogus_attribution_never_blocks_the_purchase(client, db, buyer, monkeypatch):
    owner = make_user(db, "owner")
    sold, other = make_product(db, stock=5), make_product(db)
    post = make_post(db, owner, [other])  # `sold` is NOT tagged here
    data = init_buy_now(client, buyer, sold, source_video_post_id=str(post.id))
    monkeypatch.setattr(payments, "verify_transaction", paid(data["amount_subunit"] / 100))
    r = client.post("/payments/verify", headers=auth(buyer), json={"reference": data["reference"]})
    assert r.status_code == 200
    assert db.query(Order).one().source_video_post_id is None


def _signed(body: dict):
    raw = json.dumps(body).encode()
    sig = hmac.new(b"sk_test_x", raw, hashlib.sha512).hexdigest()
    return raw, {"x-paystack-signature": sig, "content-type": "application/json"}


def test_webhook_rejects_bad_signature(client, db, buyer):
    raw, _ = _signed({"event": "charge.success", "data": {"reference": "x"}})
    r = client.post("/payments/webhook", content=raw, headers={"x-paystack-signature": "bad"})
    assert r.status_code in (400, 401, 403)


def test_webhook_then_verify_fulfils_only_once(client, db, buyer, monkeypatch):
    p = make_product(db, stock=5)
    data = init_buy_now(client, buyer, p)
    monkeypatch.setattr(payments, "verify_transaction", paid(data["amount_subunit"] / 100))
    raw, headers = _signed({"event": "charge.success", "data": {"reference": data["reference"]}})
    r = client.post("/payments/webhook", content=raw, headers=headers)
    assert r.status_code == 200, r.text
    client.post("/payments/verify", headers=auth(buyer), json={"reference": data["reference"]})
    db.expire_all()
    assert db.query(Order).count() == 1
    assert db.get(Product, p.id).stock_quantity == 4
