import os
import shutil
import subprocess
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from app import watermark  # noqa: E402


def test_output_size_is_even_and_capped():
    assert watermark.output_size(720, 1600) == (720, 1600)
    assert watermark.output_size(721, 1281) == (720, 1280)
    w, h = watermark.output_size(2160, 3840)
    assert w == watermark.MAX_WIDTH and w % 2 == 0 and h % 2 == 0 and abs(h / w - 3840 / 2160) < 0.01


def test_cache_key_is_under_one_prefix_and_depends_on_the_name():
    a = watermark.cache_key("videos/abc.mp4", "Ann")
    b = watermark.cache_key("videos/abc.mp4", "Bob")
    assert a.startswith(watermark.CACHE_PREFIX + "abc-") and a.endswith(".mp4") and a != b
    assert a == watermark.cache_key("videos/abc.mp4", "Ann")


def test_mark_and_end_card_have_the_video_size_and_the_mark_is_mostly_see_through():
    mark = watermark.render_mark(540, 960, "Ann")
    assert mark.size == (540, 960) and mark.mode == "RGBA"
    alpha = mark.getchannel("A")
    assert alpha.getextrema()[1] == 255 and sum(1 for v in alpha.getdata() if v) < 0.2 * 540 * 960
    assert watermark.render_end_card(540, 960, "Ann").size == (540, 960)


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")
def test_a_marked_copy_keeps_the_sound_and_adds_the_end_card(tmp_path):
    src, dst = str(tmp_path / "in.mp4"), str(tmp_path / "out.mp4")
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc=size=320x568:rate=25:duration=3",
         "-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-shortest", "-pix_fmt", "yuv420p", src],
        check=True,
    )
    watermark.make_watermarked(src, dst, "Ann")
    w, h, seconds, audio = watermark.probe(dst)
    assert (w, h) == (320, 568) and audio
    assert abs(seconds - (3 + watermark.END_CARD_SECONDS)) < 0.5


def test_the_mark_fades_out_moves_while_invisible_and_fades_in():
    p, al, H, F = watermark.mark_progress, watermark.mark_alpha, watermark.MOVE_HOLD, watermark.MOVE_FADE
    assert p(0) == 0 and p(H - 0.01) == 0 and p(H) == 1 and p(2 * H - 0.01) == 1 and p(watermark.MOVE_PERIOD) == 0
    assert al(H / 2) == 1 and al(H) == 0 and al(2 * H) == 0 and al(0) == 0  # invisible at every move
    assert abs(al(H - F / 2) - 0.5) < 1e-9 and abs(al(H + F / 2) - 0.5) < 1e-9
    assert al(H - F) == 1 and al(H + F) == 1
    assert H >= 5  # it rests long enough to read


def test_mark_tile_rests_inside_the_picture_in_both_places():
    tile, tl, br = watermark.mark_tile(540, 960, "Ann")
    assert tile.width < 540 / 2 and tile.height < 960 / 4
    assert tl[0] > 0 and tl[1] > 0 and br[0] > tl[0] and br[1] > tl[1]
    assert br[0] + tile.width <= 540 and br[1] + tile.height <= 960
    x, y = watermark.mark_position_exprs(*tl, *br)
    assert f"mod(t,{watermark.MOVE_PERIOD:g})" in x and f"mod(t,{watermark.MOVE_PERIOD:g})" in y
