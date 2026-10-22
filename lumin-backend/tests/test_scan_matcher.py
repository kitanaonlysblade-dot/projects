"""The matcher on small synthetic videos (needs ffmpeg + OpenCV; no database).

Synthetic videos are NOT real footage: they show the cascade works end to end and that "not found" is preferred
to a wrong answer. They say nothing about accuracy on real screen recordings.
"""
import subprocess
import wave

import cv2
import numpy as np
import pytest

from app import scan_fp

W, H, FPS, DUR, SR = 360, 640, 24, 6, 22050


def _smooth_noise(rng, small, big, amp):
    return cv2.resize(rng.random(small).astype(np.float32), (big[1], big[0]), interpolation=cv2.INTER_CUBIC) * amp


def _pattern(rng, h, w):
    """Stripes / checkers: real footage has fine texture, smooth gradients and flat shapes would not."""
    kind, c = rng.integers(0, 3), rng.integers(30, 255, (2, 3))
    yy, xx = np.mgrid[0:h, 0:w]
    if kind == 0:
        m = (xx // int(rng.integers(4, 12))) % 2
    elif kind == 1:
        m = ((xx // int(rng.integers(5, 12))) + (yy // int(rng.integers(5, 12)))) % 2
    else:
        m = ((xx + yy) // int(rng.integers(5, 12))) % 2
    return np.where(m[..., None] == 1, c[0], c[1]).astype(np.uint8)


def _video(path, seed, tmp_path, silent=False):
    rng = np.random.default_rng(seed)
    ch, cw = H + 200, W + 200
    cuts, t = [], 0.0
    while t < DUR:  # a few scene cuts, each with its own background
        d = float(rng.uniform(2.0, 3.5))
        base = _smooth_noise(rng, (6, 4), (ch, cw), 1.0) + _smooth_noise(rng, (30, 20), (ch, cw), 0.35)
        base = (base - base.min()) / (np.ptp(base) + 1e-6)
        c0, c1 = rng.integers(20, 235, 3).astype(np.float32), rng.integers(20, 235, 3).astype(np.float32)
        bg = (base[..., None] * c1 + (1 - base[..., None]) * c0).astype(np.uint8)
        cuts.append((t, min(DUR, t + d), bg, rng.uniform(-25, 25), rng.uniform(-40, 40)))
        t += d
    fg = []
    for _ in range(int(rng.integers(3, 6))):
        h, w = int(rng.integers(60, 200)), int(rng.integers(50, 160))
        fg.append(dict(img=_pattern(rng, h, w), cx=rng.uniform(60, W - 60), cy=rng.uniform(100, H - 100), ax=rng.uniform(10, 70),
                       ay=rng.uniform(10, 90), fx=rng.uniform(0.2, 0.8), fy=rng.uniform(0.2, 0.8), ph=rng.uniform(0, 6.28)))
    silent_path = tmp_path / f"v{seed}_noaudio.mp4"
    vw = cv2.VideoWriter(str(silent_path), cv2.VideoWriter_fourcc(*"mp4v"), FPS, (W, H))
    for f in range(FPS * DUR):
        t = f / FPS
        c = next((c for c in cuts if c[0] <= t < c[1] + 1e-9), cuts[-1])
        ox, oy = int(100 + c[3] * (t - c[0])) % 200, int(100 + c[4] * (t - c[0])) % 200
        frame = c[2][oy:oy + H, ox:ox + W].copy()
        for s_ in fg:
            x = int(s_["cx"] + s_["ax"] * np.sin(s_["fx"] * t * 6.28 + s_["ph"]))
            y = int(s_["cy"] + s_["ay"] * np.sin(s_["fy"] * t * 6.28 + s_["ph"] * 1.3))
            h, w = s_["img"].shape[:2]
            x0, y0 = max(0, x - w // 2), max(0, y - h // 2)
            x1, y1 = min(W, x0 + w), min(H, y0 + h)
            if x1 - x0 >= 5 and y1 - y0 >= 5:
                frame[y0:y1, x0:x1] = s_["img"][: y1 - y0, : x1 - x0]
        vw.write(frame)
    vw.release()
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", str(silent_path)]
    if not silent:
        wav = tmp_path / f"v{seed}.wav"
        scale = np.array([0, 2, 4, 7, 9, 12]) + (seed % 5)
        out, t = np.zeros(SR * DUR, np.float32), 0.0
        while t < DUR:
            d = float(rng.choice([0.2, 0.3, 0.45])); f0 = 220 * 2 ** (rng.choice(scale) / 12); n = int(d * SR); tt = np.arange(n) / SR
            s = (np.sin(2 * np.pi * f0 * tt) + 0.5 * np.sin(4 * np.pi * f0 * tt)) * np.minimum(1, tt * 40) * np.exp(-tt * 3)
            i = int(t * SR); out[i:i + n] += s[: max(0, min(n, len(out) - i))] * 0.3; t += d
        with wave.open(str(wav), "wb") as w_:
            w_.setnchannels(1); w_.setsampwidth(2); w_.setframerate(SR); w_.writeframes((np.clip(out, -1, 1) * 32767).astype(np.int16).tobytes())
        cmd += ["-i", str(wav), "-c:a", "aac", "-b:a", "96k", "-shortest"]
    subprocess.run(cmd + ["-c:v", "libx264", "-crf", "20", "-pix_fmt", "yuv420p", str(path)], check=True)
    silent_path.unlink()


def _recording(src, out, vf, start=1.0, dur=4):
    """Like a screen recording of the video playing elsewhere: re-encoded, scaled, from the middle."""
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", str(start), "-t", str(dur), "-i", str(src), "-vf", vf,
                    "-c:v", "libx264", "-crf", "30", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "48k", str(out)], check=True)


@pytest.fixture(scope="module")
def library(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("scan")
    paths = {}
    for seed, silent in ((11, False), (22, False), (33, True)):
        p = tmp / f"v{seed}.mp4"
        _video(p, seed, tmp, silent)
        paths[seed] = p
    stranger = tmp / "v99.mp4"
    _video(stranger, 99, tmp)
    feats = {seed: scan_fp.unpack(scan_fp.pack(scan_fp.extract_video(p))) for seed, p in paths.items()}  # also round-trips storage
    ix = scan_fp.build_index((seed, f) for seed, f in feats.items())
    return dict(tmp=tmp, paths=paths, stranger=stranger, feats=feats, ix=ix)


def test_pack_unpack_roundtrip(library):
    f = library["feats"][11]
    g = scan_fp.unpack(scan_fp.pack(f))
    assert np.array_equal(f.f_hash, g.f_hash) and np.array_equal(f.a_hash, g.a_hash) and len(f.orb) == len(g.orb)
    assert len(f.sift) == len(g.sift) and len(g.sift) > 0
    assert g.sift[0][2].dtype == np.uint8 and g.sift[0][2].shape[1] == 128


def test_a_video_stored_before_sift_existed_still_loads_and_is_searched(library):
    """Rows saved with the older fingerprint version have no SIFT block: they must still unpack and still be found."""
    f = library["feats"][11]
    old = scan_fp.VideoFeatures(f.duration, f.a_hash, f.a_t, f.f_hash, f.f_cell, f.f_ok, f.f_t, f.orb, [])
    assert scan_fp.unpack(scan_fp.pack(old)).sift == []
    ix = scan_fp.build_index([(11, old)])
    assert len(ix.orb) > 0 and len(ix.sift) == 0


def test_a_shared_caption_alone_is_not_a_match():
    """Two different videos with the same burned-in caption agree only inside that thin strip: not a match."""
    rng = np.random.default_rng(1)
    pts = rng.uniform(0, 400, (300, 2)).astype(np.float32)
    strip = pts[(pts[:, 1] > 300) & (pts[:, 1] < 316)]
    inl = np.ones(len(strip), np.uint8)
    assert not scan_fp._spread_ok(strip, inl, pts)
    wide = pts[:60]
    assert scan_fp._spread_ok(wide, np.ones(len(wide), np.uint8), pts)


def test_viewport_box_cuts_the_bars_around_a_moving_picture():
    rng = np.random.default_rng(2)
    frames = []
    for i in range(12):
        g = np.full((400, 200), 240, np.uint8)             # static bars
        g[50:330] = rng.integers(0, 255, (280, 200))       # a changing picture between them
        frames.append(g)
    r0, r1, c0, c1 = scan_fp.viewport_box(frames)
    assert 40 <= r0 <= 60 and 320 <= r1 <= 340 and c0 <= 4 and c1 >= 196
    assert scan_fp.viewport_box(frames[:3]) is None          # too few frames to tell


@pytest.mark.parametrize("seed", [11, 22, 33])
def test_finds_the_right_video_from_a_recording(library, seed):
    out = library["tmp"] / f"rec{seed}.mp4"
    _recording(library["paths"][seed], out, "scale=288:512,fps=30")
    res = scan_fp.identify(library["ix"], scan_fp.extract_query(out))
    assert res["id"] == seed, res
    assert abs(res["offset"] - 1.0) < 1.2


def test_finds_a_mirrored_recording(library):
    out = library["tmp"] / "rec_mirror.mp4"
    _recording(library["paths"][22], out, "hflip,scale=288:512")
    assert scan_fp.identify(library["ix"], scan_fp.extract_query(out))["id"] == 22


def test_a_video_that_is_not_in_the_library_is_not_found(library):
    out = library["tmp"] / "rec_stranger.mp4"
    _recording(library["stranger"], out, "scale=288:512,fps=30")
    res = scan_fp.identify(library["ix"], scan_fp.extract_query(out))
    assert res["id"] is None and res["stage"] == "none"


def test_empty_library_finds_nothing(library):
    out = library["tmp"] / "rec_any.mp4"
    _recording(library["paths"][11], out, "scale=288:512")
    assert scan_fp.build_index([]) is None
    assert scan_fp.identify(None, scan_fp.extract_query(out))["id"] is None


def test_duplicate_check_ignores_a_shared_sound(library):
    """Two uploads with the same soundtrack but different pictures are not the same video."""
    f = library["feats"][11]
    other = scan_fp.unpack(scan_fp.pack(library["feats"][22]))
    other.a_hash, other.a_t = f.a_hash.copy(), f.a_t.copy()  # same sound, different pictures
    ix = scan_fp.build_index([(11, f)])
    res = scan_fp.identify(ix, scan_fp.query_from_video(other), min_offset=-1e9, audio_alone=False)
    assert res["id"] is None


def test_duplicate_check_finds_a_reupload(library):
    ix = scan_fp.build_index([(11, library["feats"][11]), (22, library["feats"][22])])
    res = scan_fp.identify(ix, scan_fp.query_from_video(library["feats"][22]), min_offset=-1e9, audio_alone=False)
    assert res["id"] == 22


def _thumbnail(path, t):
    cap = cv2.VideoCapture(str(path))
    cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
    ok, frame = cap.read()
    assert ok
    _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 60])  # a compressed preview picture
    return cv2.imdecode(buf, cv2.IMREAD_GRAYSCALE)


def test_a_preview_picture_finds_its_video_or_says_nothing(library):
    found = 0
    for seed in (11, 22, 33):
        for t in (0.5, 2.0, 4.0):
            res = scan_fp.identify_still(library["ix"], _thumbnail(library["paths"][seed], t))
            assert res["id"] in (None, seed), res  # never a wrong video
            found += res["id"] == seed
    assert found >= 3  # and it does find some


def test_a_preview_picture_of_a_stranger_is_not_found(library):
    for t in (0.5, 2.0, 4.0):
        assert scan_fp.identify_still(library["ix"], _thumbnail(library["stranger"], t))["id"] is None


def test_a_blank_picture_is_not_found(library):
    assert scan_fp.identify_still(library["ix"], np.zeros((100, 100), np.uint8))["id"] is None


def test_dynamic_map_separates_a_shared_template_from_what_changes():
    rng = np.random.default_rng(3)
    frames = []
    for i in range(8):
        g = np.full((200, 200), 120, np.uint8)
        g[:, :100] = rng.integers(0, 255, (200, 100))  # left half changes every frame
        g[:, 100:] = 120                               # right half is a fixed template
        frames.append(g)
    m = scan_fp.dynamic_map(frames)
    assert m[:, :90].mean() > 0.9 and m[:, 120:].mean() < 0.05
    assert scan_fp.dynamic_map(frames[:2]) is None


def test_a_match_only_on_a_shared_template_is_rejected():
    """Same template, different content: the still details agree, the changing ones do not."""
    rng = np.random.default_rng(4)
    pts = rng.uniform(0, 400, (120, 3)).astype(np.float32)
    des = rng.integers(0, 255, (120, 128)).astype(np.uint8)
    pts[:, 2] = 0.0                                    # every detail sits on the still template
    pts[:12, 2] = 1.0                                  # ...except a few on the changing part
    qa, qd = pts.copy(), des.copy()
    ia, idd = pts.copy(), des.copy()
    # identical pictures: all details agree, including the changing ones -> a match
    assert scan_fp.sift_match(qa, qd, ia, idd)[0] >= scan_fp.SIFT_INLIERS
    # the changing details differ (other content), the template is the same -> not a match
    qd2 = qd.copy()
    qd2[:12] = rng.integers(0, 255, (12, 128)).astype(np.uint8)
    assert scan_fp.sift_match(qa, qd2, ia, idd)[0] == 0


def test_template_like_means_a_picture_that_hardly_changes():
    rng = np.random.default_rng(5)
    base = rng.integers(0, 256, 8, dtype=np.uint8)
    still = np.tile(base, (12, 1))
    still[3, 0] ^= 0b00000111  # a tiny flicker in one frame
    moving = rng.integers(0, 256, (12, 8), dtype=np.uint8)
    assert scan_fp.is_template_like(still)
    assert not scan_fp.is_template_like(moving)
    assert not scan_fp.is_template_like(still[:3])  # too few frames to tell


def test_block_check_sees_other_numbers_but_not_noise():
    import cv2

    rng = np.random.default_rng(7)

    def screen(texts):
        g = np.full((480, 216), 20, np.uint8)
        for i, t in enumerate(texts):
            cv2.putText(g, t, (10, 40 + i * 24), cv2.FONT_HERSHEY_SIMPLEX, 0.6, 230, 1, cv2.LINE_AA)
        return g

    rows = [f"{a}.{b:02d} USD" for a, b in zip(range(50, 70), range(20, 60, 2))]
    other = [f"{a}.{b:02d} EUR" for a, b in zip(range(30, 50), range(61, 21, -2))]
    orig = screen(rows)
    ident = np.eye(2, 3, dtype=np.float32)
    noisy = np.clip(orig.astype(int) + rng.normal(0, 6, orig.shape), 0, 255).astype(np.uint8)
    bad, used, _ = scan_fp._block_disagreement(noisy, orig, ident)
    assert used >= scan_fp.PIX_MIN_BLOCKS and bad <= scan_fp.PIX_BAD_MAX
    bad, used, _ = scan_fp._block_disagreement(screen(other), orig, ident)
    assert bad > scan_fp.PIX_BAD_MAX


def test_text_agreement_tells_other_numbers_from_the_same_numbers():
    def words(rows):
        return [(t, 20 + 60 * j, 40 + 30 * i) for i, row in enumerate(rows) for j, t in enumerate(row.split())]

    base = [f"usdchf buy 0.10 {50 + i}.{i:02d} 0.77{500 + i}" for i in range(12)]
    other = [f"eurusd sell 0.50 {70 + i}.{i * 3:02d} 1.08{100 + i}" for i in range(12)]
    ident = np.eye(2, 3, dtype=np.float32)
    assert scan_fp._text_agreement(words(base), words(base), 1.0, ident) >= 0.99
    assert scan_fp._text_agreement(words(other), words(base), 1.0, ident) < 0.5
    assert scan_fp._text_agreement(words(base[:1]), words(base), 1.0, ident) is None  # too little text to say


def test_split_numbers_are_joined_before_comparing():
    lines = scan_fp._lines([("5", 10, 40), ("000.00", 40, 40)], 1.0)
    assert list(lines.values()) == [["5000.00"]]


def test_a_mostly_still_video_with_a_few_other_screens_is_template_like():
    rng = np.random.default_rng(9)
    base = rng.integers(0, 256, 8, dtype=np.uint8)
    h = np.tile(base, (20, 1))
    h[10:] = rng.integers(0, 256, (10, 8), dtype=np.uint8)  # half the frames are other screens
    assert scan_fp.is_template_like(h)
    h[6:] = rng.integers(0, 256, (14, 8), dtype=np.uint8)  # only 30% still: an ordinary video
    assert not scan_fp.is_template_like(h)
