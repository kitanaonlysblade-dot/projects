"""The public Wanted board: unmet twin searches, grouped, joinable, offerable."""
from app.models import Notification, TwinSearch
from tests.conftest import auth, make_post, make_user
from tests.test_twin_search import listing, search
from tests.test_twins import make_merchant

ASK = "oversized denim jacket"


def want(client, db, who, query=ASK, **extra):
    return search(client, make_user(db, who), query, **extra)


def board(client, tab="trending", user=None):
    r = client.get(f"/wanted?tab={tab}", headers=auth(user) if user else {})
    assert r.status_code == 200, r.text
    return r.json()


def test_a_request_is_listed_once_enough_shoppers_want_it(client, db):
    want(client, db, "a")
    assert board(client)["items"] == []  # one person's free text isn't published
    want(client, db, "b", "Denim jacket, oversized")  # same words, different order
    b = board(client)
    assert b["open_count"] == 1
    item = b["items"][0]
    assert item["count"] == 2 and item["status"] == "open" and item["upvoted"] is False


def test_matched_searches_never_reach_the_board(client, db):
    shop = make_merchant(db)
    listing(db, shop, "Oversized Denim Jacket")
    want(client, db, "a")
    want(client, db, "b")
    assert board(client)["items"] == []


def test_me_too_joins_once_and_can_be_withdrawn(client, db):
    want(client, db, "a")
    want(client, db, "b")
    rid = board(client)["items"][0]["id"]
    c = make_user(db, "c")
    r = client.post(f"/wanted/{rid}/upvote", headers=auth(c))
    assert r.status_code == 200, r.text
    assert r.json()["matches"] == [] and r.json()["item"]["count"] == 3 and r.json()["item"]["upvoted"] is True
    assert client.post(f"/wanted/{rid}/upvote", headers=auth(c)).json()["item"]["count"] == 3  # idempotent
    assert board(client, user=c)["items"][0]["upvoted"] is True
    after = client.delete(f"/wanted/{rid}/upvote", headers=auth(c))
    assert after.status_code == 200 and after.json()["count"] == 2 and after.json()["upvoted"] is False
    assert client.post(f"/wanted/{rid}/upvote").status_code in (401, 403)  # signed-in only


def test_the_bell_decides_who_is_told_when_a_twin_is_listed(client, db):
    shop = make_merchant(db)
    a, b = make_user(db, "a"), make_user(db, "b")
    search(client, a, ASK)
    search(client, b, ASK)
    rid = board(client)["items"][0]["id"]
    off = client.put(f"/wanted/{rid}/notify", headers=auth(b), json={"notify": False})
    assert off.status_code == 200 and off.json()["notifying"] is False and off.json()["count"] == 2
    client.post(
        "/merchant/products",
        headers=auth(shop),
        json={"name": "Oversized Denim Jacket", "price": "40.00", "description": "Classic", "image_urls": []},
    )
    assert db.query(Notification).filter_by(user_id=a.id, type="twin_available").count() == 1
    assert db.query(Notification).filter_by(user_id=b.id, type="twin_available").count() == 0


def test_a_listed_twin_moves_the_request_to_fulfilled(client, db):
    shop = make_merchant(db)
    want(client, db, "a")
    want(client, db, "b")
    client.post("/merchant/products", headers=auth(shop), json={"name": "Oversized Denim Jacket", "price": "40.00", "image_urls": []})
    assert board(client, "trending")["items"] == []
    done = board(client, "fulfilled")["items"]
    assert len(done) == 1 and done[0]["status"] == "fulfilled" and done[0]["fulfilled_product"]["name"] == "Oversized Denim Jacket"


def test_joining_when_a_twin_already_exists_shows_it_instead(client, db):
    shop = make_merchant(db)
    want(client, db, "a")
    want(client, db, "b")
    rid = board(client)["items"][0]["id"]
    jacket = listing(db, shop, "Oversized Denim Jacket")  # added straight to the db: nobody notified
    r = client.post(f"/wanted/{rid}/upvote", headers=auth(make_user(db, "c"))).json()
    assert [m["id"] for m in r["matches"]] == [str(jacket.id)]
    assert r["item"]["count"] == 2  # they have a match, so they aren't one of the waiting


def test_a_seller_can_offer_a_product_and_waiting_shoppers_are_told_once(client, db):
    shop = make_merchant(db)
    other = make_merchant(db, "other")
    mine = listing(db, shop, "Indigo Chore Coat")  # no shared words with the request
    theirs = listing(db, other, "Something Else")
    a, b = make_user(db, "a"), make_user(db, "b")
    search(client, a, ASK)
    search(client, b, ASK)
    rid = board(client)["items"][0]["id"]
    assert client.post(f"/wanted/{rid}/offer", headers=auth(a), json={"product_id": str(mine.id)}).status_code == 403
    assert client.post(f"/wanted/{rid}/offer", headers=auth(shop), json={"product_id": str(theirs.id)}).status_code == 404
    r = client.post(f"/wanted/{rid}/offer", headers=auth(shop), json={"product_id": str(mine.id)})
    assert r.status_code == 200 and r.json() == {"notified": 2}
    note = db.query(Notification).filter_by(user_id=a.id, type="twin_available").one()
    assert str(note.target_id) == str(mine.id) and "A seller has a twin" in note.body
    assert client.post(f"/wanted/{rid}/offer", headers=auth(shop), json={"product_id": str(mine.id)}).json() == {"notified": 0}
    assert board(client, "fulfilled")["items"][0]["fulfilled_product"]["id"] == str(mine.id)


def test_detail_shows_the_clip_and_activity_without_names(client, db):
    shop = make_merchant(db)
    post = make_post(db, shop)
    want(client, db, "a", video_post_id=str(post.id), start_ms=1000, end_ms=3000)
    want(client, db, "b")
    rid = board(client)["items"][0]["id"]
    d = client.get(f"/wanted/{rid}").json()
    assert d["video_post_id"] == str(post.id) and (d["start_ms"], d["end_ms"]) == (1000, 3000)
    assert d["creator_name"] and d["count"] == 2
    assert {e["kind"] for e in d["events"]} == {"wanted"}
    assert all(set(e) == {"kind", "at"} for e in d["events"])
    assert board(client)["items"][0]["has_clip"] is True


def test_an_unlisted_request_is_only_visible_to_those_in_it(client, db):
    a = make_user(db, "a")
    search(client, a, ASK)
    rid = str(db.query(TwinSearch).one().id)
    assert client.get(f"/wanted/{rid}").status_code == 404
    assert client.get(f"/wanted/{rid}", headers=auth(make_user(db, "stranger"))).status_code == 404
    assert client.get(f"/wanted/{rid}", headers=auth(a)).status_code == 200
