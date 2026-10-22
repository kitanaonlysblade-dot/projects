"""Scanning with a fingerprint the phone/browser computed itself (POST /scan/match-features). The fingerprint code
in the app is lumin-app/lib/fingerprint; its agreement with scan_fp.py is checked there (tests/fingerprint.test.ts,
against values this Python code produced) and end to end in a real browser (see NATIVE.md / README "Scan")."""
import base64

import numpy as np
import pytest

from app import scan_fp, scan_service
from app.models import VideoScan
from tests.conftest import auth, make_post, make_product, make_user
from tests.test_scan_api import _features, _store
from tests.test_scan_matcher import _recording, library  # noqa: F401  (a pytest fixture)


def b64(a, dtype) -> str:
    return base64.b64encode(np.ascontiguousarray(a).astype(np.dtype(dtype).newbyteorder("<")).tobytes()).decode()


def wire(q: "scan_fp.QueryFeatures", mirrored=(False,)) -> dict:
    """What the app sends, built from a QueryFeatures the way lib/fingerprint/clip.ts builds it."""
    d = {
        "algo": scan_fp.WIRE_ALGO,
        "clip_s": q.clip_s,
        "audio": {"hash": b64(q.audio[0], np.int32), "t": b64(q.audio[1], np.int32)},
        "times": list(q.times),
        "hashes": {}, "cells": {}, "ok": {},
    }
    for m in mirrored:
        k = "1" if m else "0"
        d["hashes"][k] = b64(q.hashes[m], np.uint8)
        d["cells"][k] = b64(q.cells[m][0], np.uint8)
        d["ok"][k] = b64(q.cells[m][1].astype(np.uint8), np.uint8)
    return d


@pytest.fixture(autouse=True)
def _fresh():
    scan_service.forget_cache()
    yield
    scan_service.forget_cache()


def post_features(client, body, **kw):
    return client.post("/scan/match-features", json=body, **kw)


# ---------------------------------------------------------------- the wire format
def test_wire_roundtrip_preserves_everything():
    q = scan_fp.query_from_video(_features(1, n=12))
    q.audio = (np.array([5, 70000000, 123], np.int64), np.array([0, 4, 9], np.int32))
    back = scan_fp.query_from_wire(wire(q))
    assert np.array_equal(back.hashes[False], q.hashes[False])
    assert np.array_equal(back.cells[False][0], q.cells[False][0]) and np.array_equal(back.cells[False][1], q.cells[False][1])
    assert np.array_equal(back.audio[0], q.audio[0]) and np.array_equal(back.audio[1], q.audio[1])
    assert back.times == q.times and back.orb_t == [] and back.orb == {False: []}


@pytest.mark.parametrize(
    "mutate",
    [
        lambda d: d.update(algo=99),
        lambda d: d["audio"].update(hash="%%%not base64%%%"),
        lambda d: d["audio"].update(hash=base64.b64encode(b"123").decode()),  # not a whole number of int32s
        lambda d: d["audio"].update(t=base64.b64encode(b"\0\0\0\0").decode()),  # hashes and times differ in length
        lambda d: d.update(times=[]),
        lambda d: d.update(times=[0.0] * 500),
        lambda d: d.update(times=[-1.0] * 12),
        lambda d: d["hashes"].update({"0": base64.b64encode(b"\0" * 8).decode()}),  # wrong number of frames
        lambda d: d.update(hashes={}, cells={}, ok={}),
    ],
)
def test_malformed_fingerprints_are_refused(mutate):
    d = wire(scan_fp.query_from_video(_features(1, n=12)))
    mutate(d)
    with pytest.raises(ValueError):
        scan_fp.query_from_wire(d)


def test_too_many_audio_hashes_are_refused():
    d = wire(scan_fp.query_from_video(_features(1, n=12)))
    n = scan_fp.WIRE_MAX_AUDIO_HASHES + 1
    d["audio"] = {"hash": b64(np.zeros(n), np.int32), "t": b64(np.zeros(n), np.int32)}
    with pytest.raises(ValueError):
        scan_fp.query_from_wire(d)


