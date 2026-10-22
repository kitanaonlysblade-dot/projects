"""Video matcher for "scan a video": which uploaded video is this recording of?

Pure signal processing (numpy / scipy / OpenCV / ffmpeg) with no database in it, so it can be tested alone.
Every number below was tuned on synthetic videos in a standalone prototype - see README ("Scan"). They are a
starting point, NOT a promise: re-check them on real screen recordings before relying on the answers.

The cascade, cheapest first. It prefers "not found" to a wrong answer:

  1  sound      Shazam-style constellation hashes. A unique, strong audio match is accepted on its own.
  2  frames     64-bit DCT fingerprints of whole frames, lined up in time (audio candidates first, then all).
  2b cells      the same per 4x4 grid cell, so a caption or button column only knocks out the cells it covers.
  3  details    ORB local features + RANSAC on a few key frames: survives crops and overlays.
  4  combined   no single check was sure, but two DIFFERENT kinds of evidence agree on the same video and moment.

Both mirrored and normal recordings are tried (some apps flip video).

Two feature sets:
  VideoFeatures  computed once per UPLOADED video and stored (see app/scan_service.py).
  QueryFeatures  computed from a RECORDING being looked up. This is the part a phone could compute itself and send,
                 instead of the recording, so that the recording never leaves the device.
"""
import io
import json
import os
import re
import shutil
import subprocess
from dataclasses import dataclass, field

import cv2
import numpy as np
from scipy.ndimage import maximum_filter
from scipy.signal import stft

# Bump when anything that changes a stored fingerprint changes (stored rows are then rebuilt by --backfill).
# "grid2" added SIFT key-frame features; "grid3" marks which details sit on changing parts of the picture (so a shared
# template cannot match two different videos). Rows of an older version stay searchable until they are rebuilt.
FP_VERSION = "grid3"
FP_COMPATIBLE = ("grid1", "grid2", "grid3")

SR = 22050
STATIC_HAM = 12         # a frame this close to the video's typical picture counts as 'the same layout' (see is_template_like)
STATIC_SHARE = 0.4      # a video with at least this share of such frames is "template-like"
PIX_BLOCKS = (16, 20)   # pixel check: the picture is compared in 16 x 20 blocks
PIX_BAD_NCC = 0.5       # a block whose detail correlates less than this with the original disagrees
PIX_BAD_MAX = 1         # at most this many blocks may disagree with the original (other content shows up as several)
PIX_COVER_MAX = 0.4     # a block the recording shows flat (an opaque overlay) is not compared; more than this share of them: no verdict
PIX_FRAMES = 6          # recording frames compared
PIX_ORIG_FRAMES = 40    # original key frames each is aligned against (the best-fitting one is used: a still video drifts)
PIX_MIN_BLOCKS = 20     # fewer detailed blocks than this: nothing to compare, so it does not count as agreement
PIX_ORIG_FPS = 24       # moving videos: around where a recording frame belongs the original is read this finely, so a moving subject is compared at the right instant
PIX_FINE_SPREAD = 0.5   # ...and the fine offsets of the recording's frames must agree this closely (seconds)
PIX_MOVING = 6.0        # a video whose consecutive 1 s frames differ by more than this (mean grey levels) moves; a still screen (a chart, a slide) is under about 3
PIX_NEAR = 1.0          # once the offset is known, each recording frame is compared with original frames this close (seconds) to where it should be
PIX_DYN_WEIGHT = 2      # a disagreeing block on a part of the picture that moves in the original (hands, the product) counts this much
CELL_SUSPECT = 0.25     # a match found by 4x4 cells alone with at least this share of the picture still disagreeing needs the pixel check
PIX_EDGE = (0.10, 0.32, 0.20)  # a recording of an app's feed carries its buttons, caption and bars around the video: the top 10%, bottom 32% and right 20% of the recording are not compared
RECT_STD = 7.0          # video-area search: a pixel "moves" when its brightness varies this much over the clip
RECT_MIN_AREA = 0.06    # ...the moving area must be at least this share of the screen
RECT_MIN_FILL = 0.55    # ...and fill at least this share of its own bounding box (a video is a solid rectangle; scattered motion is not)
RECT_FULL = 0.92        # a box covering this much of both width and height is the whole screen: nothing to cut
HAM_MAX = 12            # frame hashes this close count as the same frame
FRAME_MIN = 3           # aligned frames needed at least
FRAME_FRAC = 0.35       # ...or this fraction of the query's frames
FRAME_MARGIN = 2        # winner must beat the runner-up by this many frames
ORB_INLIERS = 25        # RANSAC inliers for one frame pair to count
ORB_RATIO = 1.8         # ...and the best video must have this many times the runner-up's inliers
ORB_MIN_FRAMES = 3      # query frames that must agree on one video AND one time offset
ORB_TOL = 1.0           # seconds: offsets must agree this closely (stored key frames are 1 s apart, so one frame's offset can be off by half that)
ORB_ZOOM_TOL = 0.35     # log2 zoom: the frames of one recording must map onto the original with the same zoom (0.35 = a 27% difference)
ORB_TURN_TOL = 8.0      # degrees: ...and the same tilt
ORB_QUERY_TRY = 24      # recording frames tried for local features...
ORB_QUERY_KEEP = 14     # ...and at most this many of the ones that have enough detail are kept
ORB_QUERY_FAST = 8      # keypoint sensitivity for a recording (stored videos use 12): recordings are softer, and plain scenes need it
SIFT_N_INDEX = 250      # SIFT features kept per stored key frame
SIFT_N_QUERY = 500      # ...and per recording key frame (more is free: nothing is stored)
SIFT_CT = 0.02          # SIFT contrast threshold (default 0.04): dim, soft pictures need the lower value
SIFT_RATIO = 0.8        # Lowe's ratio test
SIFT_INLIERS = 18       # RANSAC inliers for one frame pair to count (SIFT gives ~3x the inliers of ORB on real footage)
SIFT_FULL_SEARCH_MAX = int(os.environ.get("SCAN_SIFT_FULL_SEARCH_MAX", "12000"))  # key frames searched (with the shortlist below); above this only other stages' candidates are checked
SIFT_BRUTE_MAX = 150    # up to this many key frames every one is compared in full (small libraries: most accurate)
SIFT_SKETCH = 64        # strongest details per stored key frame kept in the in-memory shortlist index
SIFT_COARSE_Q = 200     # strongest details of a recording frame used to shortlist stored key frames
SIFT_COARSE_K = 20      # shortlisted key frames per recording frame that get the full check
SIFT_COARSE_RATIO = 0.95  # nearest/second-nearest distance ratio for a shortlist vote
SIFT_COARSE_MIN = 1     # votes a key frame needs to be shortlisted
DYN_STD = 6.0           # a pixel "changes" when its brightness varies this much over the clip
DYN_MIN_FEATS = 8       # a picture with fewer changing details than this is treated as still (no change check)
DYN_INLIERS = 6         # matched details that sit on changing parts of BOTH pictures, needed besides SIFT_INLIERS
MIN_OFFSET = -0.3       # a recording can't start before the original does
ALIGN_BIN = 0.5         # seconds: offset tolerance (covers small speed changes)
GRID = 4                # picture cut into GRID x GRID cells
CELL_HAM = 2            # a cell "agrees" when its 16-bit fingerprints differ in at most this many bits
CELL_MIN = 5            # a frame pair counts when at least this many cells agree
CELL_STD = 5.0          # cells with almost no detail (plain wall, black bar) don't vote
COVER_FRAC = 0.7        # a cell is "covered" when it disagrees in this share of the lined-up frame pairs
FUSE_MIN_FRAMES = 2     # weak evidence: this many frames agree on a video...
FUSE_MARGIN = 1         # ...and it beats the runner-up by this many
FUSE_OFFSET_TOL = 1.0   # seconds: different kinds of evidence must agree on the moment this closely
AUDIO_THR = 10          # aligned audio votes for a video to count as an audio candidate
# Local-feature matching compares every key frame against every stored key frame, so it slows down as the library
# grows. Above this many stored key frames it only looks at videos the sound or the frame fingerprints already
# pointed at. Raise it if you have the CPU for it; real scale needs a proper nearest-neighbour index.
ORB_FULL_SEARCH_MAX = int(os.environ.get("SCAN_ORB_FULL_SEARCH_MAX", "20000"))

_POP = np.array([bin(i).count("1") for i in range(256)], np.uint8)


# ------------------------------------------------------------------ ffmpeg
def find_exe(name: str) -> str:
    """ffmpeg/ffprobe on PATH, or in the folder named by FFMPEG_DIR."""
    p = shutil.which(name)
    if not p and os.environ.get("FFMPEG_DIR"):
        p = shutil.which(name, path=os.environ["FFMPEG_DIR"])
    if not p:
        raise RuntimeError(f"'{name}' was not found. Install ffmpeg (or set FFMPEG_DIR).")
    return p


def _sh(cmd: list[str]) -> bytes:
    cmd = [find_exe(cmd[0])] + list(cmd[1:])
    return subprocess.run(cmd, check=True, capture_output=True, timeout=300).stdout


