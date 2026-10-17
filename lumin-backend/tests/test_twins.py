"""Twinning: every tagged product on a shop video must be paired with when it appears."""
from app.models import MerchantAccount, Notification, VideoPostTwin
from app.models.user import UserRole
from tests.conftest import auth, make_post, make_product, make_user


def make_merchant(db, name="merch"):
    user = make_user(db, name)
    db.add(MerchantAccount(user_id=user.id, business_name="Shop", category="Fashion", description=""))
    db.commit()
    db.refresh(user)
    return user


def twin(product, start=0, end=3000, label="bag"):
    return {"product_id": str(product.id), "label": label, "start_ms": start, "end_ms": end}


def create(client, merchant, products, twins):
    return client.post(
        "/video-posts",
        headers=auth(merchant),
        json={"feed": "shop", "video_url": "https://cdn.test/v.mp4", "product_ids": [str(p.id) for p in products], "twins": twins},
    )


def test_create_with_all_products_twinned(client, db):
    m = make_merchant(db)
    a, b = make_product(db), make_product(db)
    r = create(client, m, [a, b], [twin(a), twin(b, 4000, 6000, "shoes")])
    assert r.status_code == 201, r.text
    body = r.json()
    assert {t["label"] for t in body["twins"]} == {"bag", "shoes"}
    assert all(t["review_status"] == "pending" for t in body["twins"])


def test_untwinned_product_is_rejected(client, db):
    m = make_merchant(db)
    a, b = make_product(db), make_product(db)
    r = create(client, m, [a, b], [twin(a)])
    assert r.status_code == 400
    assert db.query(VideoPostTwin).count() == 0


def test_twin_for_untagged_product_is_rejected(client, db):
    m = make_merchant(db)
    a, other = make_product(db), make_product(db)
    assert create(client, m, [a], [twin(a), twin(other)]).status_code == 400


def test_twin_shorter_than_one_second_is_rejected(client, db):
    m = make_merchant(db)
    a = make_product(db)
    assert create(client, m, [a], [twin(a, 1000, 1500)]).status_code == 422


def test_a_product_can_have_several_moments(client, db):
    m = make_merchant(db)
    a = make_product(db)
    r = create(client, m, [a], [twin(a, 0, 2000), twin(a, 8000, 10000)])
    assert r.status_code == 201
    assert len(r.json()["twins"]) == 2


def test_unchanged_twins_keep_review_status_on_edit(client, db):
    m = make_merchant(db)
    a = make_product(db)
    post_id = create(client, m, [a], [twin(a)]).json()["id"]
    row = db.query(VideoPostTwin).one()
    row.review_status = "approved"
    db.commit()
    r = client.patch(
        f"/video-posts/{post_id}", headers=auth(m),
        json={"description": "new caption", "product_ids": [str(a.id)], "twins": [twin(a)]},
    )
    assert r.status_code == 200
    db.expire_all()
    assert db.query(VideoPostTwin).one().review_status.value == "approved"


def test_changed_twin_goes_back_to_pending(client, db):
    m = make_merchant(db)
    a = make_product(db)
    post_id = create(client, m, [a], [twin(a)]).json()["id"]
    db.query(VideoPostTwin).one().review_status = "approved"
    db.commit()
    client.patch(f"/video-posts/{post_id}", headers=auth(m), json={"product_ids": [str(a.id)], "twins": [twin(a, 500, 4000)]})
    db.expire_all()
    assert db.query(VideoPostTwin).one().review_status.value == "pending"


def test_adding_a_product_without_twinning_it_is_rejected(client, db):
    m = make_merchant(db)
    a, b = make_product(db), make_product(db)
    post_id = create(client, m, [a], [twin(a)]).json()["id"]
    r = client.patch(f"/video-posts/{post_id}", headers=auth(m), json={"product_ids": [str(a.id), str(b.id)]})
    assert r.status_code == 400


def test_caption_only_edit_needs_no_twins(client, db):
    m = make_merchant(db)
    a = make_product(db)
    post_id = create(client, m, [a], [twin(a)]).json()["id"]
    assert client.patch(f"/video-posts/{post_id}", headers=auth(m), json={"description": "hi"}).status_code == 200


def test_discover_posts_cannot_have_twins(client, db):
    u = make_user(db, "u")
    a = make_product(db)
    r = client.post("/video-posts", headers=auth(u), json={"feed": "discover", "twins": [twin(a)]})
    assert r.status_code == 400


def make_admin(db):
    admin = make_user(db, "admin")
    admin.role = UserRole.admin
    db.commit()
    return admin


def test_admin_queue_approve_and_flag(client, db):
    m = make_merchant(db)
    a = make_product(db)
    create(client, m, [a], [twin(a)])
    admin = make_admin(db)
    queue = client.get("/admin/twins", headers=auth(admin)).json()
    assert len(queue) == 1 and queue[0]["label"] == "bag"
    tid = queue[0]["id"]
    r = client.patch(f"/admin/twins/{tid}", headers=auth(admin), json={"status": "flagged", "reason": "no bag here"})
    assert r.status_code == 200 and r.json()["review_status"] == "flagged"
    assert client.get("/admin/twins", headers=auth(admin)).json() == []
    note = db.query(Notification).filter_by(user_id=m.id).one()
    assert "no bag here" in note.body


def test_review_endpoints_are_admin_only(client, db):
    m = make_merchant(db)
    assert client.get("/admin/twins", headers=auth(m)).status_code == 403
