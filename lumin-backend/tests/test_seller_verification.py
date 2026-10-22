import io

import pytest

from app import escrow, storage
from app.models import MerchantAccount, Notification, Order, OrderStatus, PayoutStatus, SellerVerification, UserRole
from app.routers.verification import sniff_image
from tests.conftest import auth, make_post, make_product, make_user

JPEG = b"\xff\xd8\xff\xe0" + b"0" * 64
PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 64


@pytest.fixture()
def private(monkeypatch):
    """A fake private bucket: files are kept in a dict."""
    files = {}
    monkeypatch.setattr(storage, "R2_PRIVATE_BUCKET_NAME", "private-bucket")
    monkeypatch.setattr(storage, "put_private", lambda key, data, ct: files.__setitem__(key, data))
    monkeypatch.setattr(storage, "private_view_url", lambda key: f"https://signed.test/{key}" if key else None)
    monkeypatch.setattr(storage, "delete_private", lambda keys: [files.pop(k, None) for k in keys if k])
    return files


def seller(db, name="shop"):
    user = make_user(db, name)
    db.add(MerchantAccount(user_id=user.id, business_name="Ada Wears", category="Fashion"))
    db.commit()
    return user


def admin(db):
    user = make_user(db, "boss")
    user.role = UserRole.admin
    db.commit()
    return user


def submit(client, user, document=JPEG, selfie=PNG, doc_type="national_id", name="Ada Obi"):
    return client.post(
        "/merchant/verification",
        data={"legal_name": name, "doc_type": doc_type},
        files={"document": ("id.jpg", io.BytesIO(document), "image/jpeg"), "selfie": ("me.png", io.BytesIO(selfie), "image/png")},
        headers=auth(user),
    )


def test_sniffing_trusts_the_bytes_not_the_name():
    assert sniff_image(JPEG)[0] == "image/jpeg" and sniff_image(PNG)[0] == "image/png"
    assert sniff_image(b"RIFF\x00\x00\x00\x00WEBPVP8 ")[0] == "image/webp"
    assert sniff_image(b"%PDF-1.4 ...") is None and sniff_image(b"<script>") is None


def test_off_without_a_private_bucket(client, db):
    user = seller(db)
    assert client.get("/merchant/verification", headers=auth(user)).json()["available"] is False
    assert submit(client, user).status_code == 503


def test_submit_stores_privately_and_shows_pending(client, db, private):
    user = seller(db)
    r = submit(client, user)
    assert r.status_code == 201
    body = r.json()
    assert body["status"] == "pending" and body["verified"] is False and body["legal_name"] == "Ada Obi"
    assert len(private) == 2 and all(k.startswith("verification/") for k in private)
    assert submit(client, user).status_code == 409  # already waiting


def test_only_images_and_only_sellers(client, db, private):
    user = seller(db)
    assert submit(client, user, document=b"%PDF-1.4 not an image").status_code == 415
    assert submit(client, user, doc_type="library_card").status_code == 422
    assert private == {}
    assert submit(client, make_user(db, "plain")).status_code == 404


def test_approve_verifies_notifies_and_deletes_the_photos(client, db, private):
    user, boss = seller(db), admin(db)
    submit(client, user)
    item = client.get("/admin/verifications", headers=auth(boss)).json()[0]
    assert item["business_name"] == "Ada Wears" and item["document_url"].startswith("https://signed.test/")
    r = client.post(f"/admin/verifications/{item['id']}/review", json={"approve": True}, headers=auth(boss))
    assert r.status_code == 200 and r.json()["status"] == "approved" and r.json()["document_url"] is None
    assert private == {}  # photos gone
    db.expire_all()
    assert db.query(MerchantAccount).one().verified is True
    v = db.query(SellerVerification).one()
    assert v.document_key is None and v.selfie_key is None and v.reviewed_by == boss.id
    assert "verified" in db.query(Notification).filter(Notification.user_id == user.id).one().body
    assert client.get("/merchant/verification", headers=auth(user)).json()["verified"] is True
    assert submit(client, user).status_code == 409  # already verified


def test_reject_needs_a_reason_and_allows_a_retry(client, db, private):
    user, boss = seller(db), admin(db)
    submit(client, user)
    vid = client.get("/admin/verifications", headers=auth(boss)).json()[0]["id"]
    assert client.post(f"/admin/verifications/{vid}/review", json={"approve": False}, headers=auth(boss)).status_code == 422
    assert client.post(f"/admin/verifications/{vid}/review", json={"approve": False, "note": "Photo is blurry"}, headers=auth(boss)).status_code == 200
    got = client.get("/merchant/verification", headers=auth(user)).json()
    assert got["status"] == "rejected" and got["note"] == "Photo is blurry" and got["verified"] is False
    assert private == {}
    assert submit(client, user).status_code == 201  # try again
    assert client.post(f"/admin/verifications/{vid}/review", json={"approve": True}, headers=auth(boss)).status_code == 409  # old one is decided


def test_admin_only(client, db, private):
    user = seller(db)
    submit(client, user)
    assert client.get("/admin/verifications", headers=auth(user)).status_code == 403


def test_unverify(client, db, private):
    user, boss = seller(db), admin(db)
    merchant = db.query(MerchantAccount).filter_by(user_id=user.id).one()
    from datetime import datetime, timezone
    merchant.verified_at = datetime.now(timezone.utc)
    db.commit()
    assert client.post(f"/admin/merchants/{merchant.id}/unverify", headers=auth(boss)).status_code == 204
    db.refresh(merchant)
    assert merchant.verified is False


def test_badge_is_on_the_sellers_posts(client, db):
    from datetime import datetime, timezone

    user = seller(db)
    merchant = db.query(MerchantAccount).filter_by(user_id=user.id).one()
    post = make_post(db, user)
    post.merchant_id = merchant.id
    db.commit()
    assert client.get(f"/video-posts/{post.id}").json()["merchant_verified"] is False
    merchant.verified_at = datetime.now(timezone.utc)
    db.commit()
    assert client.get(f"/video-posts/{post.id}").json()["merchant_verified"] is True


def test_payout_can_require_verification(db, monkeypatch):
    from datetime import datetime, timedelta, timezone

    user = seller(db)
    merchant = db.query(MerchantAccount).filter_by(user_id=user.id).one()
    merchant.paystack_recipient_code = "RCP_x"
    product = make_product(db, merchant_id=merchant.id)
    order = Order(buyer_id=make_user(db, "b").id, buyer_name="B", product_id=product.id, product_name="W", price=10,
                  status=OrderStatus.delivered, delivered_at=datetime.now(timezone.utc) - timedelta(days=2))
    db.add(order)
    db.commit()
    sent = []
    monkeypatch.setattr(escrow, "create_transfer", lambda **kw: sent.append(kw) or {"transfer_code": "T"})
    monkeypatch.setenv("REQUIRE_VERIFIED_SELLERS_FOR_PAYOUT", "true")
    escrow.release_to_merchant(db, order)
    assert sent == [] and db.refresh(order) is None and order.payout_status == PayoutStatus.held
    merchant.verified_at = datetime.now(timezone.utc)
    db.commit()
    escrow.release_to_merchant(db, order)
    db.refresh(order)
    assert len(sent) == 1 and order.payout_status == PayoutStatus.released


def test_export_has_the_decision_but_never_the_photo_keys(client, db, private):
    user, boss = seller(db), admin(db)
    user.hashed_password = None
    db.commit()
    submit(client, user)
    body = client.post("/users/me/export", json={}, headers=auth(user)).text
    assert "seller_verification" in body and "document_key" not in body and "verification/" not in body
