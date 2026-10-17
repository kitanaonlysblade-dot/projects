"""Verified-original badge and the payout pause while a copy review is open."""
from datetime import datetime, timedelta, timezone

import pytest

from app import escrow, scan_service
from app.models import MerchantAccount, Order, OrderStatus, PayoutStatus, UserRole, VideoFingerprint, VideoMatchFlag
from tests.conftest import auth, make_post, make_product, make_user


def fingerprint(db, post, status="ok"):
    db.add(VideoFingerprint(video_post_id=post.id, video_url=post.video_url, version="t", status=status))
    db.commit()


def flag(db, later, earlier, status="open"):
    f = VideoMatchFlag(video_post_id=later.id, earlier_post_id=earlier.id, stage="audio", status=status)
    db.add(f)
    db.commit()
    return f


def verified(db, post):
    db.refresh(post)
    return post.verified_original


# ---------------------------------------------------------------- badge
def test_badge_needs_a_good_fingerprint(db):
    post = make_post(db, make_user(db, "a"))
    scan_service.refresh_verified(db, [post.id])
    assert verified(db, post) is False
    fingerprint(db, post)
    scan_service.refresh_verified(db, [post.id])
    assert verified(db, post) is True


def test_failed_fingerprint_is_not_verified(db):
    post = make_post(db, make_user(db, "a"))
    fingerprint(db, post, status="failed")
    scan_service.refresh_verified(db, [post.id])
    assert verified(db, post) is False


def test_fingerprint_of_an_old_video_does_not_count(db):
    post = make_post(db, make_user(db, "a"))
    fingerprint(db, post)
    post.video_url = "https://cdn.test/replaced.mp4"
    db.commit()
    scan_service.refresh_verified(db, [post.id])
    assert verified(db, post) is False


def test_open_flag_removes_badge_from_both_and_dismissal_restores_it(db):
    original, copy = make_post(db, make_user(db, "o")), make_post(db, make_user(db, "c"))
    fingerprint(db, original), fingerprint(db, copy)
    f = flag(db, later=copy, earlier=original)
    scan_service.refresh_verified(db, [original.id, copy.id])
    assert verified(db, original) is False and verified(db, copy) is False
    f.status = "dismissed"
    db.commit()
    scan_service.refresh_verified(db, [original.id, copy.id])
    assert verified(db, original) is True and verified(db, copy) is True


def test_confirmed_copy_loses_it_but_the_original_keeps_it(db):
    original, copy = make_post(db, make_user(db, "o")), make_post(db, make_user(db, "c"))
    fingerprint(db, original), fingerprint(db, copy)
    flag(db, later=copy, earlier=original, status="confirmed")
    scan_service.refresh_verified(db, [original.id, copy.id])
    assert verified(db, original) is True
    assert verified(db, copy) is False


def test_resolving_a_flag_updates_the_badges(client, db):
    admin = make_user(db, "boss")
    admin.role = UserRole.admin
    db.commit()
    original, copy = make_post(db, make_user(db, "o")), make_post(db, make_user(db, "c"))
    fingerprint(db, original), fingerprint(db, copy)
    f = flag(db, later=copy, earlier=original)
    r = client.post(f"/scan/flags/{f.id}/resolve", json={"status": "dismissed"}, headers=auth(admin))
    assert r.status_code == 200
    assert verified(db, original) is True and verified(db, copy) is True


def test_badge_is_in_the_post_json(client, db):
    post = make_post(db, make_user(db, "a"))
    fingerprint(db, post)
    scan_service.refresh_verified(db, [post.id])
    assert client.get(f"/video-posts/{post.id}").json()["verified_original"] is True


# ---------------------------------------------------------------- payout pause
def make_sale(db, seller, source_post, delivered_ago=timedelta(hours=30)):
    merchant = MerchantAccount(user_id=seller.id, business_name="Shop", category="Fashion", paystack_recipient_code="RCP_x")
    db.add(merchant)
    db.commit()
    product = make_product(db, merchant_id=merchant.id)
    order = Order(
        buyer_id=make_user(db, "buyer").id, buyer_name="Buyer", product_id=product.id, product_name="Widget", price=10,
        status=OrderStatus.delivered, delivered_at=datetime.now(timezone.utc) - delivered_ago,
        source_video_post_id=source_post.id,
    )
    db.add(order)
    db.commit()
    return order


@pytest.fixture()
def transfers(monkeypatch):
    sent = []
    monkeypatch.setattr(escrow, "create_transfer", lambda **kw: sent.append(kw) or {"transfer_code": "TRF_1"})
    return sent


def test_sellers_own_copied_video_pauses_the_payout(db, transfers):
    original, seller = make_user(db, "o"), make_user(db, "seller")
    orig_post, copy_post = make_post(db, original), make_post(db, seller)
    order = make_sale(db, seller, copy_post)
    f = flag(db, later=copy_post, earlier=orig_post)
    assert scan_service.payout_hold_ids(db, [order]) == {order.id}
    escrow.release_to_merchant(db, order)
    db.refresh(order)
    assert order.payout_status == PayoutStatus.held and transfers == []
    # review closed -> the same call now pays
    f.status = "dismissed"
    db.commit()
    escrow.release_to_merchant(db, order)
    db.refresh(order)
    assert order.payout_status == PayoutStatus.released and len(transfers) == 1


def test_the_original_poster_is_never_held(db, transfers):
    seller, copier = make_user(db, "seller"), make_user(db, "copier")
    orig_post, copy_post = make_post(db, seller), make_post(db, copier)
    order = make_sale(db, seller, orig_post)
    flag(db, later=copy_post, earlier=orig_post)
    assert scan_service.payout_hold_ids(db, [order]) == set()
    escrow.release_to_merchant(db, order)
    assert len(transfers) == 1


def test_a_creators_flagged_video_does_not_hold_a_seller_who_only_tagged_it(db, transfers):
    seller, creator, original = make_user(db, "seller"), make_user(db, "creator"), make_user(db, "o")
    creator_post, orig_post = make_post(db, creator), make_post(db, original)
    order = make_sale(db, seller, creator_post)
    flag(db, later=creator_post, earlier=orig_post)
    assert scan_service.payout_hold_ids(db, [order]) == set()


def test_closed_flags_and_unflagged_videos_hold_nothing(db):
    seller, other = make_user(db, "seller"), make_user(db, "o")
    post, orig = make_post(db, seller), make_post(db, other)
    order = make_sale(db, seller, post)
    assert scan_service.payout_hold_ids(db, [order]) == set()
    flag(db, later=post, earlier=orig, status="dismissed")
    assert scan_service.payout_hold_ids(db, [order]) == set()


def test_orders_list_says_so_and_dismissing_pays_out(client, db, transfers):
    original, seller = make_user(db, "o"), make_user(db, "seller")
    orig_post, copy_post = make_post(db, original), make_post(db, seller)
    order = make_sale(db, seller, copy_post)
    f = flag(db, later=copy_post, earlier=orig_post)
    got = client.get("/orders/selling", headers=auth(seller)).json()
    assert got[0]["payout_on_hold"] is True and got[0]["payout_status"] == "held"
    assert transfers == []
    admin = make_user(db, "boss")
    admin.role = UserRole.admin
    db.commit()
    assert client.post(f"/scan/flags/{f.id}/resolve", json={"status": "dismissed"}, headers=auth(admin)).status_code == 200
    db.refresh(order)
    assert order.payout_status == PayoutStatus.released and len(transfers) == 1
