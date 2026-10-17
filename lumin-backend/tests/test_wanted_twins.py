"""The wanted wall's compare list, "Twin it", reports, and the creator's review inbox.

Written alongside the code but needs the Postgres harness (TEST_DATABASE_URL, see
conftest.py) to run."""
from app.models import Report, VideoMomentProduct
from tests.conftest import auth, make_post, make_user
from tests.test_twin_search import bought, listing, pick, search, shown
from tests.test_twins import make_merchant
from tests.test_wanted import board

ASK = "red leather shoulder bag"
CLIP = {"start_ms": 1000, "end_ms": 3000}


def moment(client, db, poster, names=("a", "b"), query=ASK):
    """A video by `poster` and shoppers who each asked about the same clip of it."""
    post = make_post(db, poster)
    users = [make_user(db, n) for n in names]
    for u in users:
        assert search(client, u, query, video_post_id=str(post.id), **CLIP).status_code == 200
    return post, users, board(client)["items"][0]["id"]


def twin_it(client, seller, rid, product):
    return client.post(f"/wanted/{rid}/twin", headers=auth(seller), json={"product_id": str(product.id)})


def twins(client, rid, user=None):
    r = client.get(f"/wanted/{rid}/twins", headers=auth(user) if user else {})
    assert r.status_code == 200, r.text
    return r.json()


def review(client, poster, post, product, decision, db):
    link = db.query(VideoMomentProduct).filter_by(product_id=product.id).one()
    r = client.post(
        f"/video-posts/{post.id}/moment-products/{link.id}/review", headers=auth(poster), json={"decision": decision}
    )
    assert r.status_code == 204, r.text


def test_a_twin_it_shows_as_offered_and_counts_on_the_tile(client, db):
    poster, seller = make_merchant(db, "poster"), make_merchant(db, "seller")
    post, (a, b), rid = moment(client, db, poster)
    assert board(client)["items"][0]["twinned"] == 0
    mini = listing(db, seller, "Mini Leather Bag", "Soft", ["Red"], images=1)
    r = twin_it(client, seller, rid, mini)
    assert r.status_code == 200, r.text
    assert r.json()["notified"] == 2 and r.json()["option"]["kind"] == "offered"
    assert r.json()["option"]["similar"] is False  # no official twin, so nothing is "the exact item"
    item = board(client)["items"][0]
    assert item["twinned"] == 1 and item["video_post_id"] == str(post.id)
    assert item["twin_previews"] == ["https://cdn.test/0.jpg"]  # the photo shown on the tile
    assert item["creator_avatar_url"] is None  # test users have no avatar; the field is there
    assert (item["start_ms"], item["end_ms"]) == (1000, 3000) and item["video_url"]
    assert twin_it(client, seller, rid, mini).json()["notified"] == 0  # asking twice tells nobody again


def test_the_posters_own_twin_is_official_and_others_become_similar(client, db):
    poster, seller = make_merchant(db, "poster"), make_merchant(db, "seller")
    post, _, rid = moment(client, db, poster)
    mini = listing(db, seller, "Mini Leather Bag", "Soft", ["Red"])
    twin_it(client, seller, rid, mini)
    own = listing(db, poster, "Atelier Red Leather Shoulder Bag", "The one in the video")
    r = twin_it(client, poster, rid, own)
    assert r.json()["option"]["kind"] == "official" and r.json()["option"]["similar"] is False
    body = twins(client, rid)
    assert body["has_official"] is True
    assert [o["kind"] for o in body["items"]] == ["official", "offered"]
    assert [o["similar"] for o in body["items"]] == [False, True]
    assert body["items"][0]["product"]["id"] == str(own.id)


def test_an_offer_is_never_evidence_the_product_is_in_the_video(client, db):
    poster, seller = make_merchant(db, "poster"), make_merchant(db, "seller")
    post, _, rid = moment(client, db, poster)
    twin_it(client, seller, rid, listing(db, seller, "Mini Leather Bag", "Soft", ["Red"]))
    assert shown(client, post) == []  # not trusted, so not what other surfaces show for the moment


def test_the_poster_can_approve_or_hide_an_offer(client, db):
    poster, seller = make_merchant(db, "poster"), make_merchant(db, "seller")
    post, _, rid = moment(client, db, poster)
    mini = listing(db, seller, "Mini Leather Bag", "Soft", ["Red"])
    twin_it(client, seller, rid, mini)
    review(client, poster, post, mini, "confirm", db)
    assert [o["kind"] for o in twins(client, rid)["items"]] == ["confirmed"]
    review(client, poster, post, mini, "reject", db)
    assert twins(client, rid)["items"] == [] and board(client)["items"][0]["twinned"] == 0
    r = twin_it(client, seller, rid, mini)  # the creator said no for this moment
    assert r.status_code == 409


