"""Saved copy of a video with the platform's mark burned in, plus a short branded end card.

Made on the server with ffmpeg: a normal video takes a few seconds, the sound is kept, and the result is an MP4 that
plays everywhere (the browser used to record the video in real time, which took as long as the video, lost the sound
and produced WebM). The result is stored next to the original and reused for the next download of the same video.

  mark      bottom-left, "L" in the brand pink and "UMIN" in white, with the poster's @name under it
  end card  2 seconds, the brand gradient with the name, the poster's @name and a tagline, fading in
"""

import hashlib
import logging
import os
import subprocess
import tempfile

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

from app import storage
from app.brand import APP_NAME

log = logging.getLogger(__name__)

END_CARD_SECONDS = 2.0
FADE_SECONDS = 0.4
MAX_WIDTH = 1080            # larger videos are scaled down to this width (same as the app's upload width)
MAX_SOURCE_SECONDS = 300    # longer videos are not marked here; the app saves the plain file instead
FFMPEG_TIMEOUT_SECONDS = 600
IMMUTABLE_CACHE = "public, max-age=31536000, immutable"
CACHE_PREFIX = "watermarked/"   # all marked copies live here: a bucket lifecycle rule on this prefix can delete old ones
HOT_PINK = (255, 45, 111)
HOT_ORANGE = (255, 107, 53)

_FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
]


def _font(size: int):
    for p in _FONT_CANDIDATES:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    try:
        return ImageFont.load_default(size)
    except TypeError:  # very old Pillow
        return ImageFont.load_default()


def _run(args: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(args, check=True, capture_output=True, timeout=FFMPEG_TIMEOUT_SECONDS)


def probe(path: str) -> tuple[int, int, float, bool]:
    """(width, height as shown, seconds, has sound). Rotation is applied: ffmpeg turns a sideways phone video upright."""
    with tempfile.TemporaryDirectory() as tmp:
        frame = os.path.join(tmp, "f.png")
        _run(["ffmpeg", "-y", "-v", "error", "-i", path, "-frames:v", "1", frame])
        img = cv2.imread(frame)
        if img is None:
            raise ValueError("could not read the first picture")
        h, w = img.shape[:2]
    out = _run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "default=nw=1", path]
    ).stdout.decode()
    seconds = 0.0
    audio = False
    for line in out.splitlines():
        if line.startswith("duration="):
            try:
                seconds = float(line.split("=", 1)[1])
            except ValueError:
                pass
        if line.strip() == "codec_type=audio":
            audio = True
    return w, h, seconds, audio


def output_size(w: int, h: int) -> tuple[int, int]:
    """Even width and height (H.264 needs them), width at most MAX_WIDTH."""
    if w > MAX_WIDTH:
        h = int(round(h * MAX_WIDTH / w))
        w = MAX_WIDTH
    return max(2, w - w % 2), max(2, h - h % 2)


def render_mark(w: int, h: int, handle: str) -> Image.Image:
    """Transparent picture the size of the video with the mark at the bottom left."""
    scale = w / 1080
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    big, small = _font(int(56 * scale)), _font(int(32 * scale))
    x, bottom = int(28 * scale), h - int(32 * scale)
    handle_y = bottom - int(32 * scale)
    word_y = handle_y - int(10 * scale) - int(56 * scale)
    shadow = (0, 0, 0, 140)
    stroke = max(1, int(2.5 * scale))
    # soft shadow first, then dark outline + fill, so it reads over bright or busy footage
    sh = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    sd = ImageDraw.Draw(sh)
    lw = d.textlength("L", font=big)
    for dx, dy in ((0, 3), (2, 4), (-2, 4)):
        sd.text((x + dx * scale, word_y + dy * scale), "L", font=big, fill=shadow)
        sd.text((x + lw + dx * scale, word_y + dy * scale), "UMIN", font=big, fill=shadow)
        sd.text((x + dx * scale, handle_y + dy * scale), f"@{handle}", font=small, fill=shadow)
    img.alpha_composite(sh)
    d = ImageDraw.Draw(img)
    d.text((x, word_y), "L", font=big, fill=HOT_PINK + (255,), stroke_width=stroke, stroke_fill=(0, 0, 0, 130))
    d.text((x + lw, word_y), "UMIN", font=big, fill=(255, 255, 255, 255), stroke_width=stroke, stroke_fill=(0, 0, 0, 130))
    d.text((x, handle_y), f"@{handle}", font=small, fill=(255, 255, 255, 255), stroke_width=max(1, int(2 * scale)), stroke_fill=(0, 0, 0, 130))
    return img


