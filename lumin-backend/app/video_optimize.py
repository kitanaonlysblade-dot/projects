"""Background video optimisation, run after a video post is created.

Before these, a video a phone would struggle with (WebM, HEVC, 4K, 60 fps...) is converted to a phone-friendly MP4 (see
app/video_compat.py). Then two things happen, in this order, and only the second ever lowers quality:

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

3. STREAMING VERSION (HLS, adaptive). The same video cut into 2-second pieces at several qualities (240p to 720p, never
   above the original), with a master playlist. The player starts on the smallest quality (so the first picture shows
   at once, even on a weak connection) and moves up as the connection allows, like Facebook / TikTok. Stored under
   hls/<id>/ with a long cache header, address in video_posts.hls_url. Also written: lite.m3u8 (the two smallest
   qualities only) for Lumin Lite. The mp4 files stay as the fallback.

Anything that goes wrong is logged and skipped: the post simply keeps
playing from its original file, exactly as before.

Backfill existing posts:  python -m app.video_optimize --backfill      (posts with no lite copy yet)
                          python -m app.video_optimize --backfill-hls  (posts with no streaming version yet)
                          python -m app.video_optimize --backfill-all  (every video, converting phone-unfriendly ones)
"""

import json
import logging
import os
import subprocess
import sys
import tempfile
import uuid

from app import storage
from app.video_compat import compat_command, needs_compat
from app.database import SessionLocal
from app.models import VideoPost

log = logging.getLogger(__name__)

IMMUTABLE_CACHE = "public, max-age=31536000, immutable"
LITE_SHORT_SIDE = 480
LITE_CRF = "28"
LITE_MAXRATE = "700k"
LITE_BUFSIZE = "1400k"
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
        # Capped bitrate: a busy scene can't make the file (and so its start-up) big. Short key-frame gap so a seek or
        # a restart has a picture to show quickly.
        "-maxrate", LITE_MAXRATE, "-bufsize", LITE_BUFSIZE, "-g", "48",
        "-profile:v", "main", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
    ]
    if has_audio:
        cmd += ["-c:a", "aac", "-b:a", LITE_AUDIO_BITRATE, "-ac", "2"]
    else:
        cmd += ["-an"]
    _run(cmd + [dst])


# Streaming ladder: short side in pixels, video bit-rate CAP, audio bit rate, CRF. Smallest first (players start on
# the first). Quality-based (CRF) with the old fixed rate kept only as a ceiling: an easy video (a talking head, a
# static background) is encoded at the quality target and comes out far smaller than the cap, while a busy scene
# can't exceed it. The cap is also what the master playlist advertises as BANDWIDTH, so players still choose safely.
HLS_LADDER = [(240, "300k", "48k", 28), (360, "600k", "64k", 26), (540, "1100k", "96k", 24), (720, "2200k", "128k", 23)]
HLS_SEGMENT_SECONDS = 2
HLS_FPS = 30
HLS_MIME = {".m3u8": "application/vnd.apple.mpegurl", ".ts": "video/mp2t"}


def _short_side(info: dict) -> int:
    for st in info.get("streams", []):
        if st.get("codec_type") == "video":
            w, h = int(st.get("width") or 0), int(st.get("height") or 0)
            if w and h:
                return min(w, h)
    return 0


def _hls_rungs(info: dict) -> list[tuple[int, str, str, int]]:
    """The ladder rungs that make sense for this source: never larger than the original; at least one."""
    short = _short_side(info)
    rungs = [r for r in HLS_LADDER if not short or r[0] <= short]
    return rungs or HLS_LADDER[:1]