def test_shoppers_who_kept_it_confirm_a_twin(client, db):
    poster, seller = make_merchant(db, "poster"), make_merchant(db, "seller")
    post, _, rid = moment(client, db, poster)
    bag = listing(db, seller, "Red Leather Shoulder Bag", "Soft")
    twin_it(client, seller, rid, bag)
    for who in ("k1", "k2"):
        u = make_user(db, who)
        pick(client, u, post, bag, ASK, 1000, 3000)
        bought(db, u, bag)
    opt = twins(client, rid)["items"][0]
    assert opt["kind"] == "confirmed" and opt["kept"] == 2


def test_my_products_are_listed_best_match_first_for_sellers_only(client, db):
    poster, seller = make_merchant(db, "poster"), make_merchant(db, "seller")
    post, (a, b), rid = moment(client, db, poster)
    listing(db, seller, "Phone Charger")
    good = listing(db, seller, "Red Leather Shoulder Bag", "Soft")
    r = client.get(f"/wanted/{rid}/my-products", headers=auth(seller))
    assert r.status_code == 200, r.text
    rows = r.json()
    assert rows[0]["product"]["id"] == str(good.id) and rows[0]["match"] == "strong"
    assert rows[-1]["match"] == "weak" and all(x["twinned"] is False for x in rows)
    assert client.get(f"/wanted/{rid}/my-products", headers=auth(a)).status_code == 403


def test_a_seller_can_take_their_twin_back(client, db):
    poster, seller = make_merchant(db, "poster"), make_merchant(db, "seller")
    post, _, rid = moment(client, db, poster)
    mini = listing(db, seller, "Mini Leather Bag", "Soft", ["Red"])
    twin_it(client, seller, rid, mini)
    assert client.delete(f"/wanted/{rid}/twin/{mini.id}", headers=auth(poster)).status_code == 404  # not theirs
    assert client.delete(f"/wanted/{rid}/twin/{mini.id}", headers=auth(seller)).status_code == 204
    assert twins(client, rid)["items"] == [] and db.query(VideoMomentProduct).count() == 0


def test_reports_go_to_the_admin_queue_and_only_enough_of_them_hide_a_twin(client, db):
    poster, seller = make_merchant(db, "poster"), make_merchant(db, "seller")
    post, (a, b), rid = moment(client, db, poster)
    fake = listing(db, seller, "Red Leather Shoulder Bag", "Not the real thing")
    twin_it(client, seller, rid, fake)
    url = f"/wanted/{rid}/twins/{fake.id}/report"
    assert client.post(url, headers=auth(a), json={"reason": "counterfeit"}).status_code == 204
    assert client.post(url, headers=auth(a), json={"reason": "counterfeit"}).status_code == 204  # same person again
    assert db.query(Report).count() == 1
    rep = db.query(Report).one()
    assert rep.target_id == fake.id and rep.detail.startswith("twin:counterfeit")
    assert len(twins(client, rid)["items"]) == 1  # one report hides nothing
    assert client.post(url, headers=auth(b), json={"reason": "mismatch"}).status_code == 204
    assert client.post(url, headers=auth(make_user(db, "c")), json={"reason": "likeness", "detail": "uses a face"}).status_code == 204
    assert twins(client, rid)["items"] == []  # three different shoppers: hidden until reviewed
    assert client.post(url, json={"reason": "mismatch"}).status_code in (401, 403)


def test_the_wall_keeps_a_request_that_has_twins_and_has_new_tabs(client, db):
    poster, seller = make_merchant(db, "poster"), make_merchant(db, "seller")
    post, (a, b), rid = moment(client, db, poster)
    twin_it(client, seller, rid, listing(db, seller, "Mini Leather Bag", "Soft", ["Red"]))
    # Everyone waiting has been told, but it still has twins to compare, so it stays on the wall.
    assert [i["id"] for i in board(client, "trending")["items"]] == [rid]
    assert [i["id"] for i in board(client, "most_twinned")["items"]] == [rid]
    # ...and a different, unlisted ask of one shopper shows under Mine, only to them.
    c = make_user(db, "c")
    search(client, c, "green velvet sofa")
    mine = board(client, "mine", user=c)["items"]
    assert [i["query"] for i in mine] == ["green velvet sofa"]
    assert board(client, "mine")["items"] == []


