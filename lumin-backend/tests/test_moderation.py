import pytest

from app import image_safety, jobs, screening
from app.models import Job, ModerationItem, ModerationTerm, Notification, User, UserRole, VideoPost
from app.models.moderation import ReportReason, ReportTargetType
from tests.conftest import auth, make_post, make_user


@pytest.fixture(autouse=True)
def _fresh_terms():
    screening.reset_terms_cache()
    yield
    screening.reset_terms_cache()


def term(db, text, action="block"):
    db.add(ModerationTerm(term=screening.normalize_term(text), action=action))
    db.commit()
    screening.reset_terms_cache()


def admin(db):
    a = make_user(db, "boss")
    a.role = UserRole.admin
    db.commit()
    return a


def scores(monkeypatch, **s):
    monkeypatch.setattr(screening, "_image_scores", lambda provider, urls, video_url=None: [s])


class Fake(image_safety.Provider):
    def score(self, jpeg):  # never used: _image_scores is patched
        return {}


def run_check(post_id, kind="video_post"):
    screening.moderate_media({"target_type": kind, "target_id": str(post_id)}, provider=Fake())


def new_post(client, user, text="hello"):
    return client.post("/video-posts", headers=auth(user), json={"feed": "discover", "description": text, "video_url": "https://cdn.test/v.mp4"})


# ---------------------------------------------------------------- word filter
def test_a_blocked_word_refuses_a_caption_and_nothing_is_saved(client, db):
    term(db, "badword")
    u = make_user(db)
    r = new_post(client, u, "this is a BADWORD here")
    assert r.status_code == 400 and "isn't allowed" in r.json()["detail"]
    assert db.query(VideoPost).count() == 0


def test_disguised_and_stretched_spellings_match_but_innocent_words_do_not(client, db):
    term(db, "ass")
    u = make_user(db)
    assert new_post(client, u, "what an a$$").status_code == 400
    assert new_post(client, u, "my class assignment passed").status_code == 201  # contains "ass", is not the word


def test_a_flag_word_lets_it_through_and_queues_it(client, db):
    term(db, "iffy", "flag")
    u = make_user(db)
    r = new_post(client, u, "a bit iffy")
    assert r.status_code == 201
    item = db.query(ModerationItem).one()
    assert (item.target_type, item.source, item.status) == ("video_post", "text", "pending")
    assert str(item.target_id) == r.json()["id"]


def test_comments_and_profile_text_are_filtered_too(client, db):
    term(db, "badword")
    term(db, "iffy", "flag")
    u = make_user(db)
    post = make_post(db, make_user(db, "other"))
    assert client.post(f"/video-posts/{post.id}/comments", headers=auth(u), json={"text": "badword"}).status_code == 400
    assert client.post(f"/video-posts/{post.id}/comments", headers=auth(u), json={"text": "iffy one"}).status_code == 201
    assert db.query(ModerationItem).filter(ModerationItem.target_type == "comment").count() == 1
    assert client.patch("/users/me", headers=auth(u), json={"bio": "I love badword"}).status_code == 400
    assert client.patch("/users/me", headers=auth(u), json={"bio": "so iffy"}).status_code == 200
    assert db.query(ModerationItem).filter(ModerationItem.target_type == "user").count() == 1


def test_signup_refuses_a_blocked_username(client, db):
    term(db, "badword")
    r = client.post("/auth/signup", json={"email": "n@t.test", "password": "correct horse 9", "username": "badword", "display_name": "N"})
    assert r.status_code == 400


# ---------------------------------------------------------------- picture checks
def test_a_clear_hit_hides_the_video_from_everyone_but_its_owner_and_admins(client, db, monkeypatch):
    owner, other = make_user(db, "owner"), make_user(db, "other")
    boss = admin(db)
    post = make_post(db, owner)
    scores(monkeypatch, sexual=0.95)
    run_check(post.id)
    db.expire_all()
    assert db.get(VideoPost, post.id).moderation_hold is True
    item = db.query(ModerationItem).one()
    assert (item.severity, item.category, item.source) == ("held", "sexual", "media")
    assert db.query(Notification).filter(Notification.user_id == owner.id).count() == 1

    def ids(headers):
        return [p["id"] for p in client.get("/video-posts?feed=shop", headers=headers).json()]

    assert str(post.id) not in ids(auth(other))
    assert str(post.id) in ids(auth(owner))
    assert str(post.id) in ids(auth(boss))
    assert str(post.id) not in [p["id"] for p in client.get("/video-posts?feed=shop").json()]
    assert client.get(f"/video-posts/{post.id}", headers=auth(other)).status_code == 404
    assert client.get(f"/video-posts/{post.id}", headers=auth(owner)).status_code == 200
    assert client.post(f"/video-posts/{post.id}/comments", headers=auth(other), json={"text": "hi"}).status_code == 404


