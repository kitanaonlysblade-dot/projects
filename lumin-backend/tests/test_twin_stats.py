from app.models import VideoPostTwin
from tests.conftest import auth, make_post, make_product, make_user
from tests.test_twin_search import search
from tests.test_twins import make_merchant


def make_admin(db):
    from app.models import UserRole

    u = make_user(db, "boss")
    u.role = UserRole.admin
    db.commit()
    return u


def test_twin_stats_counts_what_happened_today(client, db):
    shop = make_merchant(db)
    p = make_product(db)
    post = make_post(db, shop, [p])
    db.add(VideoPostTwin(video_post_id=post.id, product_id=p.id, label="bag", start_ms=0, end_ms=3000))
    db.commit()
    search(client, make_user(db, "fan9"), "green velvet sofa")  # nothing matches
    search(client, make_user(db, "fan8"), "widget")  # matches the product
    admin = make_admin(db)
    r = client.get("/admin/twin-stats?days=7", headers=auth(admin))
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["series"]) == 7
    assert body["totals"]["twins_created"] == 1
    assert body["totals"]["searches"] == 2
    assert body["totals"]["searches_not_found"] == 1
    assert body["match_rate"] == 0.5
    assert body["pending_review"] == 1
    assert body["waiting_searches"] == 1


def test_twin_stats_needs_an_admin(client, db):
    fan = make_user(db, "fan10")
    assert client.get("/admin/twin-stats", headers=auth(fan)).status_code in (401, 403)
