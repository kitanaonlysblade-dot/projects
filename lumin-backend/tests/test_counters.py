"""Every number on screen is exact: likes, comments, shares, saves, views, "bought & in carts"."""
from concurrent.futures import ThreadPoolExecutor

from app import counters
from app.auth.security import hash_password
from app.models import Order, OrderStatus, Product, VideoPost
from app.models.video import Comment
from tests.conftest import auth, make_post, make_product, make_user


def fresh(db, model, row_id):
    db.expire_all()
    return db.get(model, row_id)


def test_like_counts_once_and_unlike_undoes_it(client, db):
    owner, fan = make_user(db, "owner"), make_user(db, "fan")
    post = make_post(db, owner)
    for _ in range(3):  # a double tap, a retry, ...
        assert client.post(f"/video-posts/{post.id}/like", headers=auth(fan)).status_code == 204
    assert fresh(db, VideoPost, post.id).likes_count == 1
    for _ in range(2):
        client.delete(f"/video-posts/{post.id}/like", headers=auth(fan))
    assert fresh(db, VideoPost, post.id).likes_count == 0


def test_many_people_liking_at_the_same_moment_are_all_counted(client, db):
    post = make_post(db, make_user(db, "owner"))
    fans = [make_user(db, f"fan{i}") for i in range(12)]
    with ThreadPoolExecutor(max_workers=12) as pool:
        codes = list(pool.map(lambda u: client.post(f"/video-posts/{post.id}/like", headers=auth(u)).status_code, fans))
    assert set(codes) == {204}
    assert fresh(db, VideoPost, post.id).likes_count == 12


def test_save_and_share_counts_follow_the_rows(client, db):
    post = make_post(db, make_user(db, "owner"))
    a, b = make_user(db, "a"), make_user(db, "b")
    for u in (a, b):
        client.post(f"/video-posts/{post.id}/watchlist", headers=auth(u))
        client.post(f"/video-posts/{post.id}/watchlist", headers=auth(u))  # repeat: still one
        client.post(f"/video-posts/{post.id}/share", headers=auth(u))
    p = fresh(db, VideoPost, post.id)
    assert (p.saves_count, p.shares_count) == (2, 2)
    client.delete(f"/video-posts/{post.id}/watchlist", headers=auth(a))
    client.delete(f"/video-posts/{post.id}/watchlist", headers=auth(a))
    client.delete(f"/video-posts/{post.id}/share", headers=auth(a))
    p = fresh(db, VideoPost, post.id)
    assert (p.saves_count, p.shares_count) == (1, 1)


def test_comment_and_reply_counts_including_deleting_a_thread(client, db):
    owner, a, b = make_user(db, "owner"), make_user(db, "a"), make_user(db, "b")
    post = make_post(db, owner)
    top = client.post(f"/video-posts/{post.id}/comments", json={"text": "nice"}, headers=auth(a)).json()
    client.post(f"/video-posts/{post.id}/comments", json={"text": "agree", "parent_id": top["id"]}, headers=auth(b))
    client.post(f"/video-posts/{post.id}/comments", json={"text": "me too", "parent_id": top["id"]}, headers=auth(owner))
    assert fresh(db, VideoPost, post.id).comments_count == 3
    assert fresh(db, Comment, top["id"]).replies_count == 2
    assert client.delete(f"/video-posts/comments/{top['id']}", headers=auth(a)).status_code == 204
    assert fresh(db, VideoPost, post.id).comments_count == 0


def test_comment_reactions_count_once_per_person(client, db):
    owner, a = make_user(db, "owner"), make_user(db, "a")
    post = make_post(db, owner)
    c = client.post(f"/video-posts/{post.id}/comments", json={"text": "hi"}, headers=auth(owner)).json()
    url = f"/video-posts/comments/{c['id']}/reaction"
    client.put(url, json={"reaction": "like"}, headers=auth(a))
    client.put(url, json={"reaction": "love"}, headers=auth(a))  # changing it is not a second reaction
    assert fresh(db, Comment, c["id"]).likes_count == 1
    client.delete(url, headers=auth(a))
    client.delete(url, headers=auth(a))
    assert fresh(db, Comment, c["id"]).likes_count == 0