def render_end_card(w: int, h: int, handle: str) -> Image.Image:
    """Brand gradient (pink to orange, top-left to bottom-right) with the name, the @name and a tagline."""
    scale = w / 1080
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    t = np.clip((xx / max(w - 1, 1) + yy / max(h - 1, 1)) / 2, 0, 1)[..., None]
    grad = (np.array(HOT_PINK, np.float32) * (1 - t) + np.array(HOT_ORANGE, np.float32) * t).astype(np.uint8)
    img = Image.fromarray(grad).convert("RGBA")
    d = ImageDraw.Draw(img)
    name = APP_NAME.upper()
    rows = [
        (name, _font(int(72 * scale)), 255),
        (f"@{handle}", _font(int(34 * scale)), 255),
        (f"Watch more on {name}", _font(int(22 * scale)), 215),
    ]
    gaps = [int(18 * scale), int(14 * scale)]
    sizes = [d.textbbox((0, 0), t, font=f) for t, f, _ in rows]
    heights = [b[3] - b[1] for b in sizes]
    total = sum(heights) + sum(gaps)
    y = (h - total) // 2
    for i, ((text, font, alpha), box) in enumerate(zip(rows, sizes)):
        tw = box[2] - box[0]
        d.text(((w - tw) // 2 - box[0], y - box[1]), text, font=font, fill=(255, 255, 255, alpha))
        y += heights[i] + (gaps[i] if i < len(gaps) else 0)
    return img.convert("RGB")


def make_watermarked(src_path: str, dst_path: str, handle: str) -> None:
    """Writes the marked copy (mark on every frame, end card after, sound kept) to dst_path. Raises on failure."""
    w0, h0, seconds, has_audio = probe(src_path)
    if seconds <= 0:
        raise ValueError("could not read the length of this video")
    if seconds > MAX_SOURCE_SECONDS:
        raise ValueError(f"this video is longer than {MAX_SOURCE_SECONDS // 60} minutes, too long to add the mark")
    w, h = output_size(w0, h0)
    with tempfile.TemporaryDirectory() as tmp:
        mark, card = os.path.join(tmp, "mark.png"), os.path.join(tmp, "card.png")
        render_mark(w, h, handle).save(mark)
        render_end_card(w, h, handle).save(card)
        v0 = f"[0:v]scale={w}:{h},setsar=1,fps=30,format=yuv420p[a];[a][1:v]overlay=0:0[v0]"
        v1 = f"[2:v]scale={w}:{h},setsar=1,fps=30,format=yuv420p,fade=t=in:st=0:d={FADE_SECONDS}[v1]"
        cmd = ["ffmpeg", "-y", "-v", "error", "-i", src_path, "-loop", "1", "-i", mark, "-loop", "1", "-t", str(END_CARD_SECONDS), "-i", card]
        if has_audio:
            cmd += ["-f", "lavfi", "-t", str(END_CARD_SECONDS), "-i", "anullsrc=r=44100:cl=stereo"]
            a = "[0:a]aresample=44100,aformat=channel_layouts=stereo[a0];[3:a]aformat=channel_layouts=stereo[a1]"
            graph = f"{v0};{v1};{a};[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]"
            maps = ["-map", "[v]", "-map", "[a]", "-c:a", "aac", "-b:a", "128k"]
        else:
            graph = f"{v0};{v1};[v0][v1]concat=n=2:v=1:a=0[v]"
            maps = ["-map", "[v]", "-an"]
        # the mark picture loops forever, so the main video decides the length (shortest ends the first segment)
        graph = graph.replace("overlay=0:0", "overlay=0:0:shortest=1")
        cmd += ["-filter_complex", graph] + maps
        cmd += ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-movflags", "+faststart", dst_path]
        _run(cmd)


def cache_key(video_key: str, handle: str) -> str:
    """Where the marked copy lives in the bucket: under CACHE_PREFIX (so one lifecycle rule can expire them all), one per
    video and poster name."""
    stem = os.path.basename(os.path.splitext(video_key)[0])
    tag = hashlib.sha1(f"{video_key}|{handle}|{APP_NAME}|v1".encode()).hexdigest()[:10]
    return f"{CACHE_PREFIX}{stem}-{tag}.mp4"


def watermarked_url(video_url: str, handle: str) -> tuple[str | None, str]:
    """(public URL of the marked copy, reason). The copy of one of our own videos is made first if needed. The URL is None
    when this video is not one of ours (an external or sample link), too long, or anything fails: the caller then saves
    the plain file, and the reason says why (shown to the person, so it stays short and has no secrets)."""
    key = storage.key_from_view_url(video_url)
    if key is None:
        return None, "this video is not stored on our own storage address (check R2_PUBLIC_BASE_URL)"
    out_key = cache_key(key, handle)
    try:
        if storage.object_exists(out_key):
            return storage.view_url_for_key(out_key), "ok"
        with tempfile.TemporaryDirectory() as tmp:
            src = os.path.join(tmp, "src" + (os.path.splitext(key)[1] or ".mp4"))
            dst = os.path.join(tmp, "marked.mp4")
            storage.download_object(key, src)
            make_watermarked(src, dst, handle)
            storage.upload_file(dst, out_key, "video/mp4", IMMUTABLE_CACHE)
        return storage.view_url_for_key(out_key), "ok"
    except ValueError as e:
        return None, str(e)[:120]
    except subprocess.CalledProcessError as e:
        log.exception("marked copy failed for %s", key)
        tail = (e.stderr or b"").decode("utf-8", "ignore").strip().splitlines()
        return None, "video tool failed" + (": " + tail[-1][:100] if tail else "")
    except Exception as e:
        log.exception("marked copy failed for %s", key)
        return None, f"{type(e).__name__}: {str(e)[:100]}"
