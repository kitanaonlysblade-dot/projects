"""Which uploaded videos a phone may struggle to play, and how to convert them.

A video recorded on a desktop is often not what a phone's player handles well: a screen recording saved as WebM
(VP8/VP9), HEVC from a Mac, 4K or 60 fps footage, 10-bit colour, or a very high bitrate. Phones then stall, show a
black frame or play without sound. These videos are converted once, after upload, to the format every phone plays:
H.264 video (8-bit, 4:2:0), AAC sound, an MP4 container with the index at the front, at most 1080p and 30 fps.
Anything already in that shape is left exactly as it is.

Pure helpers only (no ffmpeg or database here), so the rules can be tested on their own.
"""

MAX_SHORT_SIDE = 1080
MAX_FPS = 30
MAX_BITRATE = 8_000_000  # bits per second, video stream (or the whole file when the stream does not say)
PHONE_AUDIO = {"aac", "mp3"}


def _video_stream(info: dict) -> dict | None:
    return next((s for s in info.get("streams", []) if s.get("codec_type") == "video"), None)


def _audio_stream(info: dict) -> dict | None:
    return next((s for s in info.get("streams", []) if s.get("codec_type") == "audio"), None)


def _fps(stream: dict) -> float:
    raw = stream.get("avg_frame_rate") or stream.get("r_frame_rate") or "0/1"
    try:
        num, _, den = raw.partition("/")
        return float(num) / float(den or 1) if float(den or 1) else 0.0
    except (ValueError, ZeroDivisionError):
        return 0.0


def _bitrate(info: dict, stream: dict) -> int:
    for raw in (stream.get("bit_rate"), (info.get("format") or {}).get("bit_rate")):
        try:
            if raw:
                return int(raw)
        except (TypeError, ValueError):
            continue
    return 0


def needs_compat(info: dict, ext: str) -> bool:
    """True when this file should be converted for phones."""
    video = _video_stream(info)
    if video is None:
        return False  # nothing we can do with a file that has no picture
    if ext.lower() == ".webm":
        return True
    if video.get("codec_name") != "h264":
        return True
    if video.get("pix_fmt") not in (None, "yuv420p"):
        return True
    width, height = int(video.get("width") or 0), int(video.get("height") or 0)
    if width and height and min(width, height) > MAX_SHORT_SIDE:
        return True
    if _fps(video) > MAX_FPS + 0.5:
        return True
    if _bitrate(info, video) > MAX_BITRATE:
        return True
    audio = _audio_stream(info)
    if audio is not None and audio.get("codec_name") not in PHONE_AUDIO:
        return True
    return False


def compat_command(src: str, dst: str, info: dict) -> list[str]:
    """The ffmpeg command that makes the phone-friendly copy."""
    video = _video_stream(info) or {}
    filters = [
        f"scale=w='if(gt(iw,ih),-2,min({MAX_SHORT_SIDE},iw))':h='if(gt(iw,ih),min({MAX_SHORT_SIDE},ih),-2)'"
    ]
    if _fps(video) > MAX_FPS + 0.5:
        filters.append(f"fps={MAX_FPS}")
    cmd = [
        "ffmpeg", "-y", "-i", src,
        "-vf", ",".join(filters),
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
        "-profile:v", "high", "-level", "4.1", "-pix_fmt", "yuv420p",
        "-maxrate", "6M", "-bufsize", "12M",
        "-movflags", "+faststart",
    ]
    if _audio_stream(info) is not None:
        cmd += ["-c:a", "aac", "-b:a", "128k", "-ac", "2"]
    else:
        cmd += ["-an"]
    return cmd + [dst]
