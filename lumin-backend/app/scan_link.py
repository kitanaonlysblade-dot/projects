"""Scan from a link: "someone sent me this video link - what is in it?"

Three kinds of link:
  * a Lumin link (/v/<id>, or ?post=<id>)  -> already known, no matching needed
  * a direct video file (https://.../clip.mp4) -> downloaded here and matched like a recording
  * a page on TikTok / Instagram / YouTube / ... -> NOT opened: those sites don't allow their videos to be
    downloaded by other services, and they block servers anyway. The person is asked to screen-record instead.

The download is the risky part (the server is fetching an address a stranger typed), so it is locked down:
only http(s) on ports 80/443, every address the name resolves to must be a public one (no localhost, private
networks or cloud metadata addresses), redirects are followed by hand (max 3) and re-checked each time, and
size and time are capped.
"""
import ipaddress
import os
import re
import socket
import time
import uuid
from urllib.parse import parse_qs, urljoin, urlparse

import requests

MAX_LINK_BYTES = int(os.environ.get("SCAN_MAX_LINK_MB", "60")) * 1024 * 1024
DEADLINE_S = float(os.environ.get("SCAN_LINK_TIMEOUT_S", "25"))
MAX_REDIRECTS = 3
VIDEO_EXT = (".mp4", ".mov", ".webm", ".m4v", ".mkv", ".3gp")

SOCIAL_HOSTS = (
    "tiktok.com", "instagram.com", "youtube.com", "youtu.be", "facebook.com", "fb.watch", "fb.com",
    "twitter.com", "x.com", "t.co", "snapchat.com", "pinterest.com", "vimeo.com", "reddit.com", "redd.it",
    "threads.net", "twitch.tv", "linkedin.com",
)

SOCIAL_MESSAGE = (
    "We can't open links from social apps - they don't let other services take their videos. "
    "Screen-record the video instead and upload the recording here."
)

_UUID = r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"


class LinkError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message, self.status = message, status


def parse_url(raw: str):
    raw = (raw or "").strip()
    if raw and "://" not in raw:
        raw = "https://" + raw
    try:
        parsed = urlparse(raw)
        parsed.port  # noqa: B018  (raises on a malformed port)
    except ValueError:
        raise LinkError("That doesn't look like a link. Paste the full address of the video.")
    if parsed.scheme not in ("http", "https") or not parsed.hostname or "." not in parsed.hostname:
        raise LinkError("That doesn't look like a link. Paste the full address of the video.")
    return parsed


def lumin_post_id(parsed) -> uuid.UUID | None:
    """The video id inside a Lumin link: /v/<id> (shared page) or ?post=<id> (opens it in the app)."""
    match = re.search(rf"/v/({_UUID})(?:/|$)", parsed.path)
    candidate = match.group(1) if match else (parse_qs(parsed.query).get("post") or [None])[0]
    try:
        return uuid.UUID(candidate) if candidate else None
    except ValueError:
        return None


def is_social(host: str) -> bool:
    host = host.lower().rstrip(".")
    return any(host == h or host.endswith("." + h) for h in SOCIAL_HOSTS)


def _is_public(ip: str) -> bool:
    addr = ipaddress.ip_address(ip)
    return not (
        addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_multicast or addr.is_reserved or addr.is_unspecified
    )


def check_public_host(host: str, port: int | None) -> None:
    if port not in (None, 80, 443):
        raise LinkError("That link isn't one we can open.")
    try:
        infos = socket.getaddrinfo(host, port or 443, proto=socket.IPPROTO_TCP)
    except socket.gaierror:
        raise LinkError("We couldn't reach that link. Check the address and try again.")
    if not infos or not all(_is_public(info[4][0]) for info in infos):
        raise LinkError("That link isn't one we can open.")