def test_a_repost_of_a_held_video_is_hidden_too(client, db, monkeypatch):
    owner, other = make_user(db, "owner"), make_user(db, "other")
    post = make_post(db, owner)
    repost = make_post(db, make_user(db, "sharer"), repost_of=post)
    scores(monkeypatch, sexual=0.95)
    run_check(post.id)
    ids = [p["id"] for p in client.get("/video-posts?feed=shop", headers=auth(other)).json()]
    assert str(repost.id) not in ids


def test_a_borderline_hit_stays_visible_but_is_queued(client, db, monkeypatch):
    owner = make_user(db, "owner")
    post = make_post(db, owner)
    scores(monkeypatch, sexual=0.6)
    run_check(post.id)
    db.expire_all()
    assert db.get(VideoPost, post.id).moderation_hold is False
    assert db.query(ModerationItem).one().severity == "review"


def test_clean_pictures_flag_nothing(client, db, monkeypatch):
    post = make_post(db, make_user(db))
    scores(monkeypatch, sexual=0.01, violence=0.02)
    run_check(post.id)
    assert db.query(ModerationItem).count() == 0


def test_plain_violence_never_holds_by_itself(client, db, monkeypatch):
    post = make_post(db, make_user(db))
    scores(monkeypatch, violence=0.99)
    run_check(post.id)
    db.expire_all()
    assert db.get(VideoPost, post.id).moderation_hold is False
    assert db.query(ModerationItem).one().severity == "review"


def test_a_clear_hit_on_an_avatar_removes_it(client, db, monkeypatch):
    u = make_user(db)
    u.avatar_url = "https://cdn.test/me.jpg"
    db.commit()
    scores(monkeypatch, sexual=0.97)
    run_check(u.id, "user")
    db.expire_all()
    assert db.get(User, u.id).avatar_url is None
    assert db.query(ModerationItem).one().target_type == "user"


def test_no_picture_check_is_queued_without_a_provider(client, db, monkeypatch):
    monkeypatch.delenv("MODERATION_PROVIDER", raising=False)
    u = make_user(db)
    assert new_post(client, u).status_code == 201
    assert db.query(Job).filter(Job.kind == screening.MODERATE_MEDIA).count() == 0


def test_a_picture_check_is_queued_when_a_provider_is_set(client, db, monkeypatch):
    monkeypatch.setenv("MODERATION_PROVIDER", "openai")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    u = make_user(db)
    assert new_post(client, u).status_code == 201
    assert db.query(Job).filter(Job.kind == screening.MODERATE_MEDIA).count() == 1


def test_the_job_runner_knows_the_moderation_job(db):
    j = jobs.enqueue(db, screening.MODERATE_MEDIA, {"target_type": "video_post", "target_id": "00000000-0000-0000-0000-000000000000"})
    db.commit()
    seen = []
    assert jobs.run_one({screening.MODERATE_MEDIA: lambda p: seen.append(p)}) is True
    assert seen and j.kind == screening.MODERATE_MEDIA


# ---------------------------------------------------------------- reports
def report(client, user, post):
    return client.post("/reports", headers=auth(user), json={"target_type": "video_post", "target_id": str(post.id), "reason": "inappropriate"})


def test_three_different_reporters_hold_a_video(client, db):
    post = make_post(db, make_user(db, "owner"))
    for i in range(2):
        assert report(client, make_user(db, f"r{i}"), post).status_code == 201
    db.expire_all()
    assert db.get(VideoPost, post.id).moderation_hold is False
    assert report(client, make_user(db, "r3"), post).status_code == 201
    db.expire_all()
    assert db.get(VideoPost, post.id).moderation_hold is True
    assert db.query(ModerationItem).one().source == "reports"


def test_one_person_reporting_three_times_does_not_hold_it(client, db):
    post = make_post(db, make_user(db, "owner"))
    r = make_user(db, "r")
    for _ in range(3):
        report(client, r, post)
    db.expire_all()
    assert db.get(VideoPost, post.id).moderation_hold is False


