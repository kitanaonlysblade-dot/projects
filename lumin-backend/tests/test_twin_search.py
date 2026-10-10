"""Twin search: describe (and optionally clip) what you saw; get twins or a waitlist."""
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from app.models import (
    MerchantAccount,
    Notification,
    Product,
    ProductImage,
    TwinSearch,
    VideoMomentProduct,
    VideoPostTwin,
)
from tests.conftest import auth, make_post, make_user
from tests.test_twins import make_merchant

FRAME = "https://cdn.test/frames/f.jpg"


def listing(db, merchant_user, name, description="", colors=(), images=0, stock=5):
    p = Product(
        name=name,
        price=Decimal("10.00"),
        description=description,
        colors=list(colors),
        stock_quantity=stock,
        merchant_id=merchant_user.merchant_account.id,
        images=[ProductImage(url=f"https://cdn.test/{i}.jpg", position=i) for i in range(images)],
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


def search(client, user, query, **extra):
    return client.post("/twin-search", headers=auth(user), json={"query": query, **extra})


def test_description_finds_a_matching_product(client, db):
    shop = make_merchant(db)
    bag = listing(db, shop, "Leather Tote Bag", "Handmade", ["Red"])
    listing(db, shop, "Phone Charger")
    fan = make_user(db, "fan")
    r = search(client, fan, "red leather bag")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "matched"
    assert [x["product"]["id"] for x in body["results"]] == [str(bag.id)]
    assert body["results"][0]["source"] == "search"


def test_nothing_found_promises_a_notification(client, db):
    shop = make_merchant(db)
    listing(db, shop, "Phone Charger")
    fan = make_user(db, "fan")
    body = search(client, fan, "green velvet sofa").json()
    assert body["status"] == "not_found" and body["results"] == []
    assert "notify you" in body["message"]
    assert search(client, fan, "Sofa, green velvet").json()["id"] == body["id"]  # same ask, same row
    assert db.query(TwinSearch).count() == 1


def test_listing_quality_orders_equal_matches_but_never_creates_one(client, db):
    shop = make_merchant(db)
    plain = listing(db, shop, "Canvas Backpack")
    rich = listing(db, shop, "Canvas Backpack", "A sturdy canvas backpack with padded straps. " * 3, images=4)
    fan = make_user(db, "fan")
    ids = [x["product"]["id"] for x in search(client, fan, "canvas backpack").json()["results"]]
    assert ids == [str(rich.id), str(plain.id)]
    # Quality can't make "umbrella" match a well-photographed backpack.
    assert search(client, fan, "umbrella").json()["results"] == []


def test_waitlisted_shopper_is_notified_when_a_match_is_listed(client, db):
    shop = make_merchant(db)
    fan = make_user(db, "fan")
    assert search(client, fan, "blue denim jacket").json()["status"] == "not_found"
    r = client.post(
        "/merchant/products",
        headers=auth(shop),
        json={"name": "Blue Denim Jacket", "price": "30.00", "description": "Classic", "image_urls": []},
    )
    assert r.status_code == 201, r.text
    note = db.query(Notification).filter_by(user_id=fan.id, type="twin_available").one()
    assert note.target_id is not None and "Blue Denim Jacket" in note.body
    assert db.query(TwinSearch).one().status.value == "available"
    # Told once: a second matching product doesn't ping again.
    client.post("/merchant/products", headers=auth(shop), json={"name": "Denim Jacket Blue", "price": "31.00", "image_urls": []})
    assert db.query(Notification).filter_by(user_id=fan.id, type="twin_available").count() == 1


def test_editing_a_listing_can_satisfy_a_waiting_search(client, db):
    shop = make_merchant(db)
    p = listing(db, shop, "Mystery Item")
    fan = make_user(db, "fan")
    assert search(client, fan, "wooden chess board").json()["status"] == "not_found"
    r = client.patch(f"/merchant/products/{p.id}", headers=auth(shop), json={"name": "Wooden Chess Board"})
    assert r.status_code == 200, r.text
    assert db.query(Notification).filter_by(user_id=fan.id, type="twin_available").count() == 1


def test_sellers_own_twin_on_the_moment_comes_first(client, db):
    shop = make_merchant(db)
    bag = listing(db, shop, "Satchel")
    post = make_post(db, shop, [bag])
    db.add(VideoPostTwin(video_post_id=post.id, product_id=bag.id, label="bag", start_ms=0, end_ms=4000))
    db.commit()
    fan = make_user(db, "fan")
    body = search(client, fan, "brown shoulder thing", video_post_id=str(post.id), start_ms=1000, end_ms=3000, frame_url=FRAME).json()
    assert body["status"] == "matched"
    assert body["results"][0]["product"]["id"] == str(bag.id) and body["results"][0]["source"] == "twin"


def test_clip_validation(client, db):
    shop = make_merchant(db)
    post = make_post(db, shop)
    fan = make_user(db, "fan")
    pid = str(post.id)
    assert search(client, fan, "shoes", video_post_id=pid, start_ms=1000, end_ms=1200).status_code == 422  # too short
    assert search(client, fan, "shoes", video_post_id=pid, start_ms=0, end_ms=60000).status_code == 422  # too long
    assert search(client, fan, "shoes", start_ms=0, end_ms=3000).status_code == 422  # no video
    assert search(client, fan, "shoes", video_post_id=pid, start_ms=0).status_code == 422  # half a clip
    assert search(client, fan, "shoes", frame_url="https://evil.test/x.jpg").status_code == 422
    assert search(client, fan, "x").status_code == 422  # describe it a little


def pick(client, user, post, product, query, start, end, action="buy"):
    sid = search(client, user, query, video_post_id=str(post.id), start_ms=start, end_ms=end).json()["id"]
    r = client.post(f"/twin-search/{sid}/pick", headers=auth(user), json={"product_id": str(product.id), "action": action})
    assert r.status_code == 200, r.text
    return sid


def bought(db, user, product, *, kept=True, claim=False, cancelled=False):
    """An order for `product` by `user`, delivered long enough ago to be past the claim window."""
    from app.models import Order, OrderStatus, ReturnClaim, ReturnClaimStatus

    o = Order(buyer_id=user.id, product_id=product.id, product_name=product.name, price=10, buyer_name="Buyer")
    o.status = OrderStatus.cancelled if cancelled else OrderStatus.delivered
    if kept:
        o.delivered_at = datetime.now(timezone.utc) - timedelta(hours=48)
    elif not cancelled:
        o.delivered_at = datetime.now(timezone.utc) - timedelta(hours=2)  # still inside the claim window
    db.add(o)
    db.commit()
    if claim:
        db.add(ReturnClaim(order_id=o.id, buyer_id=user.id, reason="x", status=ReturnClaimStatus.refunded))
        db.commit()
    return o


def shown(client, post):
    return client.get(f"/video-posts/{post.id}/moment-products").json()


def test_a_cart_add_or_unkept_purchase_is_never_enough(client, db):
    shop = make_merchant(db)
    shoe = listing(db, shop, "Canvas Sneakers", "White")
    post = make_post(db, shop)
    a, b, c = make_user(db, "a"), make_user(db, "b"), make_user(db, "c")
    pick(client, a, post, shoe, "white sneakers", 5000, 8000, action="cart")
    pick(client, b, post, shoe, "sneakers white", 5500, 8500, action="buy")
    pick(client, c, post, shoe, "canvas sneakers", 5200, 8200, action="buy")
    assert db.query(VideoMomentProduct).one().confirmations == 3  # three different shoppers, one link
    assert shown(client, post) == []  # but nobody has bought and kept it: carts and taps prove nothing
    bought(db, b, shoe, kept=False)  # delivered an hour ago: still inside the claim window
    bought(db, c, shoe, cancelled=True)
    assert shown(client, post) == []


def test_two_kept_purchases_by_different_shoppers_earn_trust(client, db):
    shop = make_merchant(db)
    shoe = listing(db, shop, "Canvas Sneakers", "White")
    post = make_post(db, shop)
    a, b, c = make_user(db, "a"), make_user(db, "b"), make_user(db, "c")
    pick(client, a, post, shoe, "white sneakers", 5000, 8000)
    pick(client, b, post, shoe, "sneakers white", 5500, 8500)
    bought(db, a, shoe)
    assert shown(client, post) == []  # one buyer is not enough
    # The same shopper picking again, or buying twice, is still one voice.
    pick(client, a, post, shoe, "white sneakers", 5000, 8000)
    bought(db, a, shoe)
    assert shown(client, post) == []
    bought(db, b, shoe)
    out = shown(client, post)
    assert [(m["source"], m["product"]["id"]) for m in out] == [("crowd", str(shoe.id))]
    assert 0.5 < out[0]["confidence"] < 1.0
    link = db.query(VideoMomentProduct).one()
    assert (link.start_ms, link.end_ms) in {(5000, 8000), (5250, 8250)}  # median of the clips, not the first one

    # A later shopper is shown it - even if their words don't match - when their clip covers the moment.
    body = search(client, c, "those trainers", video_post_id=str(post.id), start_ms=6000, end_ms=7000).json()
    assert body["results"] and body["results"][0]["source"] == "crowd"
    # A clip of some other moment of the same video is not.
    body = search(client, c, "those trainers", video_post_id=str(post.id), start_ms=20000, end_ms=22000).json()
    assert not any(r["source"] == "crowd" for r in body["results"])


def test_a_return_takes_the_trust_back(client, db):
    shop = make_merchant(db)
    shoe = listing(db, shop, "Canvas Sneakers", "White")
    post = make_post(db, shop)
    a, b = make_user(db, "a"), make_user(db, "b")
    for u in (a, b):
        pick(client, u, post, shoe, "white sneakers", 5000, 8000)
        bought(db, u, shoe)
    assert len(shown(client, post)) == 1
    from app.models import Order, ReturnClaim, ReturnClaimStatus

    o = db.query(Order).filter(Order.buyer_id == b.id).one()
    db.add(ReturnClaim(order_id=o.id, buyer_id=b.id, reason="x", status=ReturnClaimStatus.refunded))
    db.commit()
    assert shown(client, post) == []


def test_loose_wide_or_self_interested_picks_dont_count(client, db):
    shop = make_merchant(db)
    shoe = listing(db, shop, "Canvas Sneakers", "White")
    post = make_post(db, shop)
    fan = make_user(db, "fan")
    # Matches only half the words: shown as a result, but too loose to vouch for the moment.
    pick(client, fan, post, shoe, "white sneakers leather strap", 5000, 8000)
    assert db.query(VideoMomentProduct).count() == 0
    # A clip of the whole video says nothing about what is where.
    pick(client, make_user(db, "wide"), post, shoe, "white sneakers", 0, 25000)
    assert db.query(VideoMomentProduct).count() == 0
    # The video's own poster, and the product's own seller, can't vouch.
    pick(client, shop, post, shoe, "white sneakers", 5000, 8000)
    assert db.query(VideoMomentProduct).count() == 0


def test_rival_products_for_one_moment_split_the_support(client, db):
    shop = make_merchant(db)
    red = listing(db, shop, "Red Sneakers")
    blue = listing(db, shop, "Blue Sneakers")
    post = make_post(db, shop)
    users = [make_user(db, n) for n in "abcd"]
    for u in users[:2]:
        pick(client, u, post, red, "red sneakers", 5000, 8000)
        bought(db, u, red)
    for u in users[2:]:
        pick(client, u, post, blue, "blue sneakers", 5000, 8000)
        bought(db, u, blue)
    # Two buyers each: neither holds a majority of the support, so neither is trusted.
    assert shown(client, post) == []


def test_the_poster_can_confirm_or_reject_a_link(client, db):
    shop = make_merchant(db)
    shoe = listing(db, shop, "Canvas Sneakers", "White")
    post = make_post(db, shop)
    fan = make_user(db, "fan")
    pick(client, fan, post, shoe, "white sneakers", 5000, 8000, action="cart")
    cands = client.get(f"/video-posts/{post.id}/moment-candidates", headers=auth(shop)).json()
    assert len(cands) == 1 and cands[0]["shoppers"] == 1 and cands[0]["buyers"] == 0
    assert client.get(f"/video-posts/{post.id}/moment-candidates", headers=auth(fan)).status_code == 403
    lid = cands[0]["link_id"]
    url = f"/video-posts/{post.id}/moment-products/{lid}/review"
    assert client.post(url, headers=auth(fan), json={"decision": "confirm"}).status_code == 403

    assert client.post(url, headers=auth(shop), json={"decision": "confirm"}).status_code == 204
    out = shown(client, post)
    assert out and out[0]["reviewed"] is True and out[0]["confidence"] == 0.95

    assert client.post(url, headers=auth(shop), json={"decision": "reject"}).status_code == 204
    assert shown(client, post) == []
    # Rejected means rejected: more picks don't resurrect it.
    for n in "xy":
        u = make_user(db, n)
        pick(client, u, post, shoe, "white sneakers", 5000, 8000)
        bought(db, u, shoe)
    assert shown(client, post) == []
    assert db.query(VideoMomentProduct).one().confirmations == 1


def test_pick_must_be_a_real_result_and_sellers_cant_vouch_for_themselves(client, db):
    shop = make_merchant(db)
    shoe = listing(db, shop, "Canvas Sneakers")
    other = listing(db, shop, "Garden Hose")
    post = make_post(db, shop)
    fan = make_user(db, "fan")
    sid = search(client, fan, "sneakers", video_post_id=str(post.id), start_ms=1000, end_ms=3000).json()["id"]
    bad = client.post(f"/twin-search/{sid}/pick", headers=auth(fan), json={"product_id": str(other.id), "action": "buy"})
    assert bad.status_code == 400
    assert client.post(f"/twin-search/{sid}/pick", headers=auth(make_user(db, "x")), json={"product_id": str(shoe.id), "action": "buy"}).status_code == 404

    sid2 = search(client, shop, "sneakers", video_post_id=str(post.id), start_ms=1000, end_ms=3000).json()["id"]
    client.post(f"/twin-search/{sid2}/pick", headers=auth(shop), json={"product_id": str(shoe.id), "action": "buy"})
    assert db.query(VideoMomentProduct).count() == 0


def test_my_searches_and_stop_waiting(client, db):
    fan = make_user(db, "fan")
    sid = search(client, fan, "purple unicorn lamp").json()["id"]
    mine = client.get("/twin-search/mine?status=not_found", headers=auth(fan)).json()
    assert [m["id"] for m in mine] == [sid]
    assert client.delete(f"/twin-search/{sid}", headers=auth(fan)).status_code == 204
    assert client.get("/twin-search/mine", headers=auth(fan)).json() == []


def test_keyword_insights_are_a_paid_peek(client, db):
    shop = make_merchant(db)
    for i, who in enumerate(["a", "b", "c"]):
        search(client, make_user(db, who), "green velvet sofa")
    search(client, make_user(db, "d"), "wooden spoon")
    admin_user = make_user(db, "boss")
    from app.models import UserRole

    admin_user.role = UserRole.admin
    db.commit()

    locked = client.get("/merchant/insights/keywords", headers=auth(shop)).json()
    assert locked["locked"] is True and locked["items"][0]["keyword"] == "green sofa velvet"
    assert locked["items"][0]["searchers"] is None

    mid = str(shop.merchant_account.id)
    assert client.post(f"/admin/merchants/{mid}/insights", headers=auth(make_user(db, "nobody")), json={"days": 30}).status_code in (401, 403)
    assert client.post(f"/admin/merchants/{mid}/insights", headers=auth(admin_user), json={"days": 30}).status_code == 200

    full = client.get("/merchant/insights/keywords", headers=auth(shop)).json()
    assert full["locked"] is False
    top = full["items"][0]
    assert (top["keyword"], top["searchers"], top["unmet_searchers"]) == ("green sofa velvet", 3, 3)
    assert client.get("/merchant/insights/keywords", headers=auth(make_user(db, "plain"))).status_code == 404


def test_old_flows_are_gone(client, db):
    shop = make_merchant(db)
    post = make_post(db, shop)
    fan = make_user(db, "fan")
    assert client.post(f"/video-posts/{post.id}/retwin", headers=auth(fan), json={}).status_code in (404, 405)
    assert client.post(f"/video-posts/{post.id}/twin-requests", headers=auth(fan), json={}).status_code == 404
    assert client.get("/twin-requests/inbox", headers=auth(fan)).status_code == 404
    assert client.get("/twin-config").json()["min_twin_ms"] > 0


def test_discovery_search_ranks_better_listings_first(client, db):
    shop = make_merchant(db)
    plain = listing(db, shop, "Aaa Canvas Backpack")  # would win alphabetically
    rich = listing(db, shop, "Zzz Canvas Backpack", "A sturdy canvas backpack with padded straps. " * 3, images=4)
    body = client.get("/search?q=canvas%20backpack&filter=product").json()
    assert [p["id"] for p in body["products"]["items"]] == [str(rich.id), str(plain.id)]


def test_nothing_matched_shows_the_closest_we_have_and_keeps_the_shopper_waiting(client, db):
    shop = make_merchant(db)
    mug = listing(db, shop, "Blue Mug")
    fan = make_user(db, "fan")
    body = search(client, fan, "blue shirt").json()
    assert body["status"] == "not_found" and body["results"] == []
    assert [c["product"]["id"] for c in body["closest"]] == [str(mug.id)]
    assert "notify you" in body["message"]
    # Taking a consolation pick doesn't end the wait or teach the video index anything.
    post = make_post(db, shop)
    sid = search(client, fan, "blue shirt", video_post_id=str(post.id), start_ms=1000, end_ms=3000).json()["id"]
    r = client.post(f"/twin-search/{sid}/pick", headers=auth(fan), json={"product_id": str(mug.id), "action": "buy"})
    assert r.status_code == 200 and r.json()["status"] == "not_found"
    assert db.query(VideoMomentProduct).count() == 0
    # And a real match never carries a closest list.
    assert search(client, fan, "cotton mug").json()["closest"] == []


def test_no_clip_or_frame_goes_to_any_outside_model(client, db, monkeypatch):
    """The describe route is gone, search ignores a frame_url, and nothing makes a network call."""
    import socket

    def no_network(*a, **k):
        raise AssertionError("network used during twin search")

    monkeypatch.setattr(socket.socket, "connect", no_network)
    shop = make_merchant(db)
    bag = listing(db, shop, "Leather Bag")
    fan = make_user(db, "fan")
    assert client.post("/twin-search/describe", headers=auth(fan), json={"frame_url": FRAME}).status_code in (404, 405)
    body = search(client, fan, "leather bag", frame_url=FRAME).json()
    assert [r["product"]["id"] for r in body["results"]] == [str(bag.id)]
    from pathlib import Path

    assert not (Path(__file__).parent.parent / "app" / "twin_vision.py").exists()
