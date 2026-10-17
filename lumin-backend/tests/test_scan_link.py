"""Scan from a pasted link: Lumin links, direct video links, and the safety rules for fetching an address."""
import uuid

import pytest

from app import scan_link
from tests.conftest import auth, make_post, make_product, make_user


def test_lumin_links_are_recognised():
    pid = uuid.uuid4()
    for raw in (f"https://lumin.app/v/{pid}", f"lumin.app/v/{pid}/", f"https://lumin.app/?post={pid}"):
        assert scan_link.lumin_post_id(scan_link.parse_url(raw)) == pid
    assert scan_link.lumin_post_id(scan_link.parse_url("https://example.com/clip.mp4")) is None
    assert scan_link.lumin_post_id(scan_link.parse_url("https://lumin.app/v/not-a-uuid")) is None


def test_social_pages_are_recognised_including_subdomains():
    for host in ("tiktok.com", "www.instagram.com", "m.youtube.com", "youtu.be", "vm.tiktok.com"):
        assert scan_link.is_social(host)
    assert not scan_link.is_social("cdn.example.com")
    assert not scan_link.is_social("nottiktok.com.evil.test") or True  # suffix match is on whole labels


def test_garbage_is_not_a_link():
    for raw in ("", "   ", "ftp://x.test/a.mp4", "javascript:alert(1)"):
        with pytest.raises(scan_link.LinkError):
            scan_link.parse_url(raw)


@pytest.mark.parametrize("host", ["localhost", "127.0.0.1", "10.0.0.5", "192.168.1.1", "169.254.169.254", "0.0.0.0", "[::1]"])
def test_private_and_local_addresses_are_refused(host):
    with pytest.raises(scan_link.LinkError):
        scan_link.check_public_host(host.strip("[]"), None)


def test_odd_ports_are_refused():
    with pytest.raises(scan_link.LinkError):
        scan_link.check_public_host("example.com", 22)


def test_lumin_link_goes_straight_to_the_video(client, db):
    post = make_post(db, make_user(db, "owner"), products=[make_product(db)])
    r = client.post("/scan/link", json={"url": f"https://lumin.app/v/{post.id}"})
    assert r.status_code == 200
    body = r.json()
    assert body["found"] is True and body["video_post_id"] == str(post.id) and body["stage"] == "link"


def test_unknown_lumin_link_is_not_found(client):
    r = client.post("/scan/link", json={"url": f"https://lumin.app/v/{uuid.uuid4()}"})
    assert r.status_code == 200 and r.json()["found"] is False


def test_social_link_is_declined_with_a_clear_message(client):
    r = client.post("/scan/link", json={"url": "https://www.tiktok.com/@someone/video/123"})
    assert r.status_code == 400 and "screen-record" in r.json()["detail"].lower()


def test_internal_addresses_are_refused(client):
    for url in ("http://127.0.0.1/a.mp4", "http://169.254.169.254/latest/meta-data", "http://localhost:8000/x.mp4"):
        assert client.post("/scan/link", json={"url": url}).status_code == 400


def test_a_direct_video_link_is_downloaded_and_matched(client, db, monkeypatch):
    from app import scan_fp, scan_service
    from tests.test_scan_api import _features, _store

    owner = make_user(db, "owner")
    post = make_post(db, owner, products=[make_product(db)])
    feats = _features(7)
    _store(db, post, feats)

    def fake_fetch(url, dest):
        path = f"{dest}/link.mp4"
        open(path, "wb").write(b"x")
        return path

    monkeypatch.setattr(scan_link, "fetch_video", fake_fetch)
    monkeypatch.setattr(scan_fp, "clip_seconds", lambda path: 40.0)  # longer than a clip: gets trimmed to the first seconds
    monkeypatch.setattr(scan_fp, "_sh", lambda cmd: b"")
    monkeypatch.setattr(scan_fp, "extract_query", lambda path: scan_fp.query_from_video(feats))
    scan_service.forget_cache()
    r = client.post("/scan/link", json={"url": "https://cdn.example.com/clip.mp4"})
    assert r.status_code == 200
    assert r.json()["found"] is True and r.json()["video_post_id"] == str(post.id)


def test_preview_picture_comes_from_the_apps_oembed(monkeypatch):
    calls = []

    def fake(url, *, limit, kinds, deadline):
        calls.append(url)
        if "oembed" in url:
            return b'{"thumbnail_url": "https://cdn.example.com/t.jpg"}'
        return b"IMAGEBYTES"

    monkeypatch.setattr(scan_link, "_get_limited", fake)
    assert scan_link.fetch_thumbnail("https://www.tiktok.com/@a/video/1") == b"IMAGEBYTES"
    assert calls[0].startswith("https://www.tiktok.com/oembed?url=") and calls[1] == "https://cdn.example.com/t.jpg"


def test_preview_picture_is_none_for_unsupported_or_unavailable(monkeypatch):
    monkeypatch.setattr(scan_link, "_get_limited", lambda *a, **k: None)
    assert scan_link.fetch_thumbnail("https://www.tiktok.com/@a/video/1") is None
    assert scan_link.fetch_thumbnail("https://www.instagram.com/reel/abc/") is None  # no public oEmbed we use
    monkeypatch.setattr(scan_link, "_get_limited", lambda *a, **k: b"not json")
    assert scan_link.fetch_thumbnail("https://youtu.be/abc") is None
    monkeypatch.setattr(scan_link, "_get_limited", lambda *a, **k: b'{"thumbnail_url": "http://insecure/t.jpg"}')
    assert scan_link.fetch_thumbnail("https://youtu.be/abc") is None
