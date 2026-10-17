"""Scan endpoints and the duplicate flag. The video decoding is replaced by hand-made fingerprints (the matcher itself is
covered in test_scan_matcher.py), so these run without ffmpeg."""
import io

import numpy as np
import pytest

from app import scan_fp, scan_service
from app.models import UserRole, VideoFingerprint, VideoMatchFlag, VideoScan
from tests.conftest import auth, make_post, make_product, make_user


def _features(seed: int, n: int = 20) -> "scan_fp.VideoFeatures":
    rng = np.random.default_rng(seed)
    return scan_fp.VideoFeatures(
        duration=n / 2,
        a_hash=np.zeros(0, np.int64), a_t=np.zeros(0, np.int32),
        f_hash=rng.integers(0, 256, (n, 8), dtype=np.uint8),
        f_cell=rng.integers(0, 256, (n, scan_fp.GRID ** 2, 2), dtype=np.uint8),
        f_ok=np.ones((n, scan_fp.GRID ** 2), bool),
        f_t=np.arange(n, dtype=np.float32) / 2,
        orb=[],
    )


def _store(db, post, features):
    db.add(VideoFingerprint(video_post_id=post.id, video_url=post.video_url, version=scan_fp.FP_VERSION,
                            status="ok", duration_s=features.duration, data=scan_fp.pack(features)))
    db.commit()
    scan_service.forget_cache()


@pytest.fixture(autouse=True)
def _fake_decoding(monkeypatch):
    """A 'recording' uploaded in these tests is whatever fingerprints the test says it is."""
    state = {"query": None, "seconds": 5.0}
    monkeypatch.setattr(scan_fp, "clip_seconds", lambda path: state["seconds"])
    monkeypatch.setattr(scan_fp, "extract_query", lambda path: scan_fp.query_from_video(state["query"]))
    scan_service.forget_cache()
    yield state
    scan_service.forget_cache()


def _scan(client, headers=None):
    return client.post("/scan/match", files={"clip": ("rec.mp4", io.BytesIO(b"not really a video"), "video/mp4")}, headers=headers or {})


def test_finds_the_matching_video(client, db, _fake_decoding):
    seller = make_user(db, "seller")
    post = make_post(db, seller, [make_product(db)])
    other = make_post(db, seller, [make_product(db)])
    _store(db, post, _features(1))
    _store(db, other, _features(2))
    _fake_decoding["query"] = _features(1)
    body = _scan(client).json()
    assert body["found"] is True and body["video_post_id"] == str(post.id)
    assert body["disputed"] is False


def test_unknown_video_is_not_found_and_never_guesses(client, db, _fake_decoding):
    seller = make_user(db, "seller")
    _store(db, make_post(db, seller, [make_product(db)]), _features(1))
    _fake_decoding["query"] = _features(999)
    body = _scan(client).json()
    assert body["found"] is False and body["video_post_id"] is None and "never guess" in body["message"]


def test_short_recording_not_found_suggests_recording_longer(client, db, _fake_decoding):
    _fake_decoding["query"], _fake_decoding["seconds"] = _features(5, n=6), 3.0  # a 3-second recording
    assert "6-8 seconds" in _scan(client).json()["message"]


def test_recording_length_limits(client, _fake_decoding):
    _fake_decoding["query"] = _features(1)
    _fake_decoding["seconds"] = 0.5
    assert _scan(client).status_code == 400
    _fake_decoding["seconds"] = 600
    assert _scan(client).status_code == 400
    _fake_decoding["seconds"] = None
    assert _scan(client).status_code == 400


def test_video_without_products_is_not_searchable(client, db, _fake_decoding):
    seller = make_user(db, "seller")
    post = make_post(db, seller, [])
    _store(db, post, _features(1))
    _fake_decoding["query"] = _features(1)
    assert _scan(client).json()["found"] is False


def test_scans_are_counted_for_the_poster(client, db, _fake_decoding):
    seller = make_user(db, "seller")
    post = make_post(db, seller, [make_product(db)])
    _store(db, post, _features(1))
    _fake_decoding["query"] = _features(1)
    _scan(client)
    _scan(client)
    mine = client.get("/scan/mine", headers=auth(seller)).json()
    assert mine == [{"video_post_id": str(post.id), "scans": 2, "scans_7d": 2, "product_taps": 0}]
    assert db.query(VideoScan).count() == 2
    assert client.get("/scan/mine").status_code == 401


