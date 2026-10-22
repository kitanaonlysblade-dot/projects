"""A video playing in only PART of the screen (a desktop browser: page, header and a scrolling comments strip around a
video in the middle) is found by looking at just that rectangle."""
import subprocess

import cv2
import numpy as np
import pytest

from app import scan_fp
from tests.test_scan_matcher import _video


def _desktop(src, out, W=1280, H=720, vw=300, vh=533, start=0.5, dur=4.5):
    rng = np.random.default_rng(5)
    page = np.full((H, W, 3), 235, np.uint8)
    for _ in range(60):
        x, y = int(rng.integers(0, W - 80)), int(rng.integers(0, H - 20))
        cv2.rectangle(page, (x, y), (x + int(rng.integers(30, 200)), y + 8), (int(rng.integers(120, 200)),) * 3, -1)
    cv2.rectangle(page, (0, 0), (W, 48), (60, 60, 60), -1)
    cap = cv2.VideoCapture(str(src))
    fps = cap.get(cv2.CAP_PROP_FPS) or 24
    raw = str(out) + ".raw.mp4"
    vwr = cv2.VideoWriter(raw, cv2.VideoWriter_fourcc(*"mp4v"), fps, (W, H))
    x0, y0 = (W - vw) // 2, (H - vh) // 2 + 20
    text = rng.integers(0, 255, (900, 260, 3), dtype=np.uint8)
    f = 0
    while True:
        ok, fr = cap.read()
        if not ok:
            break
        pg = page.copy()
        pg[y0:y0 + vh, x0:x0 + vw] = cv2.resize(fr, (vw, vh), interpolation=cv2.INTER_AREA)
        off = (f * 3) % 600
        pg[80:340, W - 300:W - 40] = text[off:off + 260]  # a scrolling comments strip beside the video
        vwr.write(pg)
        f += 1
    vwr.release()
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", str(start), "-t", str(dur), "-i", raw, "-c:v", "libx264", "-crf", "26",
                    "-pix_fmt", "yuv420p", str(out)], check=True)


@pytest.fixture(scope="module")
def desk(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("desk")
    mine, other = tmp / "mine.mp4", tmp / "other.mp4"
    _video(mine, 11, tmp, True)
    _video(other, 99, tmp, True)
    _desktop(mine, tmp / "rec_mine.mp4")
    _desktop(other, tmp / "rec_other.mp4")
    ix = scan_fp.build_index([(11, scan_fp.extract_video(mine))])
    return dict(tmp=tmp, ix=ix, rec=tmp / "rec_mine.mp4", rec_other=tmp / "rec_other.mp4")


def test_the_video_rectangle_is_found_not_the_comments_strip(desk):
    r0, r1, c0, c1 = scan_fp.detect_rect(desk["rec"])
    # the video, in the 480-pixel-high frames: about rows 76..432, columns 328..528 (the strip is at the right, smaller)
    assert abs(r0 - 76) <= 14 and abs(r1 - 432) <= 14
    assert abs(c0 - 328) <= 14 and abs(c1 - 528) <= 14


def test_the_whole_screen_misses_it_but_the_rectangle_finds_it(desk):
    whole = scan_fp.identify(desk["ix"], scan_fp.extract_query(desk["rec"]))
    assert whole["id"] is None  # mostly page: nothing to match on
    cropped = scan_fp.identify(desk["ix"], scan_fp.extract_query(desk["rec"], crop=scan_fp.detect_rect(desk["rec"])))
    assert cropped["id"] == 11


def test_another_video_in_the_same_page_is_still_not_found(desk):
    rect = scan_fp.detect_rect(desk["rec_other"])
    assert rect is not None
    assert scan_fp.identify(desk["ix"], scan_fp.extract_query(desk["rec_other"], crop=rect))["id"] is None


def test_a_video_filling_the_screen_has_no_rectangle_to_cut():
    rng = np.random.default_rng(1)
    frames = [rng.integers(0, 255, (480, 270), dtype=np.uint8) for _ in range(12)]
    assert scan_fp.find_video_rect(frames) is None


def test_a_still_screen_has_no_rectangle():
    frames = [np.full((480, 853), 120, np.uint8) for _ in range(12)]
    assert scan_fp.find_video_rect(frames) is None


def test_scattered_motion_is_not_a_video():
    rng = np.random.default_rng(2)
    base = np.full((480, 853), 120, np.uint8)
    frames = []
    for _ in range(12):
        f = base.copy()
        for _ in range(40):  # specks here and there
            x, y = int(rng.integers(0, 840)), int(rng.integers(0, 470))
            f[y:y + 8, x:x + 8] = rng.integers(0, 255)
        frames.append(f)
    assert scan_fp.find_video_rect(frames) is None
