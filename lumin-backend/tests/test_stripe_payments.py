"""Checkout with Stripe as the gateway: initialize -> verify / webhook -> orders; sellers; payouts; refunds."""
import json

import pytest

import app.routers.payments as payments
from app import payment_provider, stripe_gateway as sg
from app.models import MerchantAccount, Order, OrderStatus, Payment, PaymentStatus, PayoutStatus
from tests.conftest import auth, make_product, make_user
from tests.fake_stripe import make_fake


@pytest.fixture(autouse=True)
def stripe_on(monkeypatch):
    monkeypatch.setattr(payment_provider, "PROVIDER", "stripe")
    mod, calls, state = make_fake()
    monkeypatch.setattr(sg, "stripe", mod)
    monkeypatch.setattr(sg, "STRIPE_SECRET_KEY", "sk_test_x")
    monkeypatch.setattr(sg, "STRIPE_PUBLIC_KEY", "pk_test_x")
    monkeypatch.setattr(sg, "STRIPE_WEBHOOK_SECRET", "whsec_x")
    return calls, state


def init(client, buyer, product, qty=1):
    r = client.post("/payments/initialize", headers=auth(buyer), json={"mode": "buy_now", "product_id": str(product.id), "quantity": qty})
    assert r.status_code == 201, r.text
    return r.json()


def test_initialize_returns_a_stripe_secret_and_uses_the_intent_id_as_reference(client, db, buyer, stripe_on):
    p = make_product(db, price="10.00", stock=5)
    data = init(client, buyer, p, qty=2)
    assert data["provider"] == "stripe" and data["public_key"] == "pk_test_x"
    assert data["client_secret"] == "pi_test_1_secret_x" and data["reference"] == "pi_test_1"
    assert data["amount_subunit"] == 2000 + int(db.query(Payment).one().shipping_fee * 100)
    sent = [c for c in stripe_on[0] if c[0] == "PaymentIntent.create"][0][1]
    assert sent["amount"] == data["amount_subunit"]  # the server's number, not the client's


def test_verify_creates_orders_once(client, db, buyer, stripe_on):
    p = make_product(db, price="10.00", stock=5)
    data = init(client, buyer, p)
    stripe_on[1]["amount_received"] = data["amount_subunit"]
    for _ in range(2):
        r = client.post("/payments/verify", headers=auth(buyer), json={"reference": data["reference"]})
        assert r.status_code == 200, r.text
    assert db.query(Order).count() == 1


def test_verify_while_stripe_is_still_processing_is_not_a_failure(client, db, buyer, stripe_on):
    p = make_product(db)
    data = init(client, buyer, p)
    stripe_on[1]["pi_status"] = "processing"
    r = client.post("/payments/verify", headers=auth(buyer), json={"reference": data["reference"]})
    assert r.status_code == 409
    db.expire_all()
    assert db.query(Payment).one().status == PaymentStatus.pending


def test_underpayment_creates_nothing(client, db, buyer, stripe_on):
    p = make_product(db, price="10.00")
    data = init(client, buyer, p)
    stripe_on[1]["amount_received"] = 1
    r = client.post("/payments/verify", headers=auth(buyer), json={"reference": data["reference"]})
    assert r.status_code == 402
    assert db.query(Order).count() == 0


def test_webhook_needs_a_valid_signature(client, db, buyer):
    raw = json.dumps({"type": "payment_intent.succeeded", "data": {"object": {"id": "pi_test_1"}}})
    assert client.post("/payments/stripe-webhook", content=raw, headers={"stripe-signature": "forged"}).status_code == 400


def test_webhook_then_verify_fulfils_only_once(client, db, buyer, stripe_on):
    p = make_product(db, stock=5)
    data = init(client, buyer, p)
    stripe_on[1]["amount_received"] = data["amount_subunit"]
    raw = json.dumps({"type": "payment_intent.succeeded", "data": {"object": {"id": data["reference"]}}})
    assert client.post("/payments/stripe-webhook", content=raw, headers={"stripe-signature": "good"}).status_code == 200
    client.post("/payments/verify", headers=auth(buyer), json={"reference": data["reference"]})
    db.expire_all()
    assert db.query(Order).count() == 1


def test_the_paystack_webhook_is_closed_while_stripe_is_live(client):
    assert client.post("/payments/webhook", content="{}", headers={"x-paystack-signature": "x"}).status_code == 404


def _seller(db):
    u = make_user(db, "seller")
    m = MerchantAccount(user_id=u.id, business_name="Shop", category="Fashion")
    db.add(m)
    db.commit()
    return u, m


def test_seller_onboarding_then_ready_via_webhook(client, db, stripe_on):
    u, m = _seller(db)
    r = client.post("/merchant/stripe/onboard", headers=auth(u))
    assert r.status_code == 200 and r.json()["url"] == "https://stripe.test/onboard"
    db.refresh(m)
    assert m.stripe_account_id == "acct_test_1" and m.payout_ready is False
    raw = json.dumps({"type": "account.updated", "data": {"object": {"id": "acct_test_1", "capabilities": {"transfers": "active"}, "payouts_enabled": True}}})
    assert client.post("/payments/stripe-webhook", content=raw, headers={"stripe-signature": "good"}).status_code == 200
    db.refresh(m)
    assert m.payout_ready is True


def test_the_old_bank_form_is_closed_under_stripe(client, db):
    u, _ = _seller(db)
    assert client.post("/merchant/payout", headers=auth(u), json={"bank_code": "1", "account_number": "1"}).status_code == 404


def test_release_pays_the_seller_the_price_minus_the_sponsored_fee_once(client, db, buyer, stripe_on):
    from app import escrow

    u, m = _seller(db)
    m.stripe_account_id, m.stripe_ready = "acct_1", True
    p = make_product(db, price="20.00", merchant_id=m.id)
    data = init(client, buyer, p)
    stripe_on[1]["amount_received"] = data["amount_subunit"]
    client.post("/payments/verify", headers=auth(buyer), json={"reference": data["reference"]})
    order = db.query(Order).one()
    order.sponsored_fee = 2
    db.commit()
    escrow.release_to_merchant(db, order)
    escrow.release_to_merchant(db, order)  # a second call is a no-op
    transfers = [c[1] for c in stripe_on[0] if c[0] == "Transfer.create"]
    assert len(transfers) == 1 and transfers[0]["amount"] == 1800 and transfers[0]["destination"] == "acct_1"
    db.refresh(order)
    assert order.payout_status == PayoutStatus.released and order.payout_transfer_code == "tr_test_1"


def test_an_unready_seller_is_not_paid_and_nothing_is_lost(client, db, buyer, stripe_on):
    from fastapi import HTTPException

    from app import escrow

    u, m = _seller(db)
    m.stripe_account_id = "acct_1"
    stripe_on[1]["account"] = None
    p = make_product(db, merchant_id=m.id)
    data = init(client, buyer, p)
    stripe_on[1]["amount_received"] = data["amount_subunit"]
    client.post("/payments/verify", headers=auth(buyer), json={"reference": data["reference"]})
    order = db.query(Order).one()
    # Stripe says this account cannot receive transfers yet
    mod = sg.stripe
    mod.Account.retrieve = staticmethod(lambda a: {"capabilities": {"transfers": "inactive"}, "payouts_enabled": False})
    with pytest.raises(HTTPException):
        escrow.release_to_merchant(db, order)
    db.refresh(order)
    assert order.payout_status == PayoutStatus.held