def _make_hls(src: str, out_dir: str, info: dict) -> None:
    """Cut src into an HLS ladder in out_dir: v0/, v1/... (pieces + index.m3u8 each) and master.m3u8."""
    rungs = _hls_rungs(info)
    audio = _has_audio(info)
    n = len(rungs)
    split = "".join(f"[s{i}]" for i in range(n))
    chains = [f"[0:v]fps={HLS_FPS},format=yuv420p,split={n}{split}"]
    for i, (side, _, _, _) in enumerate(rungs):
        # Short side = `side` (never upscaled), aspect kept, even sizes.
        chains.append(
            f"[s{i}]scale=w='if(gt(iw,ih),-2,min({side},iw))':h='if(gt(iw,ih),min({side},ih),-2)'[o{i}]"
        )
    cmd = ["ffmpeg", "-y", "-i", src, "-filter_complex", ";".join(chains)]
    streams = []
    for i, (side, vrate, arate, crf) in enumerate(rungs):
        cmd += ["-map", f"[o{i}]"]
        if audio:
            cmd += ["-map", "0:a:0"]
        streams.append(f"v:{i},a:{i}" if audio else f"v:{i}")
        bufsize = f"{int(vrate[:-1]) * 2}k"
        cmd += [
            f"-c:v:{i}", "libx264", f"-profile:v:{i}", "main", f"-preset:v:{i}", "veryfast",
            f"-crf:v:{i}", str(crf), f"-maxrate:v:{i}", vrate, f"-bufsize:v:{i}", bufsize,
        ]
        if audio:
            cmd += [f"-c:a:{i}", "aac", f"-b:a:{i}", arate, f"-ac:a:{i}", "2"]
    gop = HLS_FPS * HLS_SEGMENT_SECONDS
    cmd += [
        "-g", str(gop), "-keyint_min", str(gop), "-sc_threshold", "0",
        "-force_key_frames", f"expr:gte(t,n_forced*{HLS_SEGMENT_SECONDS})",
        "-f", "hls", "-hls_time", str(HLS_SEGMENT_SECONDS), "-hls_playlist_type", "vod",
        "-hls_flags", "independent_segments", "-hls_segment_type", "mpegts",
        "-hls_segment_filename", os.path.join(out_dir, "v%v", "seg_%04d.ts"),
        "-master_pl_name", "master.m3u8",
        "-var_stream_map", " ".join(streams),
        os.path.join(out_dir, "v%v", "index.m3u8"),
    ]
    for i in range(n):
        os.makedirs(os.path.join(out_dir, f"v{i}"), exist_ok=True)
    _run(cmd)
    _write_lite_master(out_dir)


def _write_lite_master(out_dir: str) -> None:
    """lite.m3u8: the master playlist with only the two smallest qualities, for Lumin Lite."""
    with open(os.path.join(out_dir, "master.m3u8")) as f:
        lines = f.read().splitlines()
    head = [l for l in lines if l.strip() and not (l.startswith("#EXT-X-STREAM-INF") or not l.startswith("#"))]
    variants: list[tuple[str, str]] = []
    for i, l in enumerate(lines):
        if l.startswith("#EXT-X-STREAM-INF") and i + 1 < len(lines):
            variants.append((l, lines[i + 1]))
    keep = variants[:2]
    with open(os.path.join(out_dir, "lite.m3u8"), "w") as f:
        f.write("\n".join(head + [x for pair in keep for x in pair]) + "\n")


def _upload_hls(out_dir: str, prefix: str) -> str:
    """Upload every file of an HLS folder under prefix; returns the master playlist's address."""
    uploaded: list[str] = []
    try:
        # Pieces first, playlists last: nobody can be pointed at a playlist whose pieces are not there yet.
        files = []
        for root, _, names in os.walk(out_dir):
            for name in names:
                files.append(os.path.join(root, name))
        files.sort(key=lambda p: (p.endswith(".m3u8"), p))
        for path in files:
            rel = os.path.relpath(path, out_dir).replace(os.sep, "/")
            ext = os.path.splitext(rel)[1].lower()
            key = f"{prefix}/{rel}"
            storage.upload_file(path, key, HLS_MIME.get(ext, "application/octet-stream"), IMMUTABLE_CACHE)
            uploaded.append(key)
    except Exception:
        storage.delete_view_urls([storage.view_url_for_key(f"{prefix}/master.m3u8")])
        raise
    return storage.view_url_for_key(f"{prefix}/master.m3u8")


