"""Does the voiceover agree? A guard for scan matches (used by scan_fp.confirm_recording).

Two reviews filmed in the same room can look almost the same; what the presenter SAYS differs. A small speech
recogniser (faster-whisper, "tiny", on the CPU) turns the recording's sound and the original's sound around the matched
moment into words, and the word pairs are compared. It can only make the answer stricter: when the voiceovers clearly
differ the match is dropped; when it cannot tell (no speech, no recogniser, any error) it says nothing.

Optional on purpose: without the faster-whisper package, or with SCAN_SPEECH=0, every function here returns None and the
rest of the matcher behaves as before.
"""
import logging
import os
import re
import subprocess
import threading

import numpy as np

log = logging.getLogger(__name__)

SPEECH_MIN_WORDS = 8     # a recording with fewer recognised words than this has no voiceover to judge
SPEECH_OK = 0.30         # fewer than this share of the recording's word pairs in the original around the same moment: another voiceover
SPEECH_PAD = 3.0         # seconds of the original read before and after the matched stretch
SPEECH_MAX_SECONDS = 40  # longest recording stretch that is recognised
SPEECH_SR = 16000

_model = None
_model_lock = threading.Lock()
_model_failed = False


def enabled() -> bool:
    return os.environ.get("SCAN_SPEECH", "1") != "0"


def _load():
    """The recogniser, or None (not installed / failed to load). Loaded once, on first use."""
    global _model, _model_failed
    if _model is not None or _model_failed or not enabled():
        return _model
    with _model_lock:
        if _model is None and not _model_failed:
            try:
                from faster_whisper import WhisperModel

                _model = WhisperModel(os.environ.get("SCAN_SPEECH_MODEL", "tiny"), device="cpu", compute_type="int8")
            except Exception:
                _model_failed = True
                log.warning("speech check unavailable (faster-whisper missing or failed to load)", exc_info=True)
    return _model


def read_audio16k(path, start: float | None = None, dur: float | None = None) -> np.ndarray:
    """Mono 16 kHz float samples of the sound (optionally only a stretch of it); empty when there is no sound."""
    cmd = ["ffmpeg", "-v", "error"]
    if start is not None:
        cmd += ["-ss", f"{max(0.0, start):.3f}"]
    cmd += ["-i", str(path)]
    if dur is not None:
        cmd += ["-t", f"{dur:.3f}"]
    cmd += ["-vn", "-ac", "1", "-ar", str(SPEECH_SR), "-f", "s16le", "-"]
    try:
        raw = subprocess.run(cmd, capture_output=True, check=True, timeout=60).stdout
    except Exception:
        return np.zeros(0, np.float32)
    return np.frombuffer(raw, np.int16).astype(np.float32) / 32768 if raw else np.zeros(0, np.float32)


_WORD = re.compile(r"[a-z0-9']+")


def words_of(text: str) -> list[str]:
    return _WORD.findall(text.lower())


def transcribe(audio: np.ndarray) -> list[str] | None:
    """The words spoken in `audio` (lower case), [] when none, None when no recogniser is available."""
    model = _load()
    if model is None:
        return None
    if audio.size < SPEECH_SR:  # under a second
        return []
    try:
        segments, _ = model.transcribe(audio, beam_size=1, vad_filter=True, condition_on_previous_text=False)
        return words_of(" ".join(s.text for s in segments))
    except Exception:
        log.warning("speech recognition failed", exc_info=True)
        return None


def _pairs(words: list[str]) -> list[tuple[str, str]]:
    return list(zip(words, words[1:]))


def agreement(rec_words: list[str], orig_words: list[str]) -> float | None:
    """Share of the recording's word pairs that the original also says (None: too few words in the recording to judge,
    or nothing recognised in the original to compare with). Pairs rather than single words, because a handful of
    common words ("this is really good") appear in every review."""
    if len(rec_words) < SPEECH_MIN_WORDS or len(orig_words) < 2:
        return None
    have = set(_pairs(orig_words))
    mine = _pairs(rec_words)
    return sum(p in have for p in mine) / len(mine)


def voiceover_agreement(orig_path, query_path, offset: float | None, clip_seconds: float | None) -> float | None:
    """How well the recording's voiceover agrees with the original's around the matched moment (None: cannot tell)."""
    if offset is None or not enabled() or _load() is None:
        return None
    dur = min(float(clip_seconds or SPEECH_MAX_SECONDS), SPEECH_MAX_SECONDS)
    rec = transcribe(read_audio16k(query_path, 0.0, dur))
    if rec is None or len(rec) < SPEECH_MIN_WORDS:
        return None
    orig = transcribe(read_audio16k(orig_path, offset - SPEECH_PAD, dur + 2 * SPEECH_PAD))
    if orig is None:
        return None
    return agreement(rec, orig)