def test_public_page_shows_products_and_first_seen(client, db):
    seller = make_user(db, "seller")
    product = make_product(db)
    post = make_post(db, seller, [product])
    page = client.get(f"/scan/video/{post.id}").json()
    assert page["post"]["id"] == str(post.id) and page["registered_at"] is None and page["disputed"] is False
    _store(db, post, _features(1))
    page = client.get(f"/scan/video/{post.id}").json()
    assert page["registered_at"] is not None and [p["id"] for p in page["post"]["products"]] == [str(product.id)]
    assert client.get("/scan/video/00000000-0000-0000-0000-000000000000").status_code == 404


def test_a_copy_by_another_poster_opens_a_flag_and_marks_both_pages_disputed(client, db):
    original_poster, copier = make_user(db, "orig"), make_user(db, "copy")
    first = make_post(db, original_poster, [make_product(db)])
    _store(db, first, _features(7))
    second = make_post(db, copier, [make_product(db)])
    flags = scan_service.check_duplicates(db, second, _features(7))
    assert len(flags) == 1 and flags[0].video_post_id == second.id and flags[0].earlier_post_id == first.id
    assert client.get(f"/scan/video/{first.id}").json()["disputed"] is True
    assert client.get(f"/scan/video/{second.id}").json()["disputed"] is True
    again = scan_service.check_duplicates(db, second, _features(7))  # checking twice makes no second flag
    assert db.query(VideoMatchFlag).count() == 1 and again[0].id == flags[0].id


def test_same_poster_reupload_and_different_videos_make_no_flag(db):
    poster, other = make_user(db, "a"), make_user(db, "b")
    mine = make_post(db, poster, [make_product(db)])
    _store(db, mine, _features(7))
    assert scan_service.check_duplicates(db, make_post(db, poster, [make_product(db)]), _features(7)) == []
    assert scan_service.check_duplicates(db, make_post(db, other, [make_product(db)]), _features(8)) == []


def test_admin_reviews_flags(client, db):
    poster, copier, admin = make_user(db, "orig"), make_user(db, "copy"), make_user(db, "boss")
    admin.role = UserRole.admin
    db.commit()
    first = make_post(db, poster, [make_product(db)])
    _store(db, first, _features(7))
    flag = scan_service.check_duplicates(db, make_post(db, copier, [make_product(db)]), _features(7))[0]
    assert client.get("/scan/flags", headers=auth(poster)).status_code == 403
    listed = client.get("/scan/flags", headers=auth(admin)).json()
    assert [f["id"] for f in listed] == [str(flag.id)] and listed[0]["earlier"]["id"] == str(first.id)
    done = client.post(f"/scan/flags/{flag.id}/resolve", json={"status": "confirmed", "note": "same video"}, headers=auth(admin)).json()
    assert done["status"] == "confirmed" and done["resolved_at"] is not None
    assert client.get("/scan/flags", headers=auth(admin)).json() == []
    assert client.get(f"/scan/video/{first.id}").json()["disputed"] is False
    assert client.post(f"/scan/flags/{flag.id}/resolve", json={"status": "bogus"}, headers=auth(admin)).status_code == 422


def test_live_checks_do_not_log_misses_but_a_hit_is_logged(client, db, _fake_decoding):
    post = make_post(db, make_user(db, "owner"), products=[make_product(db)])
    _store(db, post, _features(1))
    _fake_decoding["query"] = _features(99)  # not in the library
    r = client.post("/scan/match?live=true", files={"clip": ("live.webm", io.BytesIO(b"x"), "video/webm")})
    assert r.status_code == 200 and r.json()["found"] is False
    assert db.query(VideoScan).count() == 0
    _fake_decoding["query"] = _features(1)
    r = client.post("/scan/match?live=true", files={"clip": ("live.webm", io.BytesIO(b"x"), "video/webm")})
    assert r.json()["found"] is True
    assert db.query(VideoScan).filter_by(found=True).count() == 1
