import os
import shutil
import subprocess

import pytest

from app import video_optimize as vo


def info(w, h, audio=True):
    streams = [{"codec_type": "video", "width": w, "height": h}]
    if audio:
        streams.append({"codec_type": "audio"})
    return {"streams": streams}


def test_the_ladder_never_goes_above_the_original():
    assert [r[0] for r in vo._hls_rungs(info(720, 1280))] == [240, 360, 540, 720]
    assert [r[0] for r in vo._hls_rungs(info(360, 640))] == [240, 360]
    assert [r[0] for r in vo._hls_rungs(info(1920, 1080))] == [240, 360, 540, 720]  # landscape: the short side counts
    assert [r[0] for r in vo._hls_rungs(info(160, 120))] == [240]  # tiny source: still one rung


def test_the_smallest_quality_is_listed_first():
    sides = [r[0] for r in vo.HLS_LADDER]
    assert sides == sorted(sides)


def test_the_lite_playlist_has_only_the_two_smallest_qualities(tmp_path):
    (tmp_path / "master.m3u8").write_text(
        "#EXTM3U\n#EXT-X-VERSION:6\n"
        + "".join(f"#EXT-X-STREAM-INF:BANDWIDTH={b}\nv{i}/index.m3u8\n\n" for i, b in enumerate([1, 2, 3, 4]))
    )
    vo._write_lite_master(str(tmp_path))
    text = (tmp_path / "lite.m3u8").read_text()
    assert text.count("#EXT-X-STREAM-INF") == 2 and "v0/index.m3u8" in text and "v1/index.m3u8" in text and "v2/" not in text
    assert text.startswith("#EXTM3U")


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="needs ffmpeg")
def test_a_real_clip_is_cut_into_pieces_at_each_quality(tmp_path):
    src = tmp_path / "p.mp4"
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=360x640:r=30:d=5", "-f", "lavfi", "-i", "sine=d=5",
         "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", str(src)],
        check=True,
    )
    out = tmp_path / "hls"
    out.mkdir()
    vo._make_hls(str(src), str(out), vo._probe(str(src)))
    assert (out / "master.m3u8").exists() and (out / "lite.m3u8").exists()
    for v in ("v0", "v1"):
        assert (out / v / "index.m3u8").exists() and (out / v / "seg_0000.ts").exists()
    assert not (out / "v2").exists()  # a 360-wide source has no 540 rung
    assert "#EXT-X-ENDLIST" in (out / "v0" / "index.m3u8").read_text()


def test_every_rung_has_a_quality_target_and_a_cap():
    for side, vrate, arate, crf in vo.HLS_LADDER:
        assert vrate.endswith("k") and arate.endswith("k") and 18 <= crf <= 35
    crfs = [r[3] for r in vo.HLS_LADDER]
    assert crfs == sorted(crfs, reverse=True)  # bigger pictures get the higher quality target


def test_the_hls_command_is_quality_based_with_a_ceiling(monkeypatch, tmp_path):
    seen = {}
    monkeypatch.setattr(vo, "_run", lambda cmd: seen.setdefault("cmd", cmd))
    monkeypatch.setattr(vo, "_write_lite_master", lambda d: None)
    vo._make_hls("in.mp4", str(tmp_path), info(720, 1280))
    cmd = seen["cmd"]
    assert "-crf:v:0" in cmd and "-maxrate:v:0" in cmd and "-bufsize:v:0" in cmd
    assert "-b:v:0" not in cmd  # no fixed target any more


def test_the_metrics_endpoint_accepts_a_batch_without_login(client):
    r = client.post("/hls-metrics", json={"points": [
        {"kind": "ttff", "is_hls": True, "value_ms": 640},
        {"kind": "ttff", "is_hls": False, "value_ms": 910},
        {"kind": "fallback"},
    ]})
    assert r.status_code == 204
    assert client.post("/hls-metrics", json={"points": [{"kind": "bogus"}]}).status_code == 422