# ---------------------------------------------------------------- the review queue
def held_video(client, db, monkeypatch):
    owner = make_user(db, "owner")
    post = make_post(db, owner)
    scores(monkeypatch, sexual=0.95)
    run_check(post.id)
    return owner, post, db.query(ModerationItem).one()


def test_only_admins_can_use_the_queue(client, db):
    u = make_user(db)
    assert client.get("/admin/moderation/items", headers=auth(u)).status_code == 403
    assert client.get("/admin/moderation/items").status_code == 401


def test_approving_restores_the_video_and_it_is_not_flagged_again(client, db, monkeypatch):
    owner, post, item = held_video(client, db, monkeypatch)
    boss = admin(db)
    listed = client.get("/admin/moderation/items", headers=auth(boss)).json()
    assert listed[0]["id"] == str(item.id) and listed[0]["preview"]["video_url"] and listed[0]["owner_username"] == owner.username
    assert client.post(f"/admin/moderation/items/{item.id}/approve", headers=auth(boss), json={}).status_code == 200
    db.expire_all()
    assert db.get(VideoPost, post.id).moderation_hold is False
    assert client.post(f"/admin/moderation/items/{item.id}/approve", headers=auth(boss), json={}).status_code == 400  # decided already
    run_check(post.id)  # same content again
    db.expire_all()
    assert db.get(VideoPost, post.id).moderation_hold is False
    assert db.query(ModerationItem).filter(ModerationItem.status == "pending").count() == 0


def test_removing_deletes_the_video_and_tells_the_owner(client, db, monkeypatch):
    owner, post, item = held_video(client, db, monkeypatch)
    boss = admin(db)
    r = client.post(f"/admin/moderation/items/{item.id}/remove", headers=auth(boss), json={"note": "nudity"})
    assert r.status_code == 200 and r.json()["status"] == "removed"
    db.expire_all()
    assert db.get(VideoPost, post.id) is None
    texts = [n.body for n in db.query(Notification).filter(Notification.user_id == owner.id)]
    assert any("was removed" in t and "nudity" in t for t in texts)
    again = client.get("/admin/moderation/items?status=removed", headers=auth(boss)).json()
    assert again[0]["owner_removed_count"] == 1


def test_removing_a_flagged_comment_fixes_the_counts(client, db):
    term(db, "iffy", "flag")
    owner = make_user(db, "owner")
    post = make_post(db, owner)
    c = make_user(db, "c")
    cid = client.post(f"/video-posts/{post.id}/comments", headers=auth(c), json={"text": "iffy"}).json()["id"]
    boss = admin(db)
    item = db.query(ModerationItem).one()
    assert client.post(f"/admin/moderation/items/{item.id}/remove", headers=auth(boss), json={}).status_code == 200
    db.expire_all()
    assert db.get(VideoPost, post.id).comments_count == 0
    assert client.get(f"/video-posts/{post.id}/comments").json() == []
    assert cid


def test_a_removed_bio_is_cleared(client, db):
    term(db, "iffy", "flag")
    u = make_user(db)
    client.patch("/users/me", headers=auth(u), json={"bio": "so iffy"})
    boss = admin(db)
    item = db.query(ModerationItem).one()
    client.post(f"/admin/moderation/items/{item.id}/remove", headers=auth(boss), json={})
    db.expire_all()
    assert db.get(User, u.id).bio == ""


def test_summary_counts(client, db, monkeypatch):
    held_video(client, db, monkeypatch)
    boss = admin(db)
    s = client.get("/admin/moderation/summary", headers=auth(boss)).json()
    assert s["pending"] == 1 and s["pending_held"] == 1 and s["picture_checks_on"] in (True, False)


def test_managing_the_word_list(client, db):
    boss = admin(db)
    r = client.post("/admin/moderation/terms", headers=auth(boss), json={"term": "  B@D  Word ", "action": "block"})
    assert r.status_code == 201 and r.json()["term"] == "bad word"
    # takes effect straight away
    assert new_post(client, make_user(db), "such a bad word").status_code == 400
    tid = r.json()["id"]
    assert client.delete(f"/admin/moderation/terms/{tid}", headers=auth(boss)).status_code == 204
    assert new_post(client, make_user(db, "x"), "such a bad word").status_code == 201
    assert client.post("/admin/moderation/terms", headers=auth(boss), json={"term": "x", "action": "nope"}).status_code == 422
