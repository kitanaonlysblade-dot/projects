"""Stripe gateway: the parts that need no database (what is sent to Stripe, and how answers are read)."""
import json

import pytest
from fastapi import HTTPException

from app import stripe_gateway as sg
from tests.fake_stripe import make_fake


def _on(monkeypatch, **kw):
    mod, calls, state = make_fake(**kw)
    monkeypatch.setattr(sg, "stripe", mod)
    monkeypatch.setattr(sg, "STRIPE_SECRET_KEY", "sk_test_x")
    monkeypatch.setattr(sg, "STRIPE_WEBHOOK_SECRET", "whsec_x")
    return calls, state


def test_to_subunit_rounds_to_the_cent():
    assert sg.to_subunit("10.00") == 1000
    assert sg.to_subunit(19.99) == 1999
    assert sg.to_subunit("0.005") == 1  # half up


def test_payment_intent_uses_the_server_amount_and_an_idempotency_key(monkeypatch):
    calls, _ = _on(monkeypatch)
    out = sg.create_payment_intent(2500, "a@b.c", "pid-1", "pi_pid-1")
    assert out == {"id": "pi_test_1", "client_secret": "pi_test_1_secret_x"}
    kw = calls[0][1]
    assert kw["amount"] == 2500 and kw["idempotency_key"] == "pi_pid-1" and kw["transfer_group"] == "pay_pid-1"
    assert kw["metadata"] == {"payment_id": "pid-1"}


def test_verify_reads_status_and_amount_actually_received(monkeypatch):
    _on(monkeypatch)
    assert sg.verify_transaction("pi_1") == {"status": "success", "amount": 2000}
    _on(monkeypatch, pi_status="requires_payment_method", amount_received=0)
    assert sg.verify_transaction("pi_1") == {"status": "requires_payment_method", "amount": 0}
    _on(monkeypatch, pi_status="processing", amount_received=0)
    assert sg.verify_transaction("pi_1")["status"] == "processing"


def test_refund_key_is_per_order_so_equal_orders_in_one_cart_both_refund(monkeypatch):
    calls, _ = _on(monkeypatch)
    sg.refund_transaction("pi_1", 1000, "order-a")
    sg.refund_transaction("pi_1", 1000, "order-b")
    keys = [c[1]["idempotency_key"] for c in calls if c[0] == "Refund.create"]
    assert keys == ["refund_order-a", "refund_order-b"]
    assert calls[0][1]["payment_intent"] == "pi_1" and calls[0][1]["amount"] == 1000


def test_transfer_is_tied_to_the_charge_and_cannot_pay_an_order_twice(monkeypatch):
    calls, _ = _on(monkeypatch)
    out = sg.create_transfer("acct_1", 1800, "Payout", "pi_1", "order-a")
    assert out == {"transfer_code": "tr_test_1"}
    kw = [c for c in calls if c[0] == "Transfer.create"][0][1]
    assert kw["destination"] == "acct_1" and kw["amount"] == 1800
    assert kw["source_transaction"] == "ch_test_1" and kw["transfer_group"] == "pay_x"
    assert kw["idempotency_key"] == "payout_order-a"


def test_seller_ready_needs_transfers_active_and_payouts_enabled(monkeypatch):
    _on(monkeypatch)
    assert sg.account_status("acct_1")["ready"] is True
    _on(monkeypatch, account={"capabilities": {"transfers": "pending"}, "payouts_enabled": True, "details_submitted": True})
    assert sg.account_status("acct_1")["ready"] is False
    _on(monkeypatch, account={"capabilities": {"transfers": "active"}, "payouts_enabled": False, "details_submitted": True})
    assert sg.account_status("acct_1")["ready"] is False


def test_onboarding_creates_an_express_account_that_can_receive_transfers(monkeypatch):
    calls, _ = _on(monkeypatch)
    assert sg.create_connect_account("s@x.y", "Shop", "m-1") == "acct_test_1"
    kw = calls[0][1]
    assert kw["type"] == "express" and kw["capabilities"] == {"transfers": {"requested": True}}
    assert sg.onboarding_link("acct_test_1", "https://a/return", "https://a/refresh") == "https://stripe.test/onboard"


def test_webhook_is_refused_without_a_valid_signature_or_secret(monkeypatch):
    _on(monkeypatch)
    body = json.dumps({"type": "payment_intent.succeeded"}).encode()
    assert sg.construct_webhook_event(body, "good")["type"] == "payment_intent.succeeded"
    with pytest.raises(HTTPException) as e:
        sg.construct_webhook_event(body, "forged")
    assert e.value.status_code == 400
    monkeypatch.setattr(sg, "STRIPE_WEBHOOK_SECRET", "")
    with pytest.raises(HTTPException) as e:
        sg.construct_webhook_event(body, "good")
    assert e.value.status_code == 503


def test_no_key_means_a_clear_503_not_a_crash(monkeypatch):
    monkeypatch.setattr(sg, "STRIPE_SECRET_KEY", "")
    with pytest.raises(HTTPException) as e:
        sg.verify_transaction("pi_1")
    assert e.value.status_code == 503
