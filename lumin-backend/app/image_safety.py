"""Checks pictures (and frames sampled from videos) for nudity and violence with an outside image-safety service.

The service sits behind a small interface so it can be swapped: a Provider has one method, score(jpeg_bytes), that
returns {category: 0..1}. Categories used by the rules in app/screening.py: "sexual", "sexual/minors",
"violence", "violence/graphic".

Today's provider is OpenAI's moderation endpoint (free, accepts images). Turn it on with
    MODERATION_PROVIDER=openai   and   OPENAI_API_KEY=...
Nothing is checked and nothing breaks while those are unset: the word filter and reports still work.
Adding another service (Sightengine, Google Vision SafeSearch, AWS Rekognition) means one more small class here that
maps its answer onto the same four categories, plus one line in get_provider().
"""
import base64
import logging
import os

import httpx

log = logging.getLogger(__name__)

MAX_SIDE = 512  # frames are shrunk to this before sending: faster, cheaper, plenty to judge
JPEG_QUALITY = 80
FRAMES_PER_VIDEO = 8


class Provider:
    def score(self, jpeg: bytes) -> dict[str, float]:
        raise NotImplementedError


class OpenAIProvider(Provider):
    URL = "https://api.openai.com/v1/moderations"

    def __init__(self, api_key: str, model: str = "omni-moderation-latest"):
        self.api_key = api_key
        self.model = model

    def score(self, jpeg: bytes) -> dict[str, float]:
        data_url = "data:image/jpeg;base64," + base64.b64encode(jpeg).decode()
        resp = httpx.post(
            self.URL,
            headers={"Authorization": f"Bearer {self.api_key}"},
            json={"model": self.model, "input": [{"type": "image_url", "image_url": {"url": data_url}}]},
            timeout=30,
        )
        resp.raise_for_status()  # 429 / 5xx: the job is retried later
        scores = resp.json()["results"][0]["category_scores"]
        return {k: float(v) for k, v in scores.items()}


def get_provider() -> Provider | None:
    name = os.environ.get("MODERATION_PROVIDER", "").strip().lower()
    if name == "openai":
        key = os.environ.get("OPENAI_API_KEY", "").strip()
        if key:
            return OpenAIProvider(key, os.environ.get("MODERATION_MODEL", "omni-moderation-latest"))
        log.warning("MODERATION_PROVIDER=openai but OPENAI_API_KEY is empty: pictures are not being checked")
    return None


def enabled() -> bool:
    return get_provider() is not None


def _shrink_encode(img) -> bytes:
    import cv2

    h, w = img.shape[:2]
    scale = MAX_SIDE / max(h, w)
    if scale < 1:
        img = cv2.resize(img, (max(1, int(w * scale)), max(1, int(h * scale))), interpolation=cv2.INTER_AREA)
    ok, buf = cv2.imencode(".jpg", img, [int(cv2.IMWRITE_JPEG_QUALITY), JPEG_QUALITY])
    if not ok:
        raise ValueError("could not encode frame")
    return buf.tobytes()


def jpeg_from_image_file(path: str) -> bytes | None:
    import cv2

    img = cv2.imread(path)
    return None if img is None else _shrink_encode(img)


def sample_frames(path: str, n: int = FRAMES_PER_VIDEO) -> list[bytes]:
    """Up to n frames spread evenly through the video, as small JPEGs. Empty if the file can't be read."""
    import cv2

    cap = cv2.VideoCapture(path)
    out: list[bytes] = []
    try:
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        if total > 0:
            for i in range(n):
                cap.set(cv2.CAP_PROP_POS_FRAMES, int((i + 0.5) * total / n))
                ok, frame = cap.read()
                if ok and frame is not None:
                    out.append(_shrink_encode(frame))
        else:  # no frame count in the file: take what we can, in order
            frames = []
            ok, frame = cap.read()
            while ok and len(frames) < 600:
                frames.append(frame)
                ok, frame = cap.read()
            step = max(1, len(frames) // n)
            out = [_shrink_encode(f) for f in frames[::step][:n]]
    finally:
        cap.release()
    return out
