"""A stand-in for the `stripe` library, recording every call, so the Stripe code can be tested without the network."""
from types import SimpleNamespace


class FakeStripeError(Exception):
    pass


def make_fake(pi_status="succeeded", amount_received=None, account=None):
    calls = []
    state = {"pi_status": pi_status, "amount_received": amount_received}

    class PaymentIntent:
        @staticmethod
        def create(**kw):
            calls.append(("PaymentIntent.create", kw))
            return {"id": "pi_test_1", "client_secret": "pi_test_1_secret_x"}

        @staticmethod
        def retrieve(ref):
            calls.append(("PaymentIntent.retrieve", ref))
            return {
                "id": ref, "status": state["pi_status"], "amount": 2000,
                "amount_received": 2000 if state["amount_received"] is None else state["amount_received"],
                "latest_charge": "ch_test_1", "transfer_group": "pay_x",
            }

    class Refund:
        @staticmethod
        def create(**kw):
            calls.append(("Refund.create", kw))
            return {"id": "re_1"}

    class Transfer:
        @staticmethod
        def create(**kw):
            calls.append(("Transfer.create", kw))
            return {"id": "tr_test_1"}

    class Account:
        @staticmethod
        def create(**kw):
            calls.append(("Account.create", kw))
            return {"id": "acct_test_1"}

        @staticmethod
        def retrieve(acct):
            calls.append(("Account.retrieve", acct))
            return account or {"capabilities": {"transfers": "active"}, "payouts_enabled": True, "details_submitted": True}

        @staticmethod
        def create_login_link(acct):
            return {"url": "https://stripe.test/login"}

    class AccountLink:
        @staticmethod
        def create(**kw):
            calls.append(("AccountLink.create", kw))
            return {"url": "https://stripe.test/onboard"}

    class Webhook:
        @staticmethod
        def construct_event(payload, sig, secret):
            import json

            if sig != "good":
                raise ValueError("bad signature")
            return json.loads(payload)

    mod = SimpleNamespace(
        api_key=None, StripeError=FakeStripeError, PaymentIntent=PaymentIntent, Refund=Refund, Transfer=Transfer,
        Account=Account, AccountLink=AccountLink, Webhook=Webhook,
    )
    return mod, calls, state