def test_bought_and_in_carts_follows_carts_and_orders(client, db):
    product = make_product(db, stock=10)
    a, b = make_user(db, "a"), make_user(db, "b")
    r = client.post("/cart", json={"product_id": str(product.id), "quantity": 2}, headers=auth(a))
    assert r.status_code == 201
    client.post("/cart", json={"product_id": str(product.id), "quantity": 1}, headers=auth(b))
    assert fresh(db, Product, product.id).cart_count == 3
    item = r.json()["id"]
    client.patch(f"/cart/{item}", json={"quantity": 1}, headers=auth(a))
    assert fresh(db, Product, product.id).cart_count == 2
    client.delete(f"/cart/{item}", headers=auth(a))
    assert fresh(db, Product, product.id).cart_count == 1
    # an order counts as "bought" until it is cancelled
    order = Order(buyer_id=b.id, product_id=product.id, product_name="Widget", price=10, buyer_name="B")
    db.add(order)
    db.commit()
    assert fresh(db, Product, product.id).cart_count == 2
    order = db.get(Order, order.id)
    order.status = OrderStatus.cancelled
    db.commit()
    assert fresh(db, Product, product.id).cart_count == 1


def test_funnel_counters_are_exact_under_parallel_taps(client, db):
    product = make_product(db)
    post = make_post(db, make_user(db, "owner"), products=[product])
    with ThreadPoolExecutor(max_workers=10) as pool:
        list(pool.map(lambda _: client.post(f"/video-posts/{post.id}/product-tap", json={"product_id": str(product.id)}), range(20)))
    assert fresh(db, VideoPost, post.id).product_taps_count == 20


def test_check_finds_a_wrong_number_and_reconcile_fixes_it(client, db):
    owner, fan = make_user(db, "owner"), make_user(db, "fan")
    post = make_post(db, owner)
    product = make_product(db)
    client.post(f"/video-posts/{post.id}/like", headers=auth(fan))
    client.post(f"/video-posts/{post.id}/watchlist", headers=auth(fan))
    post = db.get(VideoPost, post.id)
    post.likes_count, post.saves_count, post.views_count = 99, 7, 5  # as if an old bug or a cascade left drift
    db.get(Product, product.id).cart_count = 2400  # an invented number, as in the demo data
    db.commit()

    report = counters.reconcile(db, fix=False)
    assert counters.total_wrong(report) == 4
    assert fresh(db, VideoPost, post.id).likes_count == 99  # a check changes nothing

    counters.reconcile(db, fix=True)
    p = fresh(db, VideoPost, post.id)
    assert (p.likes_count, p.saves_count, p.views_count) == (1, 1, 0)
    assert fresh(db, Product, product.id).cart_count == 0
    assert counters.total_wrong(counters.reconcile(db, fix=False)) == 0


def test_admin_can_check_and_reconcile(client, db):
    from app.models import UserRole

    admin = make_user(db, "admin")
    admin.role = UserRole.admin
    post = make_post(db, make_user(db, "owner"))
    db.get(VideoPost, post.id).likes_count = 5
    db.commit()
    got = client.get("/admin/counters/check", headers=auth(admin)).json()
    assert got["wrong_total"] == 1
    assert client.post("/admin/counters/reconcile", headers=auth(admin)).json()["corrected_total"] == 1
    assert client.get("/admin/counters/check", headers=auth(admin)).json()["wrong_total"] == 0


def test_deleting_an_account_takes_its_likes_comments_and_saves_off_the_counts(client, db):
    owner, leaver, stay = make_user(db, "owner"), make_user(db, "leaver"), make_user(db, "stay")
    leaver.hashed_password = hash_password("pw-123456")
    db.commit()
    post = make_post(db, owner)
    for u in (leaver, stay):
        client.post(f"/video-posts/{post.id}/like", headers=auth(u))
        client.post(f"/video-posts/{post.id}/watchlist", headers=auth(u))
        client.post(f"/video-posts/{post.id}/comments", json={"text": "hi"}, headers=auth(u))
    assert fresh(db, VideoPost, post.id).likes_count == 2
    r = client.post("/users/me/delete", headers=auth(leaver), json={"confirm": "DELETE", "password": "pw-123456"})
    assert r.status_code == 204
    p = fresh(db, VideoPost, post.id)
    assert (p.likes_count, p.saves_count, p.comments_count) == (1, 1, 1)
