"""Look-alike reviews: the same room, a different presenter or product. Plus the optional speech / picture-model guards."""
import subprocess
import types

import cv2
import numpy as np
import pytest

from app import scan_embed, scan_fp, scan_speech

W, H, FPS = 360, 640, 24


def _review(path, seed, bg_seed=1, dur=6):
    """A fixed set (same for the same bg_seed: books, boxes, numbers) with a few shapes that move differently per seed."""
    rb = np.random.default_rng(bg_seed)
    base = cv2.resize(rb.random((6, 4)).astype(np.float32), (W, H), interpolation=cv2.INTER_CUBIC) + 0.35 * cv2.resize(
        rb.random((30, 20)).astype(np.float32), (W, H), interpolation=cv2.INTER_CUBIC)
    base = (base - base.min()) / (np.ptp(base) + 1e-6)
    c0, c1 = rb.integers(20, 235, 3).astype(np.float32), rb.integers(20, 235, 3).astype(np.float32)
    bg = (base[..., None] * c1 + (1 - base[..., None]) * c0).astype(np.uint8)
    for _ in range(90):
        x, y = int(rb.integers(0, W - 30)), int(rb.integers(0, H - 30))
        w, h = int(rb.integers(8, 45)), int(rb.integers(8, 60))
        col = tuple(int(v) for v in rb.integers(0, 255, 3))
        cv2.rectangle(bg, (x, y), (x + w, y + h), col, -1 if rb.random() < 0.6 else 2)
    for _ in range(25):
        cv2.putText(bg, str(int(rb.integers(100, 9999))), (int(rb.integers(0, W - 60)), int(rb.integers(20, H - 5))),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1)
    r = np.random.default_rng(seed)
    subj = []
    for _ in range(3):
        h, w = int(r.integers(70, 150)), int(r.integers(60, 120))
        yy, xx = np.mgrid[0:h, 0:w]
        m = ((xx // int(r.integers(4, 9))) + (yy // int(r.integers(4, 9)))) % 2
        c = r.integers(30, 255, (2, 3))
        img = np.where(m[..., None] == 1, c[0], c[1]).astype(np.uint8)
        cv2.putText(img, str(int(r.integers(10, 99))), (5, h // 2), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2)
        subj.append(dict(img=img, cx=r.uniform(100, W - 100), cy=r.uniform(150, H - 150), ax=r.uniform(30, 90), ay=r.uniform(20, 80),
                         fx=r.uniform(0.15, 0.5), fy=r.uniform(0.15, 0.5), ph=r.uniform(0, 6.28)))
    raw = str(path) + ".raw.mp4"
    vw = cv2.VideoWriter(raw, cv2.VideoWriter_fourcc(*"mp4v"), FPS, (W, H))
    for f in range(int(FPS * dur)):
        t, fr = f / FPS, bg.copy()
        for s in subj:
            x = int(s["cx"] + s["ax"] * np.sin(s["fx"] * t * 6.28 + s["ph"]))
            y = int(s["cy"] + s["ay"] * np.sin(s["fy"] * t * 6.28 + s["ph"] * 1.3))
            h, w = s["img"].shape[:2]
            x0, y0, x1, y1 = max(0, x - w // 2), max(0, y - h // 2), min(W, x - w // 2 + w), min(H, y - h // 2 + h)
            fr[y0:y1, x0:x1] = s["img"][: y1 - y0, : x1 - x0]
        vw.write(fr)
    vw.release()
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", raw, "-c:v", "libx264", "-crf", "20", "-pix_fmt", "yuv420p", str(path)], check=True)


def _rec(src, out, start, dur):
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", str(start), "-t", str(dur), "-i", str(src), "-vf", f"scale={W}:{H}",
                    "-c:v", "libx264", "-crf", "26", "-pix_fmt", "yuv420p", str(out)], check=True)


@pytest.fixture(scope="module")
def room(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("room")
    a, b = tmp / "a.mp4", tmp / "b.mp4"
    _review(a, 11)
    _review(b, 22)  # same room, other presenter
    _rec(a, tmp / "rec_a.mp4", 0.5, 4)
    _rec(a, tmp / "rec_a_late.mp4", 1.7, 4)
    _rec(b, tmp / "rec_b.mp4", 0.5, 4)
    return dict(a=a, rec_a=tmp / "rec_a.mp4", rec_a_late=tmp / "rec_a_late.mp4", rec_b=tmp / "rec_b.mp4")


def test_a_recording_of_a_moving_video_is_confirmed_at_the_right_moment(room):
    assert scan_fp.confirm_recording(room["a"], room["rec_a"], 0.5)
    assert scan_fp.confirm_recording(room["a"], room["rec_a_late"], 1.7)


def test_another_review_from_the_same_room_is_not_confirmed(room):
    assert not scan_fp.confirm_recording(room["a"], room["rec_b"], 0.5)


def test_a_recording_that_is_not_at_the_place_it_claims_is_not_confirmed(room):
    # right video, but the fingerprints pointed 3 s away from where the recording really is: out of step
    assert not scan_fp.confirm_recording(room["a"], room["rec_a"], 3.5)


def test_motion_tells_a_still_screen_from_a_moving_picture():
    still = [np.full((120, 68), 100, np.uint8) for _ in range(6)]
    rng = np.random.default_rng(1)
    moving = [rng.integers(0, 255, (120, 68), dtype=np.uint8) for _ in range(6)]
    assert scan_fp._motion(still) <= scan_fp.PIX_MOVING < scan_fp._motion(moving)


def test_a_disagreement_on_the_moving_part_counts_double():
    rng = np.random.default_rng(2)
    o = rng.integers(0, 255, (480, 270), dtype=np.uint8)
    q = o.copy()
    q[:240] = rng.integers(0, 255, (240, 270), dtype=np.uint8)  # the top half is something else
    M = np.eye(2, 3, dtype=np.float32)
    plain = scan_fp._block_disagreement(q, o, M)[0]
    dyn = np.zeros((480, 270), bool)
    dyn[:240] = True
    weighted = scan_fp._block_disagreement(q, o, M, dyn)[0]
    assert plain > 0 and weighted == scan_fp.PIX_DYN_WEIGHT * plain


def test_cells_only_match_with_much_still_disagreeing_needs_the_pixel_check(monkeypatch):
    ix = types.SimpleNamespace(templ=[False], ids=[1])
    monkeypatch.setattr(scan_fp, "_identify", lambda *a, **k: dict(id=1, stage="2 cells (all)", covered=0.5, offset=0.0))
    assert scan_fp.identify(ix, None).get("templ") is True
    monkeypatch.setattr(scan_fp, "_identify", lambda *a, **k: dict(id=1, stage="2 cells (all)", covered=0.1, offset=0.0))
    assert not scan_fp.identify(ix, None).get("templ")
    monkeypatch.setattr(scan_fp, "_identify", lambda *a, **k: dict(id=1, stage="2 frames (all)", covered=None, offset=0.0))
    assert not scan_fp.identify(ix, None).get("templ")


# ---- the voiceover
SAME = "so this blender is really quiet and the jug is huge i use it every morning for smoothies and it cleans in seconds".split()
OTHER = "honestly the battery on this headset lasts all week and the microphone picks up my voice very clearly on calls".split()


def test_the_same_voiceover_agrees_and_another_does_not():
    assert scan_speech.agreement(SAME, SAME) == 1.0
    assert scan_speech.agreement(SAME, SAME[:4] + OTHER) < scan_speech.SPEECH_OK
    assert scan_speech.agreement(SAME, OTHER) < scan_speech.SPEECH_OK


def test_a_little_recognition_noise_still_agrees():
    noisy = list(SAME)
    noisy[5], noisy[14] = "wallet", "tomorrow"
    assert scan_speech.agreement(noisy, SAME) >= 0.6


def test_too_few_words_says_nothing():
    assert scan_speech.agreement(SAME[:5], SAME) is None
    assert scan_speech.agreement(SAME, ["hello"]) is None


def test_without_a_recogniser_the_speech_check_says_nothing(monkeypatch):
    monkeypatch.setattr(scan_speech, "_load", lambda: None)
    assert scan_speech.voiceover_agreement("a.mp4", "b.mp4", 1.0, 5.0) is None
    monkeypatch.setenv("SCAN_SPEECH", "0")
    assert not scan_speech.enabled()


def test_a_voiceover_that_differs_drops_a_confirmed_match(room, monkeypatch):
    monkeypatch.setattr(scan_speech, "voiceover_agreement", lambda *a, **k: 0.05)
    assert not scan_fp.confirm_recording(room["a"], room["rec_a"], 0.5)
    monkeypatch.setattr(scan_speech, "voiceover_agreement", lambda *a, **k: 0.9)
    assert scan_fp.confirm_recording(room["a"], room["rec_a"], 0.5)


# ---- the optional picture model
class _FakeSession:
    """Stands in for an ONNX model: the vector is the picture's average brightness in 4 bands."""

    def get_inputs(self):
        return [types.SimpleNamespace(name="x")]

    def run(self, _, feed):
        x = feed["x"]
        return [np.stack([x[:, :, i * 56:(i + 1) * 56, :].mean(axis=(1, 2, 3)) for i in range(4)], axis=1)]


def test_picture_embeddings_are_close_for_the_same_picture_only():
    rng = np.random.default_rng(3)
    a = (np.linspace(0, 255, 480)[:, None] * np.ones((1, 270))).astype(np.uint8)
    b = a[::-1].copy()
    s = _FakeSession()
    va, vb = scan_embed.embed([a], s), scan_embed.embed([b], s)
    assert scan_embed.similarity(va, va) > 0.999
    assert scan_embed.similarity(va, vb) < 0.9
    assert rng is not None


def test_without_a_picture_model_the_embedding_check_says_nothing(monkeypatch):
    monkeypatch.delenv("SCAN_EMBED_MODEL", raising=False)
    assert not scan_embed.enabled()
    assert scan_embed.frame_similarity(lambda *a, **k: ([], []), "a", "b", 1.0, 4.0) is None