def test_the_creator_sees_impact_and_an_inbox_of_twins_on_their_videos(client, db):
    poster, seller = make_merchant(db, "poster"), make_merchant(db, "seller")
    post, (a, b), rid = moment(client, db, poster)
    mini = listing(db, seller, "Mini Leather Bag", "Soft", ["Red"])
    twin_it(client, seller, rid, mini)
    imp = client.get("/creator/impact", headers=auth(poster)).json()
    assert imp["wanted"] == 2 and imp["twins_offered"] == 1 and imp["can_tag"] is True
    assert [(m["request_id"], m["wants"], m["twinned"], m["mine"]) for m in imp["moments"]] == [(rid, 2, 1, False)]

    inbox = client.get("/creator/twins", headers=auth(poster)).json()
    assert (inbox["review"], inbox["approved"], inbox["hidden"]) == (1, 0, 0)
    row = inbox["items"][0]
    assert row["product"]["id"] == str(mini.id) and row["for_query"] == ASK and row["state"] == "review"
    assert row["video_post_id"] == str(post.id) and row["new_seller"] is True

    review(client, poster, post, mini, "confirm", db)
    after = client.get("/creator/twins?state=approved", headers=auth(poster)).json()
    assert (after["review"], after["approved"]) == (0, 1) and after["items"][0]["state"] == "approved"

    # Nobody else's videos: an empty, quiet screen rather than someone else's data.
    other = client.get("/creator/twins", headers=auth(seller)).json()
    assert other["items"] == [] and other["review"] == 0
    assert client.get("/creator/impact", headers=auth(seller)).json()["wanted"] == 0



def test_different_words_for_the_same_moment_are_one_request(client, db):
    poster = make_merchant(db, "poster")
    post = make_post(db, poster)
    a, b, c = (make_user(db, n) for n in "abc")
    assert search(client, a, "red leather shoulder bag", video_post_id=str(post.id), **CLIP).status_code == 200
    # Another shopper words it differently, and clips a slightly different stretch.
    assert search(client, b, "crimson purse", video_post_id=str(post.id), start_ms=1200, end_ms=3000).status_code == 200
    items = board(client)["items"]
    assert len(items) == 1 and items[0]["count"] == 2  # reached the 2-person threshold
    # A different moment of the same video stays its own request.
    assert search(client, c, "crimson purse", video_post_id=str(post.id), start_ms=8000, end_ms=9000).status_code == 200
    assert len(board(client)["items"]) == 1


def test_nearby_lists_requests_on_this_moment_only(client, db):
    poster = make_merchant(db, "poster")
    post, (a, b), rid = moment(client, db, poster)
    c = make_user(db, "c")
    r = client.get("/wanted/nearby", params={"video_post_id": str(post.id), "start_ms": 1500, "end_ms": 3000}, headers=auth(c))
    assert r.status_code == 200, r.text
    got = r.json()
    assert [(i["id"], i["count"], i["upvoted"]) for i in got] == [(rid, 2, False)]
    far = client.get("/wanted/nearby", params={"video_post_id": str(post.id), "start_ms": 8000, "end_ms": 9000})
    assert far.json() == []
    # "Want it too" joins that request instead of starting another.
    assert client.post(f"/wanted/{rid}/upvote", headers=auth(c)).status_code == 200
    assert board(client)["items"][0]["count"] == 3 and len(board(client)["items"]) == 1


def test_one_shoppers_unlisted_ask_is_not_shown_as_nearby(client, db):
    poster = make_merchant(db, "poster")
    post = make_post(db, poster)
    a, b = make_user(db, "a"), make_user(db, "b")
    search(client, a, ASK, video_post_id=str(post.id), **CLIP)  # only one shopper: not listed
    params = {"video_post_id": str(post.id), **CLIP}
    assert client.get("/wanted/nearby", params=params, headers=auth(b)).json() == []
    assert len(client.get("/wanted/nearby", params=params, headers=auth(a)).json()) == 1  # their own


JACKET = {"x": 0.1, "y": 0.1, "w": 0.4, "h": 0.5}
JACKET_AGAIN = {"x": 0.15, "y": 0.12, "w": 0.4, "h": 0.5}
BAG = {"x": 0.6, "y": 0.6, "w": 0.3, "h": 0.3}


