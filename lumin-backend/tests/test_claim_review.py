"""What a buyer's reasons are worth against the seller's live test (app/claim_review.py): a suggestion for the reviewer."""
import uuid
from types import SimpleNamespace as NS

from app import claim_review as cr


class FakeDb:
    def __init__(self, test=None, bag=None):
        self._test, self._bag = test, bag

    def query(self, *_):
        return self

    def filter(self, *_):
        return self

    def first(self):
        return self._test

    def get(self, *_):
        return self._bag


def _assess(checklist, reasons, test=True):
    t = NS(id=uuid.uuid4(), bag_id=uuid.uuid4(), checklist=checklist, video_key=None, video_private=False, claimed_duration_s=30.0) if test else None
    return cr.assess(FakeDb(t, NS(serial="LB-0000001")), NS(id=uuid.uuid4()), reasons)


def test_unknown_and_repeated_reasons_are_dropped():
    assert cr.clean_reasons(["Screen", "screen", "bogus", "", None, "damaged"]) == ["screen", "damaged"]


def test_a_fault_the_seller_showed_working_is_covered_and_suggests_deny():
    a = _assess(["Screen", "Sound"], ["screen"])
    assert a["suggestion"] == "deny" and a["covered"] == ["Screen"] and a["not_covered"] == []


def test_a_fault_the_test_never_showed_suggests_the_buyer_wins():
    a = _assess(["Screen"], ["screen", "camera"])
    assert a["suggestion"] == "refund" and a["not_covered"] == ["Camera"] and a["covered"] == ["Screen"]


def test_everything_works_covers_every_functional_fault_but_not_fit():
    assert _assess(["Everything works"], ["screen", "sound", "buttons", "power", "camera"])["suggestion"] == "deny"
    assert _assess(["Everything works"], ["fit"])["suggestion"] == "refund"


def test_no_live_test_favours_the_buyer():
    a = _assess([], ["screen"], test=False)
    assert a["has_test"] is False and a["suggestion"] == "refund"


def test_damage_and_other_need_a_person():
    assert _assess(["Everything works"], ["damaged"])["suggestion"] == "review"
    assert _assess(["Screen"], ["screen", "wrong_item"])["suggestion"] == "review"
    assert _assess(["Screen"], [])["suggestion"] == "review"


def test_the_delivery_code_hash_depends_on_the_shipment_and_the_code():
    from app import shipments

    a, b = uuid.uuid4(), uuid.uuid4()
    assert shipments._otp_hash(a, "123456") == shipments._otp_hash(a, "123456")
    assert shipments._otp_hash(a, "123456") != shipments._otp_hash(b, "123456")
    assert shipments._otp_hash(a, "123456") != shipments._otp_hash(a, "123457")


def test_appeals_go_to_the_losing_side_once_within_the_window():
    from datetime import datetime, timedelta, timezone

    from app.models import ReturnClaimStatus as S

    now = datetime.now(timezone.utc)

    def claim(status, hours_ago=1, appeal_by=None, resolved=True):
        return NS(status=status, appeal_by=appeal_by, resolved_at=now - timedelta(hours=hours_ago) if resolved else None)

    assert cr.appeal_side(claim(S.denied)) == "buyer"
    assert cr.appeal_side(claim(S.refunded)) == "seller"
    assert cr.appeal_side(claim(S.denied, appeal_by="buyer")) is None  # only once
    assert cr.appeal_side(claim(S.denied, hours_ago=cr.APPEAL_WINDOW_HOURS + 1)) is None  # window closed
    assert cr.appeal_side(claim(S.pending_review, resolved=False)) is None  # not decided yet
