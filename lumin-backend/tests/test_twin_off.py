"""TWIN_ENABLED off (the default): the twin discovery layer disappears, shop video tagging stays."""
from app.models import Notification
from tests.conftest import auth, make_product, make_user
from tests.test_twin_search import search
from tests.test_twins import create, make_merchant, twin


def off(monkeypatch):
    monkeypatch.delenv("TWIN_ENABLED", raising=False)


def test_discovery_routes_are_hidden_when_off_and_back_when_on(client, db, monkeypatch):
    fan = make_user(db, "fan")
    assert client.get("/wanted").status_code == 200  # the suite runs with twins on

    off(monkeypatch)
    assert client.get("/wanted").status_code == 404
    assert client.get("/wanted/leads", headers=auth(fan)).status_code == 404
    assert client.post("/twin-search", headers=auth(fan), json={"query": "red leather bag"}).status_code == 404
    assert client.get("/twin-search/mine", headers=auth(fan)).status_code == 404
    assert client.get("/creator/impact", headers=auth(fan)).status_code == 404
    assert client.get("/creator/twins", headers=auth(fan)).status_code == 404
    assert client.get("/merchant/insights/keywords", headers=auth(fan)).status_code == 404

    monkeypatch.setenv("TWIN_ENABLED", "true")
    assert client.get("/wanted").status_code == 200


def test_the_default_is_off(monkeypatch):
    from app import twin_config

    off(monkeypatch)
    assert twin_config.enabled() is False
    for v in ("true", "1", "YES", " on "):
        monkeypatch.setenv("TWIN_ENABLED", v)
        assert twin_config.enabled() is True
    monkeypatch.setenv("TWIN_ENABLED", "false")
    assert twin_config.enabled() is False


def test_sellers_can_still_tag_their_own_videos_and_read_the_config(client, db, monkeypatch):
    off(monkeypatch)
    m = make_merchant(db)
    a = make_product(db)
    r = create(client, m, [a], [twin(a)])
    assert r.status_code == 201, r.text
    assert [t["label"] for t in r.json()["twins"]] == ["bag"]
    assert client.get("/twin-config").json()["min_twin_ms"] > 0


def test_listing_a_product_notifies_nobody_while_off(client, db, monkeypatch):
    shop = make_merchant(db)
    fan = make_user(db, "fan")
    assert search(client, fan, "blue denim jacket").json()["status"] == "not_found"  # waiting, while on

    off(monkeypatch)
    r = client.post(
        "/merchant/products",
        headers=auth(shop),
        json={"name": "Blue Denim Jacket", "price": "30.00", "image_urls": []},
    )
    assert r.status_code == 201, r.text
    assert db.query(Notification).filter_by(user_id=fan.id, type="twin_available").count() == 0