def make_hls_for_post(post_id: uuid.UUID) -> bool:
    """Build and publish the streaming version of one post's video. True when the post now has one."""
    db = SessionLocal()
    try:
        post = db.get(VideoPost, post_id)
        if post is None:
            return False
        key = storage.key_from_view_url(post.video_url)
        if key is None:
            return False
        with tempfile.TemporaryDirectory() as tmp:
            src = os.path.join(tmp, "src" + (os.path.splitext(key)[1].lower() or ".mp4"))
            storage.download_object(key, src)
            info = _probe(src)
            out = os.path.join(tmp, "hls")
            os.makedirs(out)
            _make_hls(src, out, info)
            prefix = f"hls/{uuid.uuid4()}"
            url = _upload_hls(out, prefix)
            db.refresh(post)
            if storage.key_from_view_url(post.video_url) != key:
                storage.delete_view_urls([url])  # the video was replaced while this ran
                return False
            old = post.hls_url
            post.hls_url = url
            db.commit()
            if old:
                storage.delete_view_urls([old])
            return True
    except Exception:
        log.exception("streaming version failed for %s", post_id)
        return False
    finally:
        db.close()


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
        if content_type is None and ext != ".webm":
            return  # a format we don't know: leave as is

        with tempfile.TemporaryDirectory() as tmp:
            original = os.path.join(tmp, "original" + ext)
            storage.download_object(key, original)
            info = _probe(original)
            original_size = os.path.getsize(original)

            # 0. Phone-friendly copy, when the upload would be hard for a phone to play (a desktop screen recording
            #    saved as WebM, HEVC, 4K or 60 fps, 10-bit...). An .mp4 is replaced under the same key, so its URL
            #    stays; a .mov or .webm becomes a new .mp4 and the post points at it. Quality stays high (CRF 23).
            work_path, work_key, work_type = original, key, content_type
            try:
                if needs_compat(info, ext):
                    compat = os.path.join(tmp, "compat.mp4")
                    _run(compat_command(original, compat, info))
                    new_key = key if ext == ".mp4" else f"{os.path.splitext(key)[0]}.mp4"
                    storage.upload_file(compat, new_key, "video/mp4", IMMUTABLE_CACHE)
                    if new_key != key:
                        db.refresh(post)
                        if post.video_url == storage.view_url_for_key(key):
                            post.video_url = storage.view_url_for_key(new_key)
                            post.lite_video_url = None
                            db.commit()
                            storage.delete_view_urls([storage.view_url_for_key(key)])
                        else:
                            storage.delete_view_urls([storage.view_url_for_key(new_key)])  # post changed meanwhile
                            raise RuntimeError("post changed during conversion")
                    work_path, work_key, work_type = compat, new_key, "video/mp4"
                    info = _probe(compat)
                    original_size = os.path.getsize(compat)
            except Exception:
                log.exception("phone-friendly conversion failed for %s", key)

            # 1. Lossless fast start, written back under the same key (skipped for a copy made above: it has it).
            if work_path == original and content_type:
                fast = os.path.join(tmp, "fast" + ext)
                try:
                    _faststart(original, fast)
                    storage.upload_file(fast, key, content_type or "video/mp4", IMMUTABLE_CACHE)
                except Exception:
                    log.exception("fast-start step failed for %s", key)
            key = work_key

            # 2. Lite copy for Lumin Lite viewers (separate object).
            lite_path = os.path.join(tmp, "lite.mp4")
            try:
                _make_lite(work_path, lite_path, _has_audio(info))
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
    # 3. The streaming version (its own download of the finished file, so a failure here never touches the steps above).
    make_hls_for_post(post_id)


def backfill_hls() -> None:
    """Every video that has no streaming version yet."""
    db = SessionLocal()
    try:
        ids = [p.id for p in db.query(VideoPost).filter(VideoPost.video_url.isnot(None), VideoPost.hls_url.is_(None))]
    finally:
        db.close()
    for i, post_id in enumerate(ids, 1):
        print(f"[{i}/{len(ids)}] {post_id}", flush=True)
        make_hls_for_post(post_id)


def backfill(everything: bool = False) -> None:
    """Posts with no lite copy yet; with everything=True every video, so older uploads that phones struggle with
    (see app/video_compat.py) are converted too."""
    db = SessionLocal()
    try:
        query = db.query(VideoPost).filter(VideoPost.video_url.isnot(None))
        if not everything:
            query = query.filter(VideoPost.lite_video_url.is_(None))
        ids = [p.id for p in query]
    finally:
        db.close()
    for i, post_id in enumerate(ids, 1):
        print(f"[{i}/{len(ids)}] {post_id}", flush=True)
        optimize_video_post(post_id)


if __name__ == "__main__":
    if "--backfill-hls" in sys.argv:
        backfill_hls()
    elif "--backfill" in sys.argv or "--backfill-all" in sys.argv:
        backfill(everything="--backfill-all" in sys.argv)
    else:
        print(__doc__)
