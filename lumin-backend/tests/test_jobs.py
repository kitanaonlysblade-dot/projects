from datetime import datetime, timedelta, timezone

import pytest

from app import jobs
from app.models import Job
from tests.conftest import auth, make_post, make_user


def handlers(calls, fail=None):
    def make(kind):
        def run(payload):
            calls.append((kind, payload["post_id"]))
            if fail and kind in fail:
                raise RuntimeError("boom")
        return run
    return {jobs.OPTIMIZE_VIDEO: make("optimize"), jobs.FINGERPRINT_VIDEO: make("fingerprint")}


def status_of(db, job_id):
    db.expire_all()
    return db.get(Job, job_id)


def test_creating_a_post_queues_optimise_then_fingerprint(client, db):
    user = make_user(db, "shop")
    r = client.post("/video-posts", json={"feed": "discover", "description": "hi", "video_url": "https://cdn.test/v.mp4"}, headers=auth(user))
    assert r.status_code == 201
    rows = db.query(Job).order_by(Job.run_after).all()
    assert [j.kind for j in rows] == [jobs.OPTIMIZE_VIDEO, jobs.FINGERPRINT_VIDEO]
    assert all(j.payload["post_id"] == r.json()["id"] and j.status == "queued" for j in rows)


def test_post_without_video_queues_nothing(client, db):
    user = make_user(db, "shop")
    client.post("/video-posts", json={"feed": "discover", "description": "hi"}, headers=auth(user))
    assert db.query(Job).count() == 0


def test_jobs_run_in_order_and_finish(db):
    post = make_post(db, make_user(db, "a"))
    jobs.enqueue_video(db, post.id)
    db.commit()
    calls = []
    assert jobs.run_one(handlers(calls)) is True
    assert jobs.run_one(handlers(calls)) is True
    assert jobs.run_one(handlers(calls)) is False
    assert [c[0] for c in calls] == ["optimize", "fingerprint"]
    assert {j.status for j in db.query(Job).all()} == {"done"}


def test_a_job_not_due_yet_waits(db):
    post = make_post(db, make_user(db, "a"))
    jobs.enqueue(db, jobs.OPTIMIZE_VIDEO, {"post_id": str(post.id)}, delay_s=3600)
    db.commit()
    calls = []
    assert jobs.run_one(handlers(calls)) is False and calls == []


def test_failures_retry_with_delay_then_stay_failed(db):
    post = make_post(db, make_user(db, "a"))
    job = jobs.enqueue(db, jobs.OPTIMIZE_VIDEO, {"post_id": str(post.id)})
    db.commit()
    job_id = job.id
    calls = []
    h = handlers(calls, fail={"optimize"})
    assert jobs.run_one(h) is True
    j = status_of(db, job_id)
    assert j.status == "queued" and j.attempts == 1 and "boom" in j.error
    assert j.run_after > datetime.now(timezone.utc)  # backed off
    assert jobs.run_one(h) is False  # not due
    for attempt in (2, 3):
        j.run_after = datetime.now(timezone.utc) - timedelta(seconds=1)
        db.commit()
        assert jobs.run_one(h) is True
        j = status_of(db, job_id)
    assert j.status == "failed" and j.attempts == 3 and j.finished_at is not None
    assert jobs.run_one(h) is False


def test_a_dead_workers_job_is_picked_up_again(db):
    post = make_post(db, make_user(db, "a"))
    job = jobs.enqueue(db, jobs.OPTIMIZE_VIDEO, {"post_id": str(post.id)})
    job.status = "running"
    job.locked_at = datetime.now(timezone.utc) - jobs.STALE_AFTER - timedelta(minutes=1)
    db.commit()
    job_id = job.id
    calls = []
    assert jobs.run_one(handlers(calls)) is True
    assert calls and status_of(db, job_id).status == "done"


def test_a_job_being_worked_on_is_left_alone(db):
    post = make_post(db, make_user(db, "a"))
    job = jobs.enqueue(db, jobs.OPTIMIZE_VIDEO, {"post_id": str(post.id)})
    job.status = "running"
    job.locked_at = datetime.now(timezone.utc)
    db.commit()
    assert jobs.run_one(handlers([])) is False


def test_unknown_kind_fails_cleanly(db):
    job = jobs.enqueue(db, "nope", {"post_id": "x"})
    db.commit()
    job_id = job.id
    jobs.run_one(handlers([]))
    assert "no handler" in status_of(db, job_id).error


def test_old_done_jobs_are_purged(db):
    old = jobs.enqueue(db, jobs.OPTIMIZE_VIDEO, {"post_id": "x"})
    old.status, old.finished_at = "done", datetime.now(timezone.utc) - jobs.KEEP_DONE - timedelta(days=1)
    fresh = jobs.enqueue(db, jobs.OPTIMIZE_VIDEO, {"post_id": "y"})
    fresh.status, fresh.finished_at = "done", datetime.now(timezone.utc)
    db.commit()
    assert jobs.purge_old(db) == 1
    assert db.query(Job).count() == 1


def test_admin_can_see_the_queue(client, db):
    from app.models import UserRole

    admin = make_user(db, "boss")
    admin.role = UserRole.admin
    db.commit()
    jobs.enqueue(db, jobs.OPTIMIZE_VIDEO, {"post_id": "x"})
    j = jobs.enqueue(db, jobs.OPTIMIZE_VIDEO, {"post_id": "y"})
    j.status, j.error, j.finished_at = "failed", "bad", datetime.now(timezone.utc)
    db.commit()
    body = client.get("/admin/jobs", headers=auth(admin)).json()
    assert body["counts"]["queued"] == 1 and body["counts"]["failed"] == 1
    assert body["recent_failures"][0]["error"] == "bad"
    assert client.get("/admin/jobs", headers=auth(make_user(db, "fan"))).status_code == 403


def test_web_thread_can_be_switched_off(monkeypatch):
    monkeypatch.setenv("RUN_JOBS_IN_WEB", "false")
    assert jobs.start_in_web() is None
