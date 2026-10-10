"""Closing the supply loop: sellers see requests they can answer; creators hear about offers."""
from app.models import Notification
from tests.conftest import auth, make_user
from tests.test_twin_search import listing
from tests.test_twins import make_merchant
from tests.test_wanted_twins import moment, twin_it


def offered(db, user):
    return db.query(Notification).filter_by(user_id=user.id, type="twin_offered").all()


def test_the_creator_is_told_once_per_video_until_they_look(client, db):
    poster, s1, s2 = make_merchant(db, "poster"), make_merchant(db, "s1"), make_merchant(db, "s2")
    post, _, rid = moment(client, db, poster)
    a = listing(db, s1, "Mini Leather Bag", "Soft", ["Red"], images=1)
    b = listing(db, s2, "Red Leather Satchel", "Roomy", ["Red"], images=1)

    assert twin_it(client, s1, rid, a).status_code == 200
    (note,) = offered(db, poster)
    assert str(note.target_id) == str(post.id) and "Mini Leather Bag" in note.body and note.read is False

    assert twin_it(client, s2, rid, b).status_code == 200
    assert len(offered(db, poster)) == 1  # a second offer joins the inbox without another ping

    note.read = True
    db.commit()
    c = listing(db, s1, "Red Leather Tote", "Big", ["Red"], images=1)
    assert twin_it(client, s1, rid, c).status_code == 200
    assert len(offered(db, poster)) == 2  # they looked, so the next offer is news again


def test_the_creators_own_twin_does_not_notify_them(client, db):
    poster, other = make_merchant(db, "poster"), make_merchant(db, "other")
    _, _, rid = moment(client, db, poster)
    mine = listing(db, poster, "Red Leather Shoulder Bag", "Mine", ["Red"], images=1)
    assert twin_it(client, poster, rid, mine).status_code == 200
    assert offered(db, poster) == []


def test_sellers_see_open_requests_their_products_already_fit(client, db):
    poster, seller, hose = make_merchant(db, "poster"), make_merchant(db, "seller"), make_merchant(db, "hose")
    _, _, rid = moment(client, db, poster)
    mini = listing(db, seller, "Mini Leather Bag", "Soft", ["Red"], images=1)
    listing(db, hose, "Garden Hose")

    r = client.get("/wanted/leads", headers=auth(seller))
    assert r.status_code == 200, r.text
    (lead,) = r.json()
    assert lead["request"]["id"] == rid and lead["request"]["count"] == 2
    assert lead["product"]["id"] == str(mini.id) and lead["match"] in ("good", "strong")

    assert client.get("/wanted/leads", headers=auth(hose)).json() == []  # nothing of theirs fits
    assert client.get("/wanted/leads", headers=auth(make_user(db, "shopper"))).status_code == 403
    assert client.get("/wanted/leads").status_code in (401, 403)

    assert twin_it(client, seller, rid, mini).status_code == 200
    assert client.get("/wanted/leads", headers=auth(seller)).json() == []  # answered, so no longer a lead