def test_circling_different_items_in_one_frame_makes_different_requests(client, db):
    poster = make_merchant(db, "poster")
    post = make_post(db, poster)
    a, b, c, d = (make_user(db, n) for n in "abcd")
    ask = lambda u, q, box: search(client, u, q, video_post_id=str(post.id), box=box, **CLIP)
    assert ask(a, "green jacket", JACKET).status_code == 200
    assert ask(b, "jacket", JACKET_AGAIN).status_code == 200  # same circle, same request
    assert ask(c, "jacket", BAG).status_code == 200  # same words, but a different thing
    assert ask(d, "tan bag", BAG).status_code == 200
    items = {i["query"]: i for i in board(client)["items"]}
    assert len(items) == 2 and sorted(i["count"] for i in items.values()) == [2, 2]
    assert items["green jacket"]["box"] == JACKET  # the first circle is the tile's


def test_a_circle_needs_a_clipped_video_moment_and_stays_inside_the_frame(client, db):
    a = make_user(db, "a")
    assert search(client, a, ASK, box=JACKET).status_code == 422
    post = make_post(db, make_merchant(db, "poster"))
    out = {"x": 0.8, "y": 0.1, "w": 0.4, "h": 0.4}
    assert search(client, a, ASK, video_post_id=str(post.id), box=out, **CLIP).status_code == 422


def test_nearby_only_offers_requests_for_the_same_circled_thing(client, db):
    poster = make_merchant(db, "poster")
    post = make_post(db, poster)
    a, b, c = (make_user(db, n) for n in "abc")
    for u in (a, b):
        search(client, u, "green jacket", video_post_id=str(post.id), box=JACKET, **CLIP)
    p = {"video_post_id": str(post.id), **CLIP}
    same = client.get("/wanted/nearby", params={**p, "bx": 0.12, "by": 0.1, "bw": 0.4, "bh": 0.5}, headers=auth(c))
    other = client.get("/wanted/nearby", params={**p, "bx": 0.6, "by": 0.6, "bw": 0.3, "bh": 0.3}, headers=auth(c))
    assert len(same.json()) == 1 and other.json() == []


def test_hints_share_words_and_counts_but_never_who(client, db):
    poster = make_merchant(db, "poster")
    post = make_post(db, poster)
    a, b, c = (make_user(db, n) for n in "abc")
    search(client, a, "green jacket", video_post_id=str(post.id), box=JACKET, **CLIP)
    search(client, b, "jacket", video_post_id=str(post.id), box=JACKET_AGAIN, **CLIP)
    p = {"video_post_id": str(post.id), **CLIP}
    r = client.get("/wanted/suggest", params={**p, "bx": 0.1, "by": 0.1, "bw": 0.4, "bh": 0.5}, headers=auth(c))
    assert r.status_code == 200, r.text
    body = r.json()
    assert (body["asked"], body["circled"]) == (2, 2)
    assert body["words"] == [{"word": "jacket", "count": 2}]  # "green" was only one person's
    # Circling something else: those two did not mean this.
    other = client.get("/wanted/suggest", params={**p, "bx": 0.6, "by": 0.6, "bw": 0.3, "bh": 0.3}, headers=auth(c)).json()
    assert (other["asked"], other["circled"], other["words"]) == (0, 0, [])
    # You are never counted among the others.
    mine = client.get("/wanted/suggest", params=p, headers=auth(a)).json()
    assert mine["asked"] == 1


def test_the_circle_remembers_which_frame_it_was_drawn_on(client, db):
    poster = make_merchant(db, "poster")
    post = make_post(db, poster)
    a, b = make_user(db, "a"), make_user(db, "b")
    r = search(client, a, "green jacket", video_post_id=str(post.id), box=JACKET, box_at_ms=2000, **CLIP)
    assert r.status_code == 200, r.text
    search(client, b, "jacket", video_post_id=str(post.id), box=JACKET_AGAIN, box_at_ms=2500, **CLIP)
    item = board(client)["items"][0]
    assert item["box"] == JACKET and item["box_at_ms"] == 2000  # the first shopper's frame
    # A frame outside the clip, or a frame without a circle, is refused.
    assert search(client, a, ASK, video_post_id=str(post.id), box=JACKET, box_at_ms=9000, **CLIP).status_code == 422
    assert search(client, a, ASK, video_post_id=str(post.id), box_at_ms=2000, **CLIP).status_code == 422
