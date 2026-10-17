from app.models import Order, VideoPost, VideoView
from tests.conftest import auth, make_post, make_product, make_user


def start(client, post, headers=None, key="dev1"):
    return client.post(f"/video-posts/{post.id}/view", json={"viewer_key": key}, headers=headers or {})


def test_view_counts_once_per_viewer_per_day(client, db):
    post = make_post(db, make_user(db, "poster"))
    first = start(client, post)
    again = start(client, post)
    assert first.status_code == 200
    assert first.json()["view_id"] == again.json()["view_id"]
    db.expire_all()
    p = db.get(VideoPost, post.id)
    assert (p.views_count, p.unique_viewers_count) == (1, 1)
    assert db.query(VideoView).count() == 1


def test_different_devices_are_separate_unique_viewers(client, db):
    post = make_post(db, make_user(db, "poster"))
    start(client, post, key="a")
    start(client, post, key="b")
    db.expire_all()
    p = db.get(VideoPost, post.id)
    assert (p.views_count, p.unique_viewers_count) == (2, 2)


def test_posters_own_views_are_not_counted(client, db):
    poster = make_user(db, "poster")
    post = make_post(db, poster)
    r = start(client, post, headers=auth(poster))
    assert r.json()["view_id"] is None
    db.expire_all()
    assert db.get(VideoPost, post.id).views_count == 0


def test_reposts_credit_the_original(client, db):
    owner, reposter = make_user(db, "o"), make_user(db, "r")
    original = make_post(db, owner)
    repost = make_post(db, reposter, repost_of=original)
    start(client, repost)
    db.expire_all()
    assert db.get(VideoPost, original.id).views_count == 1
    assert db.get(VideoPost, repost.id).views_count == 0


def test_unknown_post_404(client):
    import uuid

    r = client.post(f"/video-posts/{uuid.uuid4()}/view", json={"viewer_key": "x"})
    assert r.status_code == 404


def test_progress_accumulates_and_completion_counts_once(client, db):
    post = make_post(db, make_user(db, "poster"))
    view_id = start(client, post).json()["view_id"]
    url = f"/video-posts/views/{view_id}/progress"
    client.post(url, json={"watch_seconds": 5, "completed": False})
    client.post(url, json={"watch_seconds": 4, "completed": True})
    client.post(url, json={"watch_seconds": 1, "completed": True})
    db.expire_all()
    p = db.get(VideoPost, post.id)
    assert p.watch_seconds_total == 10
    assert p.completions_count == 1


def test_progress_report_is_capped(client, db):
    post = make_post(db, make_user(db, "poster"))
    view_id = start(client, post).json()["view_id"]
    client.post(f"/video-posts/views/{view_id}/progress", json={"watch_seconds": 3000, "completed": False})
    db.expire_all()
    assert db.get(VideoPost, post.id).watch_seconds_total == 120


def test_product_tap_counts_only_tagged_products(client, db):
    owner = make_user(db, "o")
    tagged, other = make_product(db), make_product(db)
    post = make_post(db, owner, [tagged])
    client.post(f"/video-posts/{post.id}/product-tap", json={"product_id": str(tagged.id)})
    client.post(f"/video-posts/{post.id}/product-tap", json={"product_id": str(other.id)})
    db.expire_all()
    assert db.get(VideoPost, post.id).product_taps_count == 1


def test_funnel_excludes_cancelled_orders_and_is_owner_only(client, db, buyer):
    from app.models import OrderStatus

    owner = make_user(db, "owner")
    p = make_product(db)
    post = make_post(db, owner, [p])
    db.add_all(
        [
            Order(buyer_id=buyer.id, product_id=p.id, product_name="W", price=10, buyer_name="B", source_video_post_id=post.id),
            Order(buyer_id=buyer.id, product_id=p.id, product_name="W", price=10, buyer_name="B", source_video_post_id=post.id, status=OrderStatus.cancelled),
        ]
    )
    db.commit()
    rows = client.get("/video-posts/mine/funnel", headers=auth(owner)).json()
    assert len(rows) == 1 and rows[0]["orders"] == 1 and rows[0]["revenue"] == 10
    assert client.get("/video-posts/mine/funnel", headers=auth(buyer)).json() == []
