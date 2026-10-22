"""The warning signs shown to admins (app/fraud_signals.py) and when a shipment counts as stalled (app/shipments.py)."""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace as NS

from app import fraud_signals as fs
from app import shipments


def test_a_seller_with_few_orders_is_not_flagged_on_rate():
    assert fs.seller_flags(orders=2, claims=2, refunded_claims=0, refusals=0) == []


def test_a_high_dispute_rate_is_flagged():
    f = fs.seller_flags(orders=10, claims=4, refunded_claims=0, refusals=0)
    assert len(f) == 1 and "4 of 10" in f[0]
    assert fs.seller_flags(orders=10, claims=2, refunded_claims=0, refusals=0) == []


def test_lost_disputes_and_refusals_are_flagged():
    f = fs.seller_flags(orders=50, claims=1, refunded_claims=2, refusals=2)
    assert any("went against" in x for x in f) and any("refused" in x for x in f)


def _ship(status, created_hours=0, picked_hours=None, arrived=None):
    now = datetime.now(timezone.utc)
    return NS(
        status=status,
        created_at=now - timedelta(hours=created_hours),
        picked_up_at=None if picked_hours is None else now - timedelta(hours=picked_hours),
        arrived_at=arrived,
    )


def test_stalled_when_nobody_collects_for_a_day():
    assert not shipments.is_stalled(_ship("awaiting_pickup", created_hours=5))
    assert shipments.is_stalled(_ship("awaiting_pickup", created_hours=25))


def test_stalled_when_on_the_road_three_days_without_a_check_in():
    assert not shipments.is_stalled(_ship("in_transit", picked_hours=30))
    assert shipments.is_stalled(_ship("in_transit", picked_hours=80))
    assert not shipments.is_stalled(_ship("in_transit", picked_hours=80, arrived=datetime.now(timezone.utc)))
    assert not shipments.is_stalled(_ship("delivered", created_hours=500))
