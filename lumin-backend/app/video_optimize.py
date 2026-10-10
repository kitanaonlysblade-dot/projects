"""Background video optimisation, run after a video post is created.

Two things happen, in this order, and only the second ever lowers quality:

1. FAST START (lossless). The uploaded file is re-wrapped, not re-encoded
   (`-c copy`), so the index the player needs sits at the *front* of the
   file. Phone recordings usually have it at the end, which forces the
   browser to download most of the file before the first frame can show —
   the main reason a video "takes long to show" on a slow connection. The
   picture and sound are bit-for-bit identical. It overwrites the original
   object under the same key, so the URL stored on the post doesn't change,
   and sets a long-lived cache header so a replay costs no data.

2. LITE COPY (smaller, lower quality — only used by "Lumin Lite"). A second,
   smaller file (480p-class, H.264) saved next to the original and recorded
   in video_posts.lite_video_url. The original is never touched by this
   step, so normal viewers keep full quality. A lite copy that doesn't end
   up meaningfully smaller than the original is thrown away.

Anything that goes wrong is logged and skipped: the post simply keeps
playing from its original file, exactly as before.

Backfill existing posts:  python -m app.video_optimize --backfill
"""

import json
import logging
import os
import subprocess
import sys
import tempfile
import uuid

from app import storage
from app.database import SessionLocal
from app.models import VideoPost

log = logging.getLogger(__name__)

IMMUTABLE_CACHE = "public, max-age=31536000, immutable"
LITE_SHORT_SIDE = 480
LITE_CRF = "28"
LITE_AUDIO_BITRATE = "64k"
# Keep the lite copy only if it is at least this much smaller.
LITE_MAX_SIZE_RATIO = 0.85
FFMPEG_TIMEOUT_SECONDS = 900

_CONTAINER_TYPES = {".mp4": "video/mp4", ".mov": "video/quicktime"}


def _run(args: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(
        args, check=True, capture_output=True, timeout=FFMPEG_TIMEOUT_SECONDS
    )


def _probe(path: str) -> dict:
    out = _run(
        [
            "ffprobe", "-v", "error", "-print_format", "json",
            "-show_streams", "-show_format", path,
        ]
    ).stdout
    return json.loads(out)


def _has_audio(info: dict) -> bool:
    return any(s.get("codec_type") == "audio" for s in info.get("streams", []))


def _faststart(src: str, dst: str) -> None:
    # -c copy: container rewrite only, no re-encode, no quality change.
    _run(["ffmpeg", "-y", "-i", src, "-map", "0", "-c", "copy", "-movflags", "+faststart", dst])


def _make_lite(src: str, dst: str, has_audio: bool) -> None:
    # Short side capped at 480 (never upscaled), aspect ratio kept, even
    # dimensions for H.264. Portrait: width is the short side; landscape:
    # height is.
    scale = (
        f"scale=w='if(gt(iw,ih),-2,min({LITE_SHORT_SIDE},iw))':"
        f"h='if(gt(iw,ih),min({LITE_SHORT_SIDE},ih),-2)'"
    )
    cmd = [
        "ffmpeg", "-y", "-i", src,
        "-vf", scale,
        "-c:v", "libx264", "-preset", "medium", "-crf", LITE_CRF,
        "-pix_fmt", "yuv420p", "-movflags", "+faststart",
    ]
    if has_audio:
        cmd += ["-c:a", "aac", "-b:a", LITE_AUDIO_BITRATE, "-ac", "2"]
    else:
        cmd += ["-an"]
    _run(cmd + [dst])


def optimize_video_post(post_id: uuid.UUID) -> None:
    db = SessionLocal()
    try:
        post = db.get(VideoPost, post_id)
        if post is None:
            return
        key = storage.key_from_view_url(post.video_url)
        if key is None:
            return  # external / mock URL — nothing of ours to process
        ext = os.path.splitext(key)[1].lower()
        content_type = _CONTAINER_TYPES.get(ext)
        if content_type is None:
            return  # e.g. .webm: leave as is

        with tempfile.TemporaryDirectory() as tmp:
            original = os.path.join(tmp, "original" + ext)
            storage.download_object(key, original)
            info = _probe(original)
            original_size = os.path.getsize(original)

            # 1. Lossless fast start, written back under the same key.
            fast = os.path.join(tmp, "fast" + ext)
            try:
                _faststart(original, fast)
                storage.upload_file(fast, key, content_type, IMMUTABLE_CACHE)
            except Exception:
                log.exception("fast-start step failed for %s", key)

            # 2. Lite copy for Lumin Lite viewers (separate object).
            lite_path = os.path.join(tmp, "lite.mp4")
            try:
                _make_lite(original, lite_path, _has_audio(info))
                if os.path.getsize(lite_path) <= original_size * LITE_MAX_SIZE_RATIO:
                    stem = os.path.splitext(key)[0]
                    lite_key = f"{stem}-lite.mp4"
                    storage.upload_file(lite_path, lite_key, "video/mp4", IMMUTABLE_CACHE)
                    # Re-fetch in case the post changed while we worked.
                    db.refresh(post)
                    if post.video_url == storage.view_url_for_key(key):
                        post.lite_video_url = storage.view_url_for_key(lite_key)
                        db.commit()
                else:
                    log.info("lite copy of %s not smaller enough, skipped", key)
            except Exception:
                log.exception("lite step failed for %s", key)
    except Exception:
        log.exception("optimize_video_post failed for %s", post_id)
    finally:
        db.close()


def backfill() -> None:
    db = SessionLocal()
    try:
        ids = [
            p.id
            for p in db.query(VideoPost).filter(
                VideoPost.video_url.isnot(None), VideoPost.lite_video_url.is_(None)
            )
        ]
    finally:
        db.close()
    for i, post_id in enumerate(ids, 1):
        print(f"[{i}/{len(ids)}] {post_id}", flush=True)
        optimize_video_post(post_id)


if __name__ == "__main__":
    if "--backfill" in sys.argv:
        backfill()
    else:
        print(__doc__)