def clip_seconds(path) -> float | None:
    try:
        out = _sh(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)])
        return round(float(out.decode().strip()), 1)
    except Exception:
        pass
    # A browser's MediaRecorder writes WebM with no length in its header: read it by decoding to nowhere.
    try:
        err = subprocess.run(
            [find_exe("ffmpeg"), "-v", "error", "-stats", "-i", str(path), "-f", "null", "-"],
            capture_output=True, timeout=120,
        ).stderr.decode(errors="ignore")
        times = re.findall(r"time=(\d+):(\d+):(\d+(?:\.\d+)?)", err.replace("\r", "\n"))
        if times:
            h, m, sec = times[-1]
            return round(int(h) * 3600 + int(m) * 60 + float(sec), 1)
    except Exception:
        pass
    return None


def read_audio(path) -> np.ndarray:
    try:
        raw = _sh(["ffmpeg", "-v", "error", "-i", str(path), "-vn", "-ac", "1", "-ar", str(SR), "-f", "s16le", "-"])
    except subprocess.CalledProcessError:
        raw = b""  # a silent video has no audio stream
    return np.frombuffer(raw, np.int16).astype(np.float32) / 32768 if raw else np.zeros(0, np.float32)


def _probe_size(path) -> tuple[int, int]:
    j = json.loads(_sh(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", str(path)]))
    s = j["streams"][0]
    return int(s["width"]), int(s["height"])


def read_frames(path, fps: float, height: int = 480, start: float | None = None, dur: float | None = None) -> tuple[list[np.ndarray], list[float]]:
    """Gray frames at `fps`, scaled to `height`. -> (frames, times in seconds). `start`/`dur` read only that stretch
    (times are then still seconds into the video)."""
    w, h = _probe_size(path)
    nw = int(round(w * height / h / 2)) * 2
    cmd = ["ffmpeg", "-v", "error"]
    if start is not None:
        cmd += ["-ss", f"{max(0.0, start):.3f}"]
    cmd += ["-i", str(path)]
    if dur is not None:
        cmd += ["-t", f"{dur:.3f}"]
    raw = _sh(cmd + ["-vf", f"fps={fps},scale={nw}:{height}", "-pix_fmt", "gray", "-f", "rawvideo", "-"])
    n = len(raw) // (nw * height)
    arr = np.frombuffer(raw[: n * nw * height], np.uint8).reshape(n, height, nw)
    t0 = max(0.0, start) if start is not None else 0.0
    return [arr[i] for i in range(n)], [t0 + i / fps for i in range(n)]


# ------------------------------------------------------------------ fingerprints
def audio_hashes(y: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """(hash, anchor_frame) pairs. Frame hop = 512 samples = 23 ms."""
    if len(y) < SR // 2 or float(np.abs(y).max()) < 1e-3:
        return np.zeros(0, np.int64), np.zeros(0, np.int32)
    _, _, Z = stft(y, SR, nperseg=1024, noverlap=512)
    S = np.log1p(np.abs(Z[8:260]) * 50)
    mx = maximum_filter(S, size=(17, 11)) == S
    mx &= S > np.percentile(S, 92)
    fi, ti = np.nonzero(mx)
    order = np.argsort(ti, kind="stable")
    fi, ti = fi[order] + 8, ti[order]
    H, T = [], []
    n = len(ti)
    for i in range(n):
        for j in range(i + 1, min(n, i + 8)):
            dt = ti[j] - ti[i]
            if dt < 3:
                continue
            if dt > 90:
                break
            H.append((int(fi[i]) << 18) | (int(fi[j]) << 7) | int(dt))
            T.append(ti[i])
    return np.array(H, np.int64), np.array(T, np.int32)


def trim_box(g: np.ndarray) -> tuple[int, int, int, int]:
    """(row0, row1, col0, col1) of the picture without bars and borders: rows/columns with almost no variation."""
    rows = np.nonzero(g.std(axis=1) > 6)[0]
    cols = np.nonzero(g.std(axis=0) > 6)[0]
    if len(rows) < g.shape[0] * 0.3 or len(cols) < g.shape[1] * 0.3:
        return 0, g.shape[0], 0, g.shape[1]
    return int(rows[0]), int(rows[-1] + 1), int(cols[0]), int(cols[-1] + 1)


def trim_borders(g: np.ndarray) -> np.ndarray:
    """Cut bars and borders: rows/columns with almost no variation (letterboxing, UI chrome)."""
    r0, r1, c0, c1 = trim_box(g)
    return g[r0:r1, c0:c1]


def dynamic_map(frames):
    """Which parts of the picture change over the clip? -> bool array like one frame, or None when there are too few
    frames to tell. A template shared by many videos (a trading chart's grid and labels, a creator's caption or logo)
    never changes; the part that does is what tells one video from another."""
    if len(frames) < 4:
        return None
    a = np.stack([f[::2, ::2].astype(np.float32) for f in frames])
    moving = (a.std(axis=0) > DYN_STD).astype(np.float32)
    moving = cv2.blur(moving, (9, 9)) > 0.2
    return cv2.resize(moving.astype(np.uint8), (frames[0].shape[1], frames[0].shape[0]), interpolation=cv2.INTER_NEAREST).astype(bool)


def phash(g: np.ndarray) -> np.ndarray:
    g = trim_borders(g)
    s = cv2.resize(g, (32, 32), interpolation=cv2.INTER_AREA).astype(np.float32)
    d = cv2.dct(s)[:8, :8].flatten()
    return np.packbits(d > np.median(d[1:]))


def cell_hashes(g: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """-> ((GRID*GRID, 2) uint8 fingerprints, (GRID*GRID,) bool 'has enough detail to be trusted')."""
    g = trim_borders(g)
    s = cv2.resize(g, (GRID * 16, GRID * 16), interpolation=cv2.INTER_AREA).astype(np.float32)
    hs, ok = [], []
    for r in range(GRID):
        for c in range(GRID):
            b = s[r * 16:(r + 1) * 16, c * 16:(c + 1) * 16]
            d = cv2.dct(b)[:4, :4].flatten()
            hs.append(np.packbits(d > np.median(d[1:])))
            ok.append(b.std() > CELL_STD)
    return np.array(hs, np.uint8), np.array(ok, bool)


def orb_feats(g: np.ndarray, n: int = 300, fast: int = 12, enhance: bool = False):
    if enhance:
        # Local contrast boost: a dark, soft picture (a night scene, a heavily compressed repost) has almost no
        # corners for ORB until its contrast is stretched. Only used on the recording, so stored fingerprints stay valid.
        g = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(4, 4)).apply(g)
    kp, des = cv2.ORB_create(nfeatures=n, fastThreshold=fast).detectAndCompute(g, None)
    if des is None or len(kp) < 8:
        return None, None
    return np.float32([k.pt for k in kp]), des


def orb_match(qa, qd, ia, idd) -> tuple[int, float, float]:
    """-> (RANSAC inliers, log2 of the zoom between the two pictures, turn in degrees). 0 inliers = no match."""
    if qd is None or idd is None:
        return 0, 0.0, 0.0
    m = cv2.BFMatcher(cv2.NORM_HAMMING).knnMatch(qd, idd, k=2)
    good = [x[0] for x in m if len(x) == 2 and x[0].distance < 0.78 * x[1].distance]
    if len(good) < 8:
        return 0, 0.0, 0.0
    src = qa[[g.queryIdx for g in good]]
    dst = ia[[g.trainIdx for g in good]]
    M, inl = cv2.estimateAffinePartial2D(src, dst, method=cv2.RANSAC, ransacReprojThreshold=6.0)
    if inl is None or M is None:
        return 0, 0.0, 0.0
    zoom = float(np.hypot(M[0, 0], M[1, 0]))
    return int(inl.sum()), float(np.log2(max(zoom, 1e-6))), float(np.degrees(np.arctan2(M[1, 0], M[0, 0])))


def orb_inliers(qa, qd, ia, idd) -> int:
    return orb_match(qa, qd, ia, idd)[0]


SPREAD_MIN = 0.04       # the matched details must cover this share of the picture (a shared caption or watermark is a thin strip)


def _spread_ok(dst, inl, all_pts) -> bool:
    """A real match is spread over the picture; two different videos that carry the same burned-in caption, logo or
    watermark only agree inside that small area. dst: matched points in the stored frame, inl: RANSAC inlier mask."""
    pts = dst[np.asarray(inl).ravel() > 0]
    if len(pts) < 4 or len(all_pts) < 4:
        return False
    span = lambda a: np.percentile(a, 90) - np.percentile(a, 10)  # noqa: E731
    full = max(np.ptp(all_pts[:, 0]) * np.ptp(all_pts[:, 1]), 1.0)
    return span(pts[:, 0]) * span(pts[:, 1]) >= SPREAD_MIN * full


_BF_L2 = cv2.BFMatcher(cv2.NORM_L2)
_QSCALE = 512.0


def sift_feats(g: np.ndarray, n: int = SIFT_N_INDEX, dyn=None):
    """RootSIFT key points of one grey picture -> (points float32 (K,3), descriptors uint8 (K,128)) or (None, None).
    The third column of the points is 1 when the detail sits on a part of the picture that changes over the clip, 0 when
    it is still (see dynamic_map) and -1 when that is not known. `dyn` is a bool array like g.
    RootSIFT (square root of the L1-normalised SIFT) matches better than plain SIFT; stored as uint8 to stay small."""
    kp, d = cv2.SIFT_create(nfeatures=n, contrastThreshold=SIFT_CT).detectAndCompute(g, None)
    if d is None or len(kp) < 8:
        return None, None
    d = np.sqrt(d / (d.sum(axis=1, keepdims=True) + 1e-7))
    o = np.argsort([-k.response for k in kp], kind="stable")  # strongest first: the shortlist uses the first few
    xy = np.float32([kp[i].pt for i in o])
    if dyn is None:
        flag = np.full(len(xy), -1.0, np.float32)
    else:
        xi = np.clip(xy[:, 0].astype(int), 0, dyn.shape[1] - 1)
        yi = np.clip(xy[:, 1].astype(int), 0, dyn.shape[0] - 1)
        flag = dyn[yi, xi].astype(np.float32)
    return np.concatenate([xy, flag[:, None]], axis=1), np.clip(np.rint(d[o] * _QSCALE), 0, 255).astype(np.uint8)


def sift_match(qa, qd, ia, idd) -> tuple[int, float, float]:
    """Same answer as orb_match, for RootSIFT features: (RANSAC inliers, log2 zoom, turn in degrees)."""
    if qd is None or idd is None:
        return 0, 0.0, 0.0
    m = _BF_L2.knnMatch(qd.astype(np.float32), idd.astype(np.float32), k=2)
    good = [x[0] for x in m if len(x) == 2 and x[0].distance < SIFT_RATIO * x[1].distance]
    if len(good) < 8:
        return 0, 0.0, 0.0
    qa, ia = np.asarray(qa, np.float32), np.asarray(ia, np.float32)
    qi, ti = [g.queryIdx for g in good], [g.trainIdx for g in good]
    src, dst = qa[qi, :2], ia[ti, :2]
    M, inl = cv2.estimateAffinePartial2D(src, dst, method=cv2.RANSAC, ransacReprojThreshold=6.0)
    if inl is None or M is None:
        return 0, 0.0, 0.0
    if not _spread_ok(dst, inl, ia[:, :2]):
        return 0, 0.0, 0.0
    if qa.shape[1] > 2 and ia.shape[1] > 2 and (qa[:, 2] > 0.5).sum() >= DYN_MIN_FEATS and (ia[:, 2] > 0.5).sum() >= DYN_MIN_FEATS:
        # Both pictures have parts that change: a real match must agree THERE too, not only on a shared template.
        on = np.asarray(inl).ravel() > 0
        dyn_inl = int(((qa[qi, 2] > 0.5) & (ia[ti, 2] > 0.5) & on).sum())
        if dyn_inl < DYN_INLIERS:
            return 0, 0.0, 0.0
    zoom = float(np.hypot(M[0, 0], M[1, 0]))
    return int(inl.sum()), float(np.log2(max(zoom, 1e-6))), float(np.degrees(np.arctan2(M[1, 0], M[0, 0])))


def viewport_box(frames):
    """Where the video itself is inside a screen recording: the rows and columns that change over time. The phone's
    status bar, the app's tab bar and the browser bar never change, so they are cut away and cannot fool the match.
    -> (row0, row1, col0, col1) or None when nothing moves enough to tell (a still picture, a dark clip)."""
    if len(frames) < 6:
        return None
    a = np.stack([f[::2, ::2].astype(np.float32) for f in frames])
    moving = a.std(axis=0) > 7
    rows = np.nonzero(moving.mean(axis=1) > 0.35)[0]
    cols = np.nonzero(moving.mean(axis=0) > 0.35)[0]
    if len(rows) < 0.3 * moving.shape[0] or len(cols) < 0.3 * moving.shape[1]:
        return None
    return rows[0] * 2, (rows[-1] + 1) * 2, cols[0] * 2, (cols[-1] + 1) * 2


def find_video_rect(frames):
    """Where a video plays inside a bigger screen (a desktop browser: a page, a header and a comments column around a
    video in the middle). The largest SOLID rectangle of change over the clip: the video changes everywhere inside its
    frame and nowhere outside it, while things beside it (a scrolling comments list, a clock) are smaller or ragged.
    -> (row0, row1, col0, col1) in the frames' own pixels, or None when there is nothing to cut (the video fills the
    screen) or nothing moves enough to tell (a still picture, a dark clip)."""
    if len(frames) < 6:
        return None
    h, w = frames[0].shape[:2]
    a = np.stack([f[::2, ::2].astype(np.float32) for f in frames])
    moving = (a.std(axis=0) > RECT_STD).astype(np.uint8)
    moving = cv2.morphologyEx(moving, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8), iterations=2)
    moving = cv2.morphologyEx(moving, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    n, lab, stats, _ = cv2.connectedComponentsWithStats(moving, 8)
    if n <= 1:
        return None
    i = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    x, y, bw, bh, area = (int(v) for v in stats[i])
    if area < RECT_MIN_AREA * moving.size or area < RECT_MIN_FILL * bw * bh:
        return None
    sub = lab[y:y + bh, x:x + bw] == i
    rows = np.nonzero(sub.mean(axis=1) > 0.5)[0]  # drop thin spikes sticking out of the rectangle
    cols = np.nonzero(sub.mean(axis=0) > 0.5)[0]
    if len(rows) == 0 or len(cols) == 0:
        return None
    r0, r1, c0, c1 = (y + rows[0]) * 2, (y + rows[-1] + 1) * 2, (x + cols[0]) * 2, (x + cols[-1] + 1) * 2
    r1, c1 = min(r1, h), min(c1, w)
    if (r1 - r0) >= RECT_FULL * h and (c1 - c0) >= RECT_FULL * w:
        return None
    if r1 - r0 < 48 or c1 - c0 < 48:
        return None
    return int(r0), int(r1), int(c0), int(c1)


def detect_rect(path):
    """find_video_rect for a recording file, in the coordinates extract_query(path, crop=...) expects."""
    try:
        frames, _ = read_frames(path, 4)
    except Exception:
        return None
    return find_video_rect(frames)


# ------------------------------------------------------------------ features of an uploaded video (stored)
@dataclass
class VideoFeatures:
    duration: float
    a_hash: np.ndarray            # int64
    a_t: np.ndarray               # int32 audio frame of each hash
    f_hash: np.ndarray            # (N, 8) uint8, frames at 2 fps
    f_cell: np.ndarray            # (N, GRID*GRID, 2) uint8
    f_ok: np.ndarray              # (N, GRID*GRID) bool
    f_t: np.ndarray               # (N,) float32 seconds
    orb: list = field(default_factory=list)   # [(t, pts (K,2) float32, des (K,32) uint8)] at 1 fps
    sift: list = field(default_factory=list)  # [(t, pts (K,2) float32, des (K,128) uint8 RootSIFT)] at 1 fps


def extract_video(path) -> VideoFeatures:
    h, t = audio_hashes(read_audio(path))
    frames, times = read_frames(path, 2)
    fh, fc, fo = [], [], []
    for g in frames:
        fh.append(phash(g))
        c, o = cell_hashes(g)
        fc.append(c)
        fo.append(o)
    orb, sift = [], []
    frames1, times1 = read_frames(path, 1)
    dyn_full = dynamic_map(frames1)
    for g, tt in zip(frames1, times1):
        r0, r1, c0, c1 = trim_box(g)
        g = g[r0:r1, c0:c1]
        pts, des = orb_feats(g)
        if des is not None:
            orb.append((float(tt), pts, des))
        pts, des = sift_feats(g, dyn=None if dyn_full is None else dyn_full[r0:r1, c0:c1])
        if des is not None:
            sift.append((float(tt), pts, des))
    n_cells = GRID * GRID
    return VideoFeatures(
        duration=float(times[-1] + 0.5) if times else 0.0,
        a_hash=h, a_t=t,
        f_hash=np.array(fh, np.uint8).reshape(-1, 8),
        f_cell=np.array(fc, np.uint8).reshape(-1, n_cells, 2),
        f_ok=np.array(fo, bool).reshape(-1, n_cells),
        f_t=np.array(times, np.float32),
        orb=orb, sift=sift,
    )


def pack(f: VideoFeatures) -> bytes:
    """Compact bytes for the database (np.savez_compressed; no pickle, so loading untrusted bytes is safe)."""
    buf = io.BytesIO()
    counts = np.array([len(p) for _, p, _ in f.orb], np.int32)
    np.savez_compressed(
        buf, duration=np.float64(f.duration), a_hash=f.a_hash, a_t=f.a_t, f_hash=f.f_hash, f_cell=f.f_cell,
        f_ok=f.f_ok, f_t=f.f_t,
        orb_t=np.array([t for t, _, _ in f.orb], np.float32), orb_n=counts,
        orb_pts=np.concatenate([p for _, p, _ in f.orb]) if f.orb else np.zeros((0, 2), np.float32),
        orb_des=np.concatenate([d for _, _, d in f.orb]) if f.orb else np.zeros((0, 32), np.uint8),
        sift_t=np.array([t for t, _, _ in f.sift], np.float32), sift_n=np.array([len(p) for _, p, _ in f.sift], np.int32),
        sift_pts=np.concatenate([p for _, p, _ in f.sift]).astype(np.float16) if f.sift else np.zeros((0, 3), np.float16),
        sift_des=np.concatenate([d for _, _, d in f.sift]) if f.sift else np.zeros((0, 128), np.uint8),
    )
    return buf.getvalue()


def unpack(blob: bytes) -> VideoFeatures:
    z = np.load(io.BytesIO(blob), allow_pickle=False)
    orb, at = [], 0
    for t, n in zip(z["orb_t"], z["orb_n"]):
        n = int(n)
        orb.append((float(t), z["orb_pts"][at:at + n], z["orb_des"][at:at + n]))
        at += n
    sift, at = [], 0
    if "sift_t" in z.files:  # rows stored before "grid2" have none
        for t, n in zip(z["sift_t"], z["sift_n"]):
            n = int(n)
            pts = z["sift_pts"][at:at + n].astype(np.float32)
            if pts.shape[1] == 2:  # stored before the "changing part" flag existed: unknown
                pts = np.concatenate([pts, np.full((len(pts), 1), -1.0, np.float32)], axis=1)
            sift.append((float(t), pts, z["sift_des"][at:at + n]))
            at += n
    return VideoFeatures(float(z["duration"]), z["a_hash"], z["a_t"], z["f_hash"], z["f_cell"], z["f_ok"], z["f_t"], orb, sift)


# ------------------------------------------------------------------ the searchable library
@dataclass
class Index:
    ids: list = field(default_factory=list)        # one id per video, in the order added
    a_hash: np.ndarray = None
    a_vid: np.ndarray = None
    a_t: np.ndarray = None
    f_hash: np.ndarray = None
    f_cell: np.ndarray = None
    f_ok: np.ndarray = None
    f_vid: np.ndarray = None
    f_t: np.ndarray = None
    orb: list = field(default_factory=list)        # (video index, t, pts, des): only videos stored without SIFT
    sift: list = field(default_factory=list)       # (video index, t, pts, des)
    sk: np.ndarray = None                          # (M, 128) float16: the strongest details of every SIFT key frame
    sk_entry: np.ndarray = None                    # (M,) which ix.sift entry each of them belongs to
    templ: list = field(default_factory=list)      # one bool per video: is_template_like


def is_template_like(f_hash: np.ndarray) -> bool:
    """True when the picture is the same layout for much of the clip (a trading screen, a chat, a slide, a talking head
    in front of a fixed backdrop), even if a few other screens come and go. The whole-frame fingerprint of such a video
    equals that of every other video made from the same template and cannot tell them apart; only the small parts that
    differ can, and those are checked in the actual pixels and words (confirm_recording). Ordinary moving videos have
    at most about a fifth of their frames close to one typical picture; these have half or more.
    -> False when there are too few frames to tell."""
    if f_hash is None or len(f_hash) < 4:
        return False
    bits = np.unpackbits(f_hash, axis=1)
    typical = (bits.mean(axis=0) >= 0.5).astype(np.uint8)
    dist = (bits != typical).sum(axis=1)
    return bool((dist <= STATIC_HAM).mean() >= STATIC_SHARE)


def build_index(items) -> Index | None:
    """items: iterable of (id, VideoFeatures). None when there is nothing to search."""
    ix = Index()
    ah, av, at, fh, fc, fo, fv, ft = [], [], [], [], [], [], [], []
    for vi, (vid, f) in enumerate(items):
        ix.ids.append(vid)
        ix.templ.append(is_template_like(f.f_hash))
        ah.append(f.a_hash); av.append(np.full(len(f.a_hash), vi, np.int32)); at.append(f.a_t)
        fh.append(f.f_hash); fc.append(f.f_cell); fo.append(f.f_ok)
        fv.append(np.full(len(f.f_hash), vi, np.int32)); ft.append(f.f_t)
        if f.sift:
            for t, pts, des in f.sift:
                ix.sift.append((vi, t, pts, des))
        else:  # stored before "grid2": ORB only, until it is rebuilt
            for t, pts, des in f.orb:
                ix.orb.append((vi, t, pts, des))
    if not ix.ids:
        return None
    if ix.sift:
        ix.sk = np.concatenate([d[:SIFT_SKETCH] for _, _, _, d in ix.sift]).astype(np.float16) / np.float16(_QSCALE)
        ix.sk_entry = np.concatenate([np.full(min(len(d), SIFT_SKETCH), e, np.int32) for e, (_, _, _, d) in enumerate(ix.sift)])

    h = np.concatenate(ah)
    o = np.argsort(h, kind="stable")
    ix.a_hash, ix.a_vid, ix.a_t = h[o], np.concatenate(av)[o], np.concatenate(at)[o]
    ix.f_hash, ix.f_cell, ix.f_ok = np.concatenate(fh), np.concatenate(fc), np.concatenate(fo)
    ix.f_vid, ix.f_t = np.concatenate(fv), np.concatenate(ft)
    return ix


# ------------------------------------------------------------------ features of a recording (the query)
@dataclass
class QueryFeatures:
    clip_s: float | None
    audio: tuple                    # (hashes, anchor frames)
    times: list                     # seconds of each analysed frame (4 per second)
    hashes: dict                    # {mirrored: (Q, 8)}
    cells: dict                     # {mirrored: (cells (Q,16,2), ok (Q,16))}
    orb_t: list                     # seconds of the key frames used for local features
    orb: dict                       # {mirrored: [(pts, des)]}
    sift_t: list = field(default_factory=list)   # seconds of the key frames used for SIFT features
    sift: dict = field(default_factory=dict)     # {mirrored: [(pts, des)]}


def extract_query(path, crop=None) -> QueryFeatures:
    """`crop` = (row0, row1, col0, col1) from detect_rect: only that part of every frame is looked at (the video inside a
    bigger screen). The sound is the whole recording's either way."""
    clip_s = clip_seconds(path)
    audio = audio_hashes(read_audio(path))
    frames, times = read_frames(path, 4)
    if crop is not None:
        r0, r1, c0, c1 = crop
        frames = [np.ascontiguousarray(f[r0:r1, c0:c1]) for f in frames]
    hashes, cells, orb, sift = {}, {}, {}, {}
    # Local features come from the VIDEO part of the screen only (viewport_box cuts the status bar, tab bar, browser
    # bar...). Frames are tried across the whole recording; the ones with no usable detail (a plain wall, a dark
    # shade pulled over the screen) are skipped and the best-spread ones that have some are kept.
    box = viewport_box(frames)
    dyn_full = dynamic_map(frames)

    def region(g, d):
        """(picture, its changing-parts map) of the video area."""
        r0, r1, c0, c1 = box if box is not None else trim_box(g)
        return g[r0:r1, c0:c1], (None if d is None else d[r0:r1, c0:c1])

    def feats(g, d, flip=False):
        g, d = region(g, d)
        if flip:  # the same area, mirrored
            g = np.ascontiguousarray(g[:, ::-1])
            d = None if d is None else np.ascontiguousarray(d[:, ::-1])
        s_ = sift_feats(g, SIFT_N_QUERY, dyn=d)
        # ORB is only used against videos stored before SIFT existed. Each picture twice: as it is, and with its
        # contrast stretched (see orb_feats).
        return s_, [orb_feats(g, fast=ORB_QUERY_FAST), orb_feats(g, n=500, fast=ORB_QUERY_FAST, enhance=True)]

    tries = np.linspace(0, len(frames) - 1, min(ORB_QUERY_TRY, len(frames))).astype(int) if frames else []
    found = []
    for i in tries:
        s_, o_ = feats(frames[i], dyn_full)
        if s_[1] is not None or any(x[1] is not None for x in o_):
            found.append((int(i), s_, o_))
    if len(found) > ORB_QUERY_KEEP:
        found = [found[j] for j in np.linspace(0, len(found) - 1, ORB_QUERY_KEEP).astype(int)]
    pick = [i for i, _, _ in found]
    for mirrored in (False, True):
        fr = [np.ascontiguousarray(g[:, ::-1]) for g in frames] if mirrored else frames
        hashes[mirrored] = np.array([phash(g) for g in fr], np.uint8).reshape(-1, 8)
        cs = [cell_hashes(g) for g in fr]
        cells[mirrored] = (
            np.array([c[0] for c in cs], np.uint8).reshape(-1, GRID * GRID, 2),
            np.array([c[1] for c in cs], bool).reshape(-1, GRID * GRID),
        )
        if not mirrored:
            got = [(s_, o_) for _, s_, o_ in found]
        else:
            got = []
            for i in pick:
                got.append(feats(frames[i], dyn_full, flip=True))
        sift[mirrored] = [s_ for s_, _ in got]
        orb[mirrored] = [x for _, o_ in got for x in o_]
    ot = [times[i] for i in pick for _ in range(2)]
    return QueryFeatures(clip_s, audio, list(times), hashes, cells, ot, orb, [times[i] for i in pick], sift)


# ---- a recording fingerprinted on the phone / in the browser (lumin-app/lib/fingerprint) ------------------------
WIRE_ALGO = 1                 # bump together with the app's fingerprint code when the maths changes
WIRE_MAX_FRAMES = 200         # 4 per second: far more than the longest accepted recording
WIRE_MAX_AUDIO_HASHES = 200_000


def _wire_array(b64: str, dtype, shape_tail: tuple, max_rows: int, what: str) -> np.ndarray:
    import base64
    import binascii

    try:
        raw = base64.b64decode(b64, validate=True)
    except (binascii.Error, ValueError, TypeError):
        raise ValueError(f"{what}: not valid base64")
    item = np.dtype(dtype).itemsize * int(np.prod(shape_tail or (1,)))
    if len(raw) % item:
        raise ValueError(f"{what}: wrong size")
    n = len(raw) // item
    if n > max_rows:
        raise ValueError(f"{what}: too long")
    return np.frombuffer(raw, np.dtype(dtype).newbyteorder("<")).astype(dtype).reshape((n,) + shape_tail)


def query_from_wire(d: dict) -> QueryFeatures:
    """Builds a query from the compact fingerprint a phone computed itself, so the recording never has to be sent.
    It has everything except the local-feature (ORB) key frames, so the cascade's third stage is skipped: that stage
    is what survives crops and overlays, which is why a miss here may be worth a deeper check on the full recording.
    Raises ValueError for anything malformed (the input is untrusted)."""
    if d.get("algo") != WIRE_ALGO:
        raise ValueError("This version of the app is out of date. Please update it.")
    a = d["audio"]
    ah = _wire_array(a["hash"], np.int32, (), WIRE_MAX_AUDIO_HASHES, "audio hashes").astype(np.int64)
    at = _wire_array(a["t"], np.int32, (), WIRE_MAX_AUDIO_HASHES, "audio times")
    if len(ah) != len(at):
        raise ValueError("audio: hashes and times differ in length")
    if len(ah) and (ah.min() < 0 or at.min() < 0):
        raise ValueError("audio: out of range")
    times = [float(t) for t in d["times"]]
    nq = len(times)
    if not 1 <= nq <= WIRE_MAX_FRAMES or any(not (0 <= t < 1000) for t in times):
        raise ValueError("frames: bad count or times")
    hashes, cells = {}, {}
    for key, mirrored in (("0", False), ("1", True)):
        if key not in d["hashes"]:
            continue
        h = _wire_array(d["hashes"][key], np.uint8, (8,), WIRE_MAX_FRAMES, "frame hashes")
        c = _wire_array(d["cells"][key], np.uint8, (GRID * GRID, 2), WIRE_MAX_FRAMES, "cell hashes")
        ok = _wire_array(d["ok"][key], np.uint8, (GRID * GRID,), WIRE_MAX_FRAMES, "cell flags").astype(bool)
        if not (len(h) == len(c) == len(ok) == nq):
            raise ValueError("frames: counts differ")
        hashes[mirrored], cells[mirrored] = h, (c, ok)
    if not hashes:
        raise ValueError("frames: missing")
    clip = d.get("clip_s")
    return QueryFeatures(
        clip_s=round(float(clip), 1) if isinstance(clip, (int, float)) and 0 <= clip < 1000 else None,
        audio=(ah, at), times=times, hashes=hashes, cells=cells,
        orb_t=[], orb={m: [] for m in hashes},
    )


def query_from_video(f: VideoFeatures) -> QueryFeatures:
    """An uploaded video used as a query against the other uploads (duplicate check). Unmirrored only."""
    pick = np.linspace(0, len(f.orb) - 1, min(5, len(f.orb))).astype(int) if f.orb else []
    spick = np.linspace(0, len(f.sift) - 1, min(5, len(f.sift))).astype(int) if f.sift else []
    return QueryFeatures(
        clip_s=round(f.duration, 1), audio=(f.a_hash, f.a_t), times=[float(t) for t in f.f_t],
        hashes={False: f.f_hash}, cells={False: (f.f_cell, f.f_ok)},
        orb_t=[f.orb[i][0] for i in pick], orb={False: [(f.orb[i][1], f.orb[i][2]) for i in pick]},
        sift_t=[f.sift[i][0] for i in spick], sift={False: [(f.sift[i][1], f.sift[i][2]) for i in spick]},
    )


# ------------------------------------------------------------------ stages
def stage1_audio(ix: Index, qh, qt):
    """-> ({video index: aligned votes}, {video index: offset seconds})."""
    if len(qh) == 0:
        return {}, {}
    lo = np.searchsorted(ix.a_hash, qh, "left")
    hi = np.searchsorted(ix.a_hash, qh, "right")
    keys = []
    for q in range(len(qh)):
        if hi[q] > lo[q]:
            vv = ix.a_vid[lo[q]:hi[q]].astype(np.int64)
            off = ((ix.a_t[lo[q]:hi[q]] - qt[q]) // 4).astype(np.int64)  # ~0.093 s bins
            keys.append(vv * 100000 + (off + 20000))
    if not keys:
        return {}, {}
    u, c = np.unique(np.concatenate(keys), return_counts=True)
    best, boff = {}, {}
    for key, n in zip(u, c):
        vi = int(key // 100000)
        if n > best.get(vi, 0):
            best[vi] = int(n)
            boff[vi] = ((int(key % 100000) - 20000) * 4 * 512 / SR)
    return best, boff


def _vote(scores):
    """{video: [(query frame, offset)]} -> (best video, agreeing frames, runner-up, offset)."""
    best = {}
    for vi, lst in scores.items():
        offs = np.array([o for _, o in lst])
        qis = np.array([q for q, _ in lst])
        top, top_off = 0, 0.0
        for o in offs:
            m = np.abs(offs - o) <= ALIGN_BIN
            n = len(set(qis[m].tolist()))
            if n > top:
                top, top_off = n, float(np.median(offs[m]))
        best[vi] = (top, top_off)
    if not best:
        return None, 0, 0, 0.0
    order = sorted(best.items(), key=lambda kv: -kv[1][0])
    v, (s, off) = order[0]
    return v, s, (order[1][1][0] if len(order) > 1 else 0), off


def stage2_frames(ix, qh, qt, restrict, min_offset):
    if len(qh) == 0 or ix.f_hash is None or len(ix.f_hash) == 0:
        return None, 0, 0, 0.0
    D = _POP[qh[:, None, :] ^ ix.f_hash[None, :, :]].sum(axis=2)
    scores = {}
    for qi in range(len(qh)):
        for ni in np.nonzero(D[qi] <= HAM_MAX)[0]:
            vi = int(ix.f_vid[ni])
            if restrict is not None and vi not in restrict:
                continue
            off = float(ix.f_t[ni] - qt[qi])
            if off >= min_offset:
                scores.setdefault(vi, []).append((qi, off))
    return _vote(scores)


def stage2_grid(ix, qc, qok, qt, restrict, min_offset):
    """A frame pair matches when enough CELLS agree, so an overlay only knocks out the cells it covers."""
    if len(qc) == 0 or ix.f_cell is None or len(ix.f_cell) == 0:
        return None, 0, 0, 0.0
    scores = {}
    for qi in range(len(qc)):
        D = _POP[qc[qi][None, :, :] ^ ix.f_cell].sum(axis=2)
        agree = (D <= CELL_HAM) & qok[qi][None, :] & ix.f_ok
        for ni in np.nonzero(agree.sum(axis=1) >= CELL_MIN)[0]:
            vi = int(ix.f_vid[ni])
            if restrict is not None and vi not in restrict:
                continue
            off = float(ix.f_t[ni] - qt[qi])
            if off >= min_offset:
                scores.setdefault(vi, []).append((qi, off))
    return _vote(scores)


def cover_report(ix, vi, off, qc, qok, qt):
    """After a match: the share of the (detailed) picture that keeps disagreeing with the original, or None."""
    sel = np.nonzero(ix.f_vid == vi)[0]
    if len(sel) == 0:
        return None
    ft = ix.f_t[sel]
    dis = np.zeros(GRID * GRID)
    cnt = np.zeros(GRID * GRID)
    for qi in range(len(qc)):
        j = int(np.argmin(np.abs(ft - (qt[qi] + off))))
        if abs(ft[j] - (qt[qi] + off)) > 0.3:
            continue
        n = sel[j]
        both = qok[qi] & ix.f_ok[n]
        D = _POP[qc[qi] ^ ix.f_cell[n]].sum(axis=1)
        dis += both & (D > CELL_HAM)
        cnt += both
    use = cnt >= 2
    if not use.any():
        return None
    return float(((dis[use] / cnt[use]) >= COVER_FRAC).sum() / use.sum())


def frame_ok(s, r, nq) -> bool:
    return s >= max(FRAME_MIN, int(FRAME_FRAC * nq)) and s - r >= FRAME_MARGIN


def sift_shortlist(ix: Index, qdes_list) -> list:
    """Which stored key frames could each recording frame be? Compares the strongest details of the recording frames
    with the strongest details of every stored key frame (matrix products, all frames at once) and lets the
    unambiguous ones vote. -> for each recording frame, the SIFT_COARSE_K entries of ix.sift with the most votes.
    Keeps a search over thousands of key frames fast."""
    if ix.sk is None or len(ix.sk) == 0:
        return [ix.sift for _ in qdes_list]
    parts = [d[:SIFT_COARSE_Q].astype(np.float32) / _QSCALE if d is not None else np.zeros((0, 128), np.float32) for d in qdes_list]
    q = np.concatenate(parts)
    nq, m = len(q), len(ix.sk)
    top_v = np.full((nq, 2), -2.0, np.float32)
    top_i = np.zeros((nq, 2), np.int64)
    step = 10000
    rows = np.arange(nq)
    for st in range(0, m, step):
        sim = q @ ix.sk[st:st + step].astype(np.float32).T
        i1 = sim.argmax(axis=1)
        v1 = sim[rows, i1]
        sim[rows, i1] = -2.0
        i2 = sim.argmax(axis=1)
        v2 = sim[rows, i2]
        cv, ci = np.stack([top_v[:, 0], top_v[:, 1], v1, v2], 1), np.stack([top_i[:, 0], top_i[:, 1], i1 + st, i2 + st], 1)
        o = np.argsort(-cv, axis=1)[:, :2]
        top_v, top_i = np.take_along_axis(cv, o, 1), np.take_along_axis(ci, o, 1)
    dist = np.sqrt(np.maximum(2.0 - 2.0 * top_v, 0.0))
    ok = dist[:, 0] < SIFT_COARSE_RATIO * np.maximum(dist[:, 1], 1e-6)
    out, at = [], 0
    for part in parts:
        n = len(part)
        votes = np.bincount(ix.sk_entry[top_i[at:at + n][ok[at:at + n], 0]], minlength=len(ix.sift))
        best = np.argsort(-votes, kind="stable")[:SIFT_COARSE_K]
        out.append([ix.sift[e] for e in best if votes[e] >= SIFT_COARSE_MIN])
        at += n
    return out


def _local_stage(entries, feats, times, min_offset, restrict, matcher, threshold, shortlist=None):
    """feats: [(pts, des)] for the key frames. -> (best video, agreeing frames, offset).

    Frames only agree when they point at the same video, the same moment AND the same zoom/turn: one recording is one
    fixed picture-in-picture of the original, so its frames all map onto the original the same way. A different shot
    of the same scene (another video that happens to show the same place or photo) zooms and pans differently."""
    hits = {}
    short = shortlist([d for _, d in feats]) if shortlist is not None and restrict is None else None
    for n_, ((pts, des), t) in enumerate(zip(feats, times)):
        if des is None:
            continue
        per = {}
        for vi, ti, ipts, ides in (short[n_] if short is not None else entries):
            if restrict is not None and vi not in restrict:
                continue
            if ti - t < min_offset:
                continue
            n, zoom, turn = matcher(pts, des, ipts, ides)
            if n > per.get(vi, (0, 0, 0, 0))[0]:
                per[vi] = (n, ti - t, zoom, turn)
        if not per:
            continue
        ranked = sorted(per.items(), key=lambda kv: -kv[1][0])
        vi, (n, off, zoom, turn) = ranked[0]
        second = ranked[1][1][0] if len(ranked) > 1 else 0
        if n >= threshold and n >= ORB_RATIO * max(second, 1):
            hits.setdefault(vi, []).append((t, off, n, zoom, turn))
    best = (None, 0, 0.0)
    for vi, lst in hits.items():
        byt = {}
        for h in lst:  # the same frame can appear twice (plain and contrast-stretched): keep its stronger reading
            if h[0] not in byt or h[2] > byt[h[0]][2]:
                byt[h[0]] = h
        lst = list(byt.values())
        for _, o, _, z, a in lst:
            agree = [h for h in lst if abs(h[1] - o) <= ORB_TOL and abs(h[3] - z) <= ORB_ZOOM_TOL and abs(h[4] - a) <= ORB_TURN_TOL]
            if len(agree) > best[1]:
                best = (vi, len(agree), float(np.median([h[1] for h in agree])))
    return best


def stage3_orb(ix, feats, times, min_offset, restrict=None):
    """ORB details, against videos stored before SIFT existed."""
    return _local_stage(ix.orb, feats, times, min_offset, restrict, orb_match, ORB_INLIERS)


def stage3_sift(ix, feats, times, min_offset, restrict=None):
    return _local_stage(ix.sift, feats, times, min_offset, restrict, sift_match, SIFT_INLIERS,
                        (lambda dl: sift_shortlist(ix, dl)) if len(ix.sift) > SIFT_BRUTE_MAX else None)


def fuse(weak):
    """weak: [(kind, video, offset)]. Accept a video when two DIFFERENT kinds of evidence point at it at about the
    same moment."""
    by = {}
    for kind, v, off in weak:
        by.setdefault(v, []).append((kind, off))
    best = None
    for v, lst in by.items():
        for kind, off in lst:
            kinds = {k for k, o in lst if abs(o - off) <= FUSE_OFFSET_TOL}
            if len(kinds) >= 2 and (best is None or len(kinds) > best[0]):
                near = [o for k, o in lst if abs(o - off) <= FUSE_OFFSET_TOL]
                best = (len(kinds), v, float(np.median(near)), sorted(kinds))
    return best


# ------------------------------------------------------------------ the cascade
def identify(ix: Index, q: QueryFeatures, min_offset: float = MIN_OFFSET, audio_alone: bool = True) -> dict:
    """See _identify. Adds templ=True when the answer is a template-like video found by looks alone (not by a unique
    sound): the caller must then confirm it against the real pixels (pixel_check) before believing it."""
    out = _identify(ix, q, min_offset, audio_alone)
    if out.get("id") is not None and not str(out.get("stage", "")).startswith("1 audio"):
        try:
            if ix.templ[ix.ids.index(out["id"])]:
                out["templ"] = True
        except (ValueError, IndexError):
            pass
        # A match found by cells alone while a large share of the picture keeps disagreeing is either an overlay or
        # another video from the same room (a different presenter or product). The fingerprints cannot tell which.
        if str(out.get("stage", "")).startswith("2 cells") and (out.get("covered") or 0.0) >= CELL_SUSPECT:
            out["templ"] = True
    return out


def _identify(ix: Index, q: QueryFeatures, min_offset: float = MIN_OFFSET, audio_alone: bool = True) -> dict:
    """-> dict(id, stage, offset, frames, covered, audio_candidates, clip_s). id is None when nothing is sure enough.

    min_offset: how early in the matched video the query may start. A recording can't start before the original
    (the default); for duplicate checks between two uploads either can be the longer one, so pass a very negative number.
    audio_alone: accept a unique, strong sound match without a visual check. Right for a recording of a video that
    is playing; WRONG for comparing two uploads (two different videos can share a sound), so pass False there.
    """
    out = dict(id=None, stage="none", offset=None, clip_s=q.clip_s)
    if ix is None:
        return out
    weak = {False: [], True: []}
    votes, offs = stage1_audio(ix, *q.audio)
    cand = {v for v, n in votes.items() if n >= AUDIO_THR}
    out["audio_candidates"] = len(cand)
    if cand:
        top = max(cand, key=lambda v: votes[v])
        others = [votes[v] for v in cand if v != top]
        if audio_alone and votes[top] >= 4 * AUDIO_THR and (not others or max(others) < 0.3 * votes[top]):
            out.update(id=ix.ids[top], stage="1 audio (unique)", offset=offs[top])
            return out
        if not others or max(others) < 0.6 * votes[top]:
            for fl in (False, True):
                weak[fl].append(("sound", top, offs[top]))
    nq = len(q.times)
    orientations = [m for m in (False, True) if m in q.hashes]

    for label, restrict in (("2 frames (audio-narrowed)", cand or None), ("2 frames (all)", None)):
        if label.startswith("2 frames (audio") and not cand:
            continue
        for fl in orientations:
            v, s, r, off = stage2_frames(ix, q.hashes[fl], q.times, restrict, min_offset)
            if v is not None and frame_ok(s, r, nq):
                out.update(id=ix.ids[v], stage=label + (" mirrored" if fl else ""), offset=off, frames=s)
                return out
            if v is not None and s >= FUSE_MIN_FRAMES and s - r >= FUSE_MARGIN:
                weak[fl].append(("look", v, off))

    for label, restrict in (("2 cells (audio-narrowed)", cand or None), ("2 cells (all)", None)):
        if label.startswith("2 cells (audio") and not cand:
            continue
        for fl in orientations:
            qc, qok = q.cells[fl]
            v, s, r, off = stage2_grid(ix, qc, qok, q.times, restrict, min_offset)
            if v is not None and frame_ok(s, r, nq):
                out.update(id=ix.ids[v], stage=label + (" mirrored" if fl else ""), offset=off, frames=s,
                           covered=cover_report(ix, v, off, qc, qok, q.times))
                return out
            if v is not None and s >= FUSE_MIN_FRAMES and s - r >= FUSE_MARGIN:
                weak[fl].append(("look", v, off))

    for fl in orientations:
        for entries, qf, qt, stage_fn, limit in (
            (ix.sift, q.sift.get(fl), q.sift_t, stage3_sift, SIFT_FULL_SEARCH_MAX),
            (ix.orb, q.orb.get(fl), q.orb_t, stage3_orb, ORB_FULL_SEARCH_MAX),
        ):
            if not entries or not qf:
                continue
            restrict = None
            if len(entries) > limit:  # too many pictures to compare with all: only the videos other checks pointed at
                restrict = set(cand) | {v for _, v, _ in weak[fl]}
                if not restrict:
                    continue
            v, n, off = stage_fn(ix, qf, qt, min_offset, restrict)
            if v is not None and n >= ORB_MIN_FRAMES:
                out.update(id=ix.ids[v], stage="3 local features" + (" mirrored" if fl else ""), offset=off, frames=n)
                return out
            if v is not None and n >= FUSE_MIN_FRAMES:
                weak[fl].append(("details", v, off))

    for fl in orientations:
        f = fuse(weak[fl])
        if f:
            _, v, off, kinds = f
            out.update(id=ix.ids[v], stage="4 combined (" + " + ".join(kinds) + ")" + (" mirrored" if fl else ""), offset=off)
            return out
    sug = closest(ix, weak)
    if sug:
        out["suggest"] = sug
    return out


def closest(ix: Index, weak) -> dict | None:
    """Nothing was sure enough, but was something close? -> dict(id, offset) for a "did you mean" question, or None.

    Only weak evidence that already points to ONE video counts (two or more frames agreeing, or a clear sound
    match). If the weak evidence points to different videos, there is no suggestion. It is never returned together
    with an answer, and the app words it as a question the person confirms."""
    cands = {}
    for fl in (False, True):
        for kind, v, off in weak.get(fl, []):
            c = cands.setdefault(v, {"kinds": set(), "offs": []})
            c["kinds"].add(kind)
            c["offs"].append(off)
    if not cands:
        return None
    order = sorted(cands.items(), key=lambda kv: -len(kv[1]["kinds"]))
    if len(order) > 1 and len(order[1][1]["kinds"]) == len(order[0][1]["kinds"]):
        return None  # two videos look equally close: don't pick one
    v, c = order[0]
    return dict(id=ix.ids[v], offset=float(np.median(c["offs"])), kinds=sorted(c["kinds"]))


# ------------------------------------------------------------------ pixel check for template-like videos
def _grey(f: np.ndarray) -> np.ndarray:
    return cv2.cvtColor(f, cv2.COLOR_BGR2GRAY) if f.ndim == 3 else f


def _align(q: np.ndarray, kq, dq, o: np.ndarray, ko, do):
    """Similarity transform from the recording's frame onto the original's, or None."""
    if dq is None or do is None or len(dq) < 12 or len(do) < 12:
        return None, 0
    m = cv2.BFMatcher().knnMatch(dq, do, k=2)
    good = [a for a, b in (x for x in m if len(x) == 2) if a.distance < 0.8 * b.distance]
    if len(good) < 12:
        return None, 0
    src = np.float32([kq[g.queryIdx].pt for g in good])
    dst = np.float32([ko[g.trainIdx].pt for g in good])
    M, inl = cv2.estimateAffinePartial2D(src, dst, method=cv2.RANSAC, ransacReprojThreshold=4.0)
    if M is None or inl is None or int(inl.sum()) < 12:
        return None, 0
    return M, int(inl.sum())


def _block_disagreement(q: np.ndarray, o: np.ndarray, M, dyn=None) -> tuple[int, int, int]:
    """(blocks that disagree, blocks compared, blocks covered): fine detail (blurred, background removed) of the recording
    laid over the original, block by block. A block where the recording shows no detail at all (a plain overlay on top)
    is "covered", not a disagreement: other content would still show detail there.
    `dyn` (bool picture like `o`): the parts that move in the original. A disagreement there counts PIX_DYN_WEIGHT times,
    because the set behind a presenter is the same in every review from that room; the hands and the product are not."""
    h, w = o.shape
    wq = cv2.warpAffine(q, M, (w, h), flags=cv2.INTER_AREA, borderValue=0)
    inner = np.zeros(q.shape, np.uint8)
    qh, qw = q.shape
    inner[int(PIX_EDGE[0] * qh): int((1 - PIX_EDGE[1]) * qh), : int((1 - PIX_EDGE[2]) * qw)] = 255
    valid = cv2.warpAffine(inner, M, (w, h), flags=cv2.INTER_NEAREST) > 0
    a = cv2.GaussianBlur(o.astype(np.float32), (0, 0), 1.0)
    b = cv2.GaussianBlur(wq.astype(np.float32), (0, 0), 1.0)
    a -= cv2.GaussianBlur(a, (0, 0), 6)
    b -= cv2.GaussianBlur(b, (0, 0), 6)
    gc, gr = PIX_BLOCKS
    bh, bw = h // gr, w // gc
    bad = used = covered = 0
    for r in range(gr):
        for c in range(gc):
            sl = (slice(r * bh, (r + 1) * bh), slice(c * bw, (c + 1) * bw))
            if valid[sl].mean() < 0.9:
                continue
            x, y = a[sl], b[sl]
            if x.std() < 3.0:
                continue  # nothing to compare here
            if y.std() < 0.5 * x.std():
                covered += 1
                continue
            x, y = x - x.mean(), y - y.mean()
            ncc = float((x * y).sum() / (np.sqrt((x * x).sum() * (y * y).sum()) + 1e-6))
            used += 1
            if ncc < PIX_BAD_NCC:
                bad += PIX_DYN_WEIGHT if dyn is not None and dyn[sl].mean() > 0.3 else 1
    return bad, used, covered


def _motion(frames) -> float:
    """How much the picture changes from one second to the next (mean grey-level difference, median over the clip)."""
    if len(frames) < 3:
        return 0.0
    small = [cv2.resize(f, (64, 114), interpolation=cv2.INTER_AREA).astype(np.float32) for f in frames]
    return float(np.median([np.abs(small[i + 1] - small[i]).mean() for i in range(len(small) - 1)]))


def _pixel_scan(orig_path, query_path, offset=None):
    """-> (passed, picks): `passed` as in pixel_check; `picks` = [(recording frame, original frame, transform)] for the
    frames that were lined up (frame numbers at 1 frame a second), best-fitting original frame each.

    A still video (a trading screen, a slide) is judged against whichever original frame fits best: the moment hardly
    matters. A MOVING video (two reviews filmed in one room look alike in everything but the people and the product) is
    judged in time as well: `offset` (seconds into the original at which the recording starts, as the fingerprints found
    it) says where each recording frame belongs, and the original is read 24 times a second around that place so the
    moving subject is compared at the right instant. The frames must then agree on one offset (the same order and
    pace), and a disagreement on the parts that move weighs double."""
    try:
        of1, ot1 = read_frames(orig_path, 1)
        qf, qt = read_frames(query_path, 1)
    except Exception:
        return False, []
    if len(of1) < 2 or len(qf) < 2:
        return False, []
    of, ot = of1, ot1
    sift = cv2.SIFT_create(nfeatures=800, contrastThreshold=0.02)
    cache = {}

    def feats(j):
        if j not in cache:
            g = _grey(of[j])
            k, d = sift.detectAndCompute(g, None)
            cache[j] = (g, k, d)
        return cache[j]

    pick_o = np.unique(np.linspace(0, len(of) - 1, min(PIX_ORIG_FRAMES, len(of))).astype(int))
    pick_q = np.unique(np.linspace(0, len(qf) - 1, min(PIX_FRAMES, len(qf))).astype(int))
    judged = passed = 0
    picks = []
    lined = []  # (recording frame, its transform, its picture): what the time check below works from
    for i in pick_q:
        g = _grey(qf[int(i)])
        k, d = sift.detectAndCompute(g, None)
        fits = []
        for j in pick_o:
            o, ko, do = feats(int(j))
            M, n = _align(g, k, d, o, ko, do)
            if M is not None:
                fits.append((n, int(j), M))
        judged += 1
        if not fits:
            continue
        top = max(n for n, _, _ in fits)
        # A still video drifts a little (numbers tick), so judge against the original frame that fits best.
        res = []
        for n, j, M in fits:
            if n < 0.6 * top:
                continue
            bad, used, cov = _block_disagreement(g, feats(j)[0], M)
            if used >= PIX_MIN_BLOCKS and cov <= PIX_COVER_MAX * (used + cov):
                res.append((bad, int(i), j, M))
        if not res:
            continue
        best = min(res, key=lambda r: r[0])
        passed += best[0] <= PIX_BAD_MAX
        picks.append(best[1:])
        lined.append((int(i), best[3], g))
    verdict = judged >= 2 and passed >= max(2, int(np.ceil(0.6 * judged)))
    if offset is None or len(lined) < 2 or _motion(of1) <= PIX_MOVING:
        return verdict, picks  # a still picture (or no place to look at): the moment does not matter

    dyn = dynamic_map(of1)
    fine = []
    for i, M, g in lined:
        wf, wt = read_frames(orig_path, PIX_ORIG_FPS, 480, float(qt[i]) + offset - PIX_NEAR, 2 * PIX_NEAR)
        scored = []
        for f_, t_ in zip(wf, wt):
            bad, used, cov = _block_disagreement(g, _grey(f_), M, dyn)
            if used >= PIX_MIN_BLOCKS and cov <= PIX_COVER_MAX * (used + cov):
                scored.append((bad, t_))
        if scored:
            bad, t_ = min(scored)
            fine.append((bad, i, t_, M))
    if len(fine) < 2:
        return False, []
    offs = [t_ - float(qt[i]) for _, i, t_, _ in fine]
    if max(offs) - min(offs) > PIX_FINE_SPREAD:
        return False, []  # the frames do not run in step with the original
    ok = sum(1 for bad, _, _, _ in fine if bad <= PIX_BAD_MAX)
    picks = [(i, int(min(len(of1) - 1, round(t_))), M) for _, i, t_, M in fine]
    return ok >= max(2, int(np.ceil(0.6 * judged))), picks


def pixel_check(orig_path, query_path, offset=None) -> bool:
    """Is this recording really of that video, looking at the actual pictures? Used for template-like videos, where
    the fingerprints agree with every other video from the same template. After lining a recording frame up with the
    original, almost every block of fine detail must agree; a different pair, price, name or number shows up as blocks
    that do not. A touch dot or a notification may spoil a block or two. -> False when it cannot be confirmed."""
    return _pixel_scan(orig_path, query_path, offset)[0]


# ---- reading the words and numbers on screen (OCR)
OCR_FRAMES = 3          # recording frames that are read
OCR_ORIG_FRAMES = 6     # original frames each is compared with
OCR_HEIGHT = 1280       # frames are read at this height: small figures need the pixels
OCR_MIN_CONF = 55
OCR_MIN_TOKENS = 10     # fewer readable words/numbers than this in a frame: that frame says nothing
OCR_OK = 0.45           # pictures agree but fewer than this share of the words/numbers do: something else is on screen (the time of the moment is unknown on a ticking screen, so this is only a guard)
OCR_SURE = 0.94         # agreement high enough to confirm a match the pixel check could not (an overlay on top)
OCR_LINE = 9.0          # lines are matched when their heights (on a 480 px tall picture) are this close

_TOK = re.compile(r"[a-z0-9][a-z0-9.,%:/+-]*[a-z0-9%]|[0-9]", re.I)


def _ocr_words(g: np.ndarray):
    """[(text, centre x, centre y)] for the confidently read words/numbers of a grey picture; None when OCR is not
    available on this machine."""
    exe = shutil.which("tesseract")
    if exe is None:
        return None
    import csv
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        png = os.path.join(tmp, "f.png")
        cv2.imwrite(png, g)
        try:
            out = subprocess.run([exe, png, "stdout", "--psm", "11", "tsv"], capture_output=True, timeout=60, check=True).stdout
        except Exception:
            return None
    words = []
    for r in csv.DictReader(io.StringIO(out.decode("utf-8", "ignore")), delimiter="\t", quoting=csv.QUOTE_NONE):
        try:
            conf = float(r.get("conf", -1))
        except ValueError:
            continue
        t = (r.get("text") or "").strip()
        if conf < OCR_MIN_CONF or not t:
            continue
        t = re.sub(r"[^\w.,%:/+-]", "", t).lower()
        if len(t) < 2 and not t.isdigit():
            continue
        words.append((t, float(r["left"]) + float(r["width"]) / 2, float(r["top"]) + float(r["height"]) / 2))
    return words


def _lines(words, scale, M=None):
    """Group words into lines by height (on a 480 px tall picture; `M` first moves a recording onto the original).
    -> {line number: [text, ...]} with '5 000.00'-style number splits joined."""
    out = {}
    for t, x, y in words:
        px, py = x / scale, y / scale
        if M is not None:
            px, py = M[0, 0] * px + M[0, 1] * py + M[0, 2], M[1, 0] * px + M[1, 1] * py + M[1, 2]
        out.setdefault(int(round(py / OCR_LINE)), []).append((px, t))
    res = {}
    for k, v in out.items():
        text = " ".join(t for _, t in sorted(v))
        text = re.sub(r"(\d) (\d{3}\b)", r"\1\2", text)
        res[k] = [m.group(0) for m in _TOK.finditer(text)]
    return res


def _text_agreement(q_words, o_words, scale, M) -> float | None:
    """Share of the recording's words/numbers that the original has on the same line; None when too little text."""
    ql, ol = _lines(q_words, scale, M), _lines(o_words, scale)
    total = hit = 0
    for k, toks in ql.items():
        cand = set()
        for d in (-1, 0, 1):
            cand.update(ol.get(k + d, []))
        if not cand:
            continue  # nothing on that line of the original (an overlay on top): not a disagreement
        for t in toks:
            total += 1
            hit += t in cand
    return hit / total if total >= OCR_MIN_TOKENS else None


def ocr_agreement(orig_path, query_path, picks) -> float | None:
    """How well the words and numbers on screen agree (None: could not tell). A few recording frames are read and each is
    compared with several original frames, keeping the best: on a still screen the numbers tick over time, and which
    moment of the original a recording frame shows is not known."""
    if not picks or shutil.which("tesseract") is None:
        return None
    try:
        of, _ = read_frames(orig_path, 1, OCR_HEIGHT)
        qf, _ = read_frames(query_path, 1, OCR_HEIGHT)
    except Exception:
        return None
    chosen = [picks[i] for i in np.unique(np.linspace(0, len(picks) - 1, min(OCR_FRAMES, len(picks))).astype(int))]
    chosen = [(qi, oj, M) for qi, oj, M in chosen if qi < len(qf)]
    if not chosen or not of:
        return None
    o_idx = sorted({int(i) for i in np.linspace(0, len(of) - 1, min(OCR_ORIG_FRAMES, len(of))).astype(int)} | {oj for _, oj, _ in chosen if oj < len(of)})
    from concurrent.futures import ThreadPoolExecutor

    with ThreadPoolExecutor(max_workers=4) as ex:
        fq = [ex.submit(_ocr_words, _grey(qf[qi])) for qi, _, _ in chosen]
        fo = {j: ex.submit(_ocr_words, _grey(of[j])) for j in o_idx}
        qw = [f.result() for f in fq]
        ow = {j: f.result() for j, f in fo.items()}
    if any(w is None for w in qw) or any(w is None for w in ow.values()):
        return None
    vals = []
    for (qi, _, M), a in zip(chosen, qw):
        scale = _grey(qf[qi]).shape[0] / 480.0
        best = [v for v in (_text_agreement(a, ow[j], scale, M) for j in o_idx) if v is not None]
        if best:
            vals.append(max(best))
    return float(np.mean(vals)) if vals else None


def confirm_recording(orig_path, query_path, offset=None) -> bool:
    """The full check for a recording that matched a template-like video: the pictures must agree (pixel_check) and,
    when there is text to read, the words and numbers must agree too. Text can also rescue a recording whose pictures
    disagree only because of an overlay, but only when it agrees almost perfectly."""
    passed, picks = _pixel_scan(orig_path, query_path, offset)
    text = ocr_agreement(orig_path, query_path, picks)
    if text is None:
        ok = passed
    elif passed:
        ok = text >= OCR_OK
    else:
        ok = text >= OCR_SURE and len(picks) >= 2
    if ok and offset is not None:
        # Last guard: what is SAID. Two reviews from one room can pass the picture check; their voiceovers do not.
        try:
            from . import scan_speech

            said = scan_speech.voiceover_agreement(orig_path, query_path, offset, clip_seconds(query_path))
            if said is not None and said < scan_speech.SPEECH_OK:
                return False
        except Exception:
            pass
        # ...and, when a picture model is configured (off by default), what the frames look like to it.
        try:
            from . import scan_embed

            sim = scan_embed.frame_similarity(read_frames, orig_path, query_path, offset, clip_seconds(query_path))
            if sim is not None and sim < scan_embed.min_similarity():
                return False
        except Exception:
            pass
    return ok


# ------------------------------------------------------------------ one still picture (a thumbnail)
STILL_HAM = 12      # the thumbnail's fingerprint must be this close to one stored frame...
STILL_MARGIN = 4    # ...and every other video's closest frame at least this much further away
STILL_SURE_HAM = 3  # almost identical: accepted on the fingerprint alone
STILL_ORB = 30      # otherwise local details (RANSAC inliers) must confirm it


def identify_still(ix: Index, g: np.ndarray) -> dict:
    """Which uploaded video does this one picture come from? `g` is a gray image. Much weaker evidence than a
    recording (one frame, no sound), so it is strict: one clearly closest video, confirmed by fingerprint
    distance or by matching details; otherwise None."""
    none = dict(id=None, stage=None, offset=None, clip_s=None)
    if ix is None or ix.f_hash is None or len(ix.f_hash) == 0 or g is None or g.size == 0:
        return none
    g = np.ascontiguousarray(g)
    q = phash(g)
    d = _POP[q[None, :] ^ ix.f_hash].sum(axis=1)
    best_per_video = {}
    for n in np.argsort(d)[:200]:
        vi = int(ix.f_vid[n])
        best_per_video.setdefault(vi, int(n))
    order = sorted(best_per_video.items(), key=lambda kv: d[kv[1]])
    vi, n = order[0]
    dist = int(d[n])
    if dist > STILL_HAM:
        return none
    if len(order) > 1 and int(d[order[1][1]]) - dist < STILL_MARGIN:
        return none
    t = float(ix.f_t[n])
    stage = "still"
    if dist > STILL_SURE_HAM:
        near = [(pts, des) for (v, ot, pts, des) in ix.sift if v == vi and abs(ot - t) <= 1.0]
        if near:
            qa, qd = sift_feats(trim_borders(g), SIFT_N_QUERY)
            best = max((sift_match(qa, qd, pts, des)[0] for pts, des in near), default=0)
        else:  # stored before SIFT existed
            qa, qd = orb_feats(trim_borders(g))
            near = [(pts, des) for (v, ot, pts, des) in ix.orb if v == vi and abs(ot - t) <= 1.0]
            best = max((orb_inliers(qa, qd, pts, des) for pts, des in near), default=0)
        if best < STILL_ORB:
            return none
        stage = "still + details"
    return dict(id=ix.ids[vi], stage=stage, offset=t, clip_s=None)
