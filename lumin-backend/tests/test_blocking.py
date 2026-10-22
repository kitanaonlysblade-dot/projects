"""Blocking: both sides stop seeing each other's content; blocking ends follows; admins are exempt."""
from app.models import UserRole
from tests.conftest import auth, make_post, make_product, make_user


def _ids(resp):
    assert resp.status_code == 200, resp.text
    return {p["id"] for p in resp.json()}


def test_block_hides_posts_both_ways(client, db):
    me, other, third = make_user(db, "me"), make_user(db, "other"), make_user(db, "third")
    mine, theirs, thirds = make_post(db, me), make_post(db, other), make_post(db, third)
    feed = lambda who: _ids(client.get("/video-posts?feed=shop", headers=auth(who)))

    assert {str(mine.id), str(theirs.id), str(thirds.id)} <= feed(me)
    assert client.post(f"/users/{other.id}/block", headers=auth(me)).status_code == 204

    seen_by_me, seen_by_other = feed(me), feed(other)
    assert str(theirs.id) not in seen_by_me and str(mine.id) in seen_by_me and str(thirds.id) in seen_by_me
    assert str(mine.id) not in seen_by_other and str(theirs.id) in seen_by_other  # hidden the other way too
    # a signed-out visitor still sees everything
    assert {str(mine.id), str(theirs.id)} <= _ids(client.get("/video-posts?feed=shop"))


def test_unblock_restores_everything(client, db):
    me, other = make_user(db, "me"), make_user(db, "other")
    theirs = make_post(db, other)
    client.post(f"/users/{other.id}/block", headers=auth(me))
    assert client.delete(f"/users/{other.id}/block", headers=auth(me)).status_code == 204
    assert str(theirs.id) in _ids(client.get("/video-posts?feed=shop", headers=auth(me)))
    assert client.delete(f"/users/{other.id}/block", headers=auth(me)).status_code == 204  # repeating is fine


def test_block_is_repeatable_and_listed(client, db):
    me, other = make_user(db, "me"), make_user(db, "other")
    for _ in range(2):
        assert client.post(f"/users/{other.id}/block", headers=auth(me)).status_code == 204
    listed = client.get("/users/me/blocks", headers=auth(me)).json()
    assert [u["id"] for u in listed] == [str(other.id)]
    assert client.get("/users/me/blocks", headers=auth(other)).json() == []  # the blocked person does not see it


def test_cannot_block_yourself_or_an_admin_or_nobody(client, db):
    import uuid
    me, admin = make_user(db, "me"), make_user(db, "adm")
    admin.role = UserRole.admin
    db.commit()
    assert client.post(f"/users/{me.id}/block", headers=auth(me)).status_code == 400
    assert client.post(f"/users/{admin.id}/block", headers=auth(me)).status_code == 400
    assert client.post(f"/users/{uuid.uuid4()}/block", headers=auth(me)).status_code == 404
    assert client.post(f"/users/{me.id}/block").status_code in (401, 403)


def test_blocking_ends_follows_and_stops_new_ones(client, db):
    me, other = make_user(db, "me"), make_user(db, "other")
    assert client.post(f"/users/{other.id}/follow", headers=auth(me)).status_code == 204
    assert client.post(f"/users/{me.id}/follow", headers=auth(other)).status_code == 204
    client.post(f"/users/{other.id}/block", headers=auth(me))
    assert client.get(f"/users/{other.id}/follow", headers=auth(me)).json() is False
    assert client.get(f"/users/{me.id}/follow", headers=auth(other)).json() is False
    assert client.post(f"/users/{me.id}/follow", headers=auth(other)).status_code == 403
    assert client.post(f"/users/{other.id}/follow", headers=auth(me)).status_code == 403


def test_blocked_accounts_vanish_from_profiles_and_search(client, db):
    me, other = make_user(db, "me"), make_user(db, "other")
    other.username, other.display_name = "zebraperson", "Zebra Person"
    db.commit()
    assert client.get(f"/users/{other.id}", headers=auth(me)).status_code == 200
    client.post(f"/users/{other.id}/block", headers=auth(me))
    assert client.get(f"/users/{other.id}", headers=auth(me)).status_code == 404
    assert client.get(f"/users/{me.id}", headers=auth(other)).status_code == 404
    found = client.get("/search?q=zebra&filter=people", headers=auth(me)).json()
    assert all(p["id"] != str(other.id) for p in (found.get("people") or {}).get("items", []))
    assert client.get(f"/users/{other.id}").status_code == 200  # signed out: unaffected


def test_blocked_sellers_products_are_hidden(client, db):
    from app.models import MerchantAccount

    me, seller = make_user(db, "me"), make_user(db, "seller")
    merchant = MerchantAccount(user_id=seller.id, business_name="Shop", category="Fashion", description="")
    db.add(merchant)
    db.commit()
    product = make_product(db, merchant_id=merchant.id)
    names = lambda who: {p["id"] for p in client.get("/search?q=Widget&filter=product", headers=auth(who)).json()["products"]["items"]}
    assert str(product.id) in names(me)
    client.post(f"/users/{seller.id}/block", headers=auth(me))
    assert str(product.id) not in names(me)
    assert str(product.id) in names(seller)  # the seller still sees their own listing


def test_a_blocked_posters_single_video_looks_missing(client, db):
    me, other = make_user(db, "me"), make_user(db, "other")
    post = make_post(db, other)
    client.post(f"/users/{other.id}/block", headers=auth(me))
    assert client.get(f"/video-posts/{post.id}", headers=auth(me)).status_code == 404
    assert client.get(f"/video-posts/{post.id}").status_code == 200


def test_admins_still_see_everything(client, db):
    admin, other = make_user(db, "adm"), make_user(db, "other")
    admin.role = UserRole.admin
    db.commit()
    post = make_post(db, other)
    db.add(__import__("app.models", fromlist=["UserBlock"]).UserBlock(blocker_id=admin.id, blocked_id=other.id))
    db.commit()
    assert str(post.id) in _ids(client.get("/video-posts?feed=shop", headers=auth(admin)))