def fetch_video(url: str, dest_dir: str) -> str:
    """Download a direct video link to a temp file and return its path. Raises LinkError with a message the
    person can read."""
    deadline = time.monotonic() + DEADLINE_S
    current = url
    for _ in range(MAX_REDIRECTS + 1):
        parsed = parse_url(current)
        if is_social(parsed.hostname):
            raise LinkError(SOCIAL_MESSAGE)
        check_public_host(parsed.hostname, parsed.port)
        try:
            resp = requests.get(
                current, stream=True, allow_redirects=False, timeout=(5, 10),
                headers={"User-Agent": "LuminScan/1.0", "Accept": "video/*,*/*;q=0.5"},
            )
        except requests.RequestException:
            raise LinkError("We couldn't reach that link. Check the address and try again.")
        if resp.is_redirect or resp.status_code in (301, 302, 303, 307, 308):
            location = resp.headers.get("Location")
            resp.close()
            if not location:
                raise LinkError("We couldn't open that link.")
            current = urljoin(current, location)
            continue
        break
    else:
        raise LinkError("That link redirects too many times.")

    try:
        if resp.status_code != 200:
            raise LinkError("We couldn't open that link - it may need a login or no longer exist.")
        ctype = (resp.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        path_lower = urlparse(current).path.lower()
        looks_video = ctype.startswith("video/") or (
            ctype in ("application/octet-stream", "binary/octet-stream") and path_lower.endswith(VIDEO_EXT)
        )
        if not looks_video:
            raise LinkError("That link isn't a video file. Paste a direct video link, or screen-record the video and upload it.")
        declared = int(resp.headers.get("Content-Length") or 0)
        if declared > MAX_LINK_BYTES:
            raise LinkError(f"That video is too large to scan from a link (max {MAX_LINK_BYTES // (1024 * 1024)} MB).")
        suffix = os.path.splitext(path_lower)[1]
        path = os.path.join(dest_dir, "link" + (suffix if suffix in VIDEO_EXT else ".mp4"))
        size = 0
        with open(path, "wb") as out:
            for chunk in resp.iter_content(1 << 20):
                size += len(chunk)
                if size > MAX_LINK_BYTES:
                    raise LinkError(f"That video is too large to scan from a link (max {MAX_LINK_BYTES // (1024 * 1024)} MB).")
                if time.monotonic() > deadline:
                    raise LinkError("That link took too long to download.")
                out.write(chunk)
        return path
    except requests.RequestException:
        raise LinkError("The download was interrupted. Try again.")
    finally:
        resp.close()


# ------------------------------------------------------------------ preview picture of a social-app link
# The official, public "oEmbed" address of an app returns the title and the preview picture of a public video.
# We never download the video itself - only that one picture - and we only use it to look for a match.
OEMBED = {
    "tiktok.com": "https://www.tiktok.com/oembed?url={u}",
    "youtube.com": "https://www.youtube.com/oembed?format=json&url={u}",
    "youtu.be": "https://www.youtube.com/oembed?format=json&url={u}",
}
MAX_IMAGE_BYTES = 4 * 1024 * 1024
MAX_JSON_BYTES = 256 * 1024


def _oembed_endpoint(host: str) -> str | None:
    host = host.lower().rstrip(".")
    for h, tpl in OEMBED.items():
        if host == h or host.endswith("." + h):
            return tpl
    return None


def _get_limited(url: str, *, limit: int, kinds: tuple[str, ...], deadline: float) -> bytes | None:
    """GET a small public resource with the same protections as fetch_video; None if anything is off."""
    current = url
    for _ in range(MAX_REDIRECTS + 1):
        parsed = parse_url(current)
        check_public_host(parsed.hostname, parsed.port)
        try:
            resp = requests.get(
                current, stream=True, allow_redirects=False, timeout=(5, 8),
                headers={"User-Agent": "LuminScan/1.0", "Accept": ",".join(kinds)},
            )
        except requests.RequestException:
            return None
        try:
            if resp.is_redirect or resp.status_code in (301, 302, 303, 307, 308):
                loc = resp.headers.get("Location")
                if not loc:
                    return None
                current = urljoin(current, loc)
                continue
            if resp.status_code != 200:
                return None
            ctype = (resp.headers.get("Content-Type") or "").split(";")[0].strip().lower()
            if not any(ctype.startswith(k.split("/")[0] + "/") and (k.endswith("/*") or ctype == k) for k in kinds):
                return None
            data = b""
            for chunk in resp.iter_content(64 * 1024):
                data += chunk
                if len(data) > limit or time.monotonic() > deadline:
                    return None
            return data
        except requests.RequestException:
            return None
        finally:
            resp.close()
    return None


def fetch_thumbnail(url: str) -> bytes | None:
    """The preview picture of a public TikTok/YouTube video, as image bytes, or None when the app does not give
    one (private video, unknown app, blocked, offline)."""
    import json as _json
    from urllib.parse import quote
    parsed = parse_url(url)
    tpl = _oembed_endpoint(parsed.hostname)
    if tpl is None:
        return None
    clean = url if "://" in url else "https://" + url.strip()
    deadline = time.monotonic() + DEADLINE_S
    try:
        raw = _get_limited(tpl.format(u=quote(clean, safe="")), limit=MAX_JSON_BYTES, kinds=("application/json",), deadline=deadline)
        if raw is None:
            return None
        thumb = _json.loads(raw.decode("utf-8", "replace")).get("thumbnail_url")
        if not isinstance(thumb, str) or not thumb.startswith("https://"):
            return None
        return _get_limited(thumb, limit=MAX_IMAGE_BYTES, kinds=("image/*",), deadline=deadline)
    except (LinkError, ValueError, AttributeError):
        return None