# ---------------------------------------------------------------- the endpoint
def test_a_fingerprint_finds_the_matching_video(client, db):
    seller = make_user(db, "seller")
    post = make_post(db, seller, [make_product(db)])
    other = make_post(db, seller, [make_product(db)])
    _store(db, post, _features(1))
    _store(db, other, _features(2))
    body = post_features(client, wire(scan_fp.query_from_video(_features(1)))).json()
    assert body["found"] is True and body["video_post_id"] == str(post.id)
    assert body["deeper_check"] is False


def test_an_unknown_video_is_not_found_and_offers_the_deeper_check(client, db):
    seller = make_user(db, "seller")
    _store(db, make_post(db, seller, [make_product(db)]), _features(1))
    body = post_features(client, wire(scan_fp.query_from_video(_features(999)))).json()
    assert body["found"] is False and body["video_post_id"] is None
    assert body["deeper_check"] is True and "deeper check" in body["message"]
    assert db.query(VideoScan).filter(VideoScan.found.is_(False)).count() == 1


def test_live_checks_do_not_log_misses(client, db):
    seller = make_user(db, "seller")
    _store(db, make_post(db, seller, [make_product(db)]), _features(1))
    r = client.post("/scan/match-features?live=true", json=wire(scan_fp.query_from_video(_features(999))))
    assert r.status_code == 200 and db.query(VideoScan).count() == 0


def test_a_hidden_posters_video_looks_like_not_found(client, db):
    seller = make_user(db, "seller")
    seller.is_shadow_banned = True
    db.commit()
    post = make_post(db, seller, [make_product(db)])
    _store(db, post, _features(1))
    assert post_features(client, wire(scan_fp.query_from_video(_features(1)))).json()["found"] is False


def test_a_video_held_by_moderation_is_never_matched(client, db):
    seller = make_user(db, "seller")
    post = make_post(db, seller, [make_product(db)])
    _store(db, post, _features(1))
    post.moderation_hold = True
    db.commit()
    assert post_features(client, wire(scan_fp.query_from_video(_features(1)))).json()["found"] is False


def test_bad_input_is_a_clean_400_not_a_500(client):
    assert post_features(client, {"algo": 1}).status_code == 400
    assert post_features(client, {"algo": 99}).status_code == 400
    assert post_features(client, {}).status_code == 400
    ok = wire(scan_fp.query_from_video(_features(1)))
    assert post_features(client, {**ok, "clip_s": 0.5}).status_code == 400
    assert post_features(client, {**ok, "clip_s": 600}).status_code == 400


def test_the_signed_in_person_is_recorded_on_a_hit(client, db):
    seller = make_user(db, "seller")
    scanner = make_user(db, "scanner")
    post = make_post(db, seller, [make_product(db)])
    _store(db, post, _features(1))
    post_features(client, wire(scan_fp.query_from_video(_features(1))), headers=auth(scanner))
    assert db.query(VideoScan).filter(VideoScan.user_id == scanner.id, VideoScan.found.is_(True)).count() == 1


# ---------------------------------------------------------------- real (synthetic) videos, through the wire format
@pytest.mark.parametrize("seed", [11, 22, 33])
def test_a_wire_fingerprint_of_a_recording_finds_the_right_video(library, seed):
    out = library["tmp"] / f"wire{seed}.mp4"
    _recording(library["paths"][seed], out, "scale=288:512,fps=30")
    q = scan_fp.query_from_wire(wire(scan_fp.extract_query(out), mirrored=(False, True)))
    res = scan_fp.identify(library["ix"], q)
    assert res["id"] == seed, res
    assert abs(res["offset"] - 1.0) < 1.2


def test_a_wire_fingerprint_of_a_stranger_is_not_found(library):
    out = library["tmp"] / "wire_stranger.mp4"
    _recording(library["stranger"], out, "scale=288:512,fps=30")
    q = scan_fp.query_from_wire(wire(scan_fp.extract_query(out), mirrored=(False, True)))
    assert scan_fp.identify(library["ix"], q)["id"] is None
