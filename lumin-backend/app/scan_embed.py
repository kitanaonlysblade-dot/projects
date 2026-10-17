"""Learned picture embeddings as one more guard for scan matches (used by scan_fp.confirm_recording).

A small image model (any ONNX model that maps a picture to a vector, e.g. DINOv2-small or a CLIP image tower) turns a few
frames of the recording and of the original, around the matched moment, into vectors; a recording of that video stays
close to it through re-encoding, filters and overlays, a different review from the same room does not. Like the speech
check it can only make the answer stricter and says nothing when it cannot tell.

OFF unless SCAN_EMBED_MODEL points at an .onnx file and onnxruntime is installed. The threshold SCAN_EMBED_MIN
(default 0.5) depends on the model: calibrate it on real pairs (see README, "Scan") before relying on it.
"""
import logging
import os
import threading

import cv2
import numpy as np

log = logging.getLogger(__name__)

SIZE = 224
MEAN = np.array([0.485, 0.456, 0.406], np.float32)
STD = np.array([0.229, 0.224, 0.225], np.float32)
FRAMES = 4

_session = None
_failed = False
_lock = threading.Lock()


def min_similarity() -> float:
    try:
        return float(os.environ.get("SCAN_EMBED_MIN", "0.5"))
    except ValueError:
        return 0.5


def _load():
    global _session, _failed
    path = os.environ.get("SCAN_EMBED_MODEL", "")
    if _session is not None or _failed or not path:
        return _session
    with _lock:
        if _session is None and not _failed:
            try:
                import onnxruntime as ort

                _session = ort.InferenceSession(path, providers=["CPUExecutionProvider"])
            except Exception:
                _failed = True
                log.warning("picture-embedding check unavailable (%s)", path, exc_info=True)
    return _session


def enabled() -> bool:
    return _load() is not None


def _prepare(g: np.ndarray) -> np.ndarray:
    rgb = cv2.cvtColor(cv2.resize(g, (SIZE, SIZE), interpolation=cv2.INTER_AREA), cv2.COLOR_GRAY2RGB).astype(np.float32) / 255.0
    return ((rgb - MEAN) / STD).transpose(2, 0, 1)


def embed(frames: list[np.ndarray], session=None) -> np.ndarray | None:
    """(n, d) unit-length vectors, one per gray frame; None when there is no model or it fails."""
    session = session or _load()
    if session is None or not frames:
        return None
    try:
        x = np.stack([_prepare(f) for f in frames]).astype(np.float32)
        out = np.asarray(session.run(None, {session.get_inputs()[0].name: x})[0], np.float32)
        out = out.reshape(len(frames), -1)
        return out / (np.linalg.norm(out, axis=1, keepdims=True) + 1e-9)
    except Exception:
        log.warning("picture embedding failed", exc_info=True)
        return None


def similarity(rec_vecs: np.ndarray, orig_vecs: np.ndarray) -> float:
    """Mean over the recording's frames of the best cosine similarity to any original frame."""
    return float((rec_vecs @ orig_vecs.T).max(axis=1).mean())


def frame_similarity(read_frames, orig_path, query_path, offset: float | None, clip_seconds: float | None) -> float | None:
    """How close the recording is to the original around the matched moment, or None (cannot tell)."""
    if offset is None or not enabled():
        return None
    try:
        qf, qt = read_frames(query_path, 1)
        if not qf:
            return None
        dur = float(clip_seconds or len(qf))
        of, _ = read_frames(orig_path, 2, 480, offset - 1.0, dur + 2.0)
        if not of:
            return None
        pick_q = [qf[i] for i in np.unique(np.linspace(0, len(qf) - 1, min(FRAMES, len(qf))).astype(int))]
        a, b = embed(pick_q), embed(of)
        if a is None or b is None:
            return None
        return similarity(a, b)
    except Exception:
        log.warning("picture similarity failed", exc_info=True)
        return None
