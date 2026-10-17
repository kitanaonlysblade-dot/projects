import os
import uuid
from typing import NamedTuple

import boto3
from botocore.config import Config

# Media (video posts, product photos, avatars, thumbnails) lives on
# Cloudflare R2, not this server's own disk — the point of a presigned
# upload is that the actual bytes never pass through this API at all
# (see create_presigned_upload below and routers/uploads.py). R2 speaks
# the plain S3 API under a different endpoint, with no regions worth
# distinguishing, so the standard boto3 S3 client works unmodified —
# just pointed at R2 instead of AWS.
#
# Same "fail loudly on boot if unset" convention as DATABASE_URL
# (database.py), JWT_SECRET_KEY (auth/security.py), and
# PAYSTACK_SECRET_KEY (app/paystack.py) — a deployment missing any of
# these should never silently come up half-broken. docker-compose.yml
# supplies dev-placeholder values for local `docker compose up`, same
# as it already does for the Paystack/Google keys — uploads specifically
# won't work against those placeholders, everything else in the API
# still will (see that file's own comment).
R2_ACCOUNT_ID = os.environ["R2_ACCOUNT_ID"]
R2_ACCESS_KEY_ID = os.environ["R2_ACCESS_KEY_ID"]
R2_SECRET_ACCESS_KEY = os.environ["R2_SECRET_ACCESS_KEY"]
R2_BUCKET_NAME = os.environ["R2_BUCKET_NAME"]
# Whatever's actually public for this bucket — R2's own free
# <bucket>.<account-hash>.r2.dev subdomain, or a custom domain mapped to
# it in the Cloudflare dashboard. Only used to *build* view_url below;
# unrelated to endpoint_url, which is always R2's private S3-API host
# regardless of whatever the bucket's public domain happens to be.
R2_PUBLIC_BASE_URL = os.environ["R2_PUBLIC_BASE_URL"].rstrip("/")

ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
ALLOWED_VIDEO_TYPES = {"video/mp4", "video/quicktime", "video/webm"}
# Explicit map rather than Python's mimetypes.guess_extension — that
# module's coverage of image/webp and video/quicktime/webm varies by
# Python build/OS, and the whole point of a fixed ALLOWED_* set is that
# every possible content_type already has one obvious right answer, not
# something to leave to a stdlib guess.
_EXTENSIONS = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "video/mp4": ".mp4",
    "video/quicktime": ".mov",
    "video/webm": ".webm",
}
# How long the signed PUT URL stays usable for, starting from when it's
# issued — not from whenever the client gets around to starting the
# actual upload. Generous enough for a slow mobile connection uploading
# a large video without leaving a signed URL exploitable long after a
# session that never used it.
PRESIGN_EXPIRE_SECONDS = 600
# Same limits the app checks before uploading (lib/api.ts). Enforced here too, because a request built by hand
# skips the app's check.
MAX_IMAGE_BYTES = int(os.environ.get("MAX_IMAGE_MB", "10")) * 1024 * 1024
MAX_VIDEO_BYTES = int(os.environ.get("MAX_VIDEO_MB", "200")) * 1024 * 1024
# Sign the exact size into the URL so storage refuses any other length. Set SIGN_UPLOAD_SIZE=false to turn this
# off if your storage provider rejects signed Content-Length (the size limit above still applies at request time).
SIGN_UPLOAD_SIZE = os.environ.get("SIGN_UPLOAD_SIZE", "true").lower() != "false"

_s3 = boto3.client(
    "s3",
    endpoint_url=f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com",
    aws_access_key_id=R2_ACCESS_KEY_ID,
    aws_secret_access_key=R2_SECRET_ACCESS_KEY,
    config=Config(signature_version="s3v4"),
    region_name="auto",
)


class TooLarge(ValueError):
    pass


class PresignedUpload(NamedTuple):
    upload_url: str
    view_url: str
    file_key: str


def create_presigned_upload(content_type: str, file_size: int | None = None) -> PresignedUpload:
    """Signs a one-time PUT URL good for exactly one, brand-new object
    key. R2 will reject the client's PUT if its own Content-Type header
    doesn't match what's signed here — that match is the only
    server-side content-type enforcement left once the bytes themselves
    skip this app's server entirely (there's deliberately no equivalent
    check for file *size*: a presigned PUT URL, unlike a presigned POST
    with a policy document, has no way to cap how many bytes the client
    sends — see routers/uploads.py's own comment on this).

    Raises ValueError for a content_type this app doesn't accept;
    routers/uploads.py turns that into the same 415 the old multipart
    endpoint used to return for the same case.
    """
    if content_type in ALLOWED_IMAGE_TYPES:
        subdir = "images"
    elif content_type in ALLOWED_VIDEO_TYPES:
        subdir = "videos"
    else:
        raise ValueError(f"Unsupported file type: {content_type}")

    if file_size is not None:
        limit = MAX_VIDEO_BYTES if subdir == "videos" else MAX_IMAGE_BYTES
        if file_size > limit:
            raise TooLarge(f"File too large - max {limit // (1024 * 1024)} MB")

    file_key = f"{subdir}/{uuid.uuid4()}{_EXTENSIONS[content_type]}"

    params = {"Bucket": R2_BUCKET_NAME, "Key": file_key, "ContentType": content_type}
    if file_size is not None and SIGN_UPLOAD_SIZE:
        params["ContentLength"] = file_size
    upload_url = _s3.generate_presigned_url(
        ClientMethod="put_object",
        Params=params,
        ExpiresIn=PRESIGN_EXPIRE_SECONDS,
    )
    return PresignedUpload(
        upload_url=upload_url,
        view_url=f"{R2_PUBLIC_BASE_URL}/{file_key}",
        file_key=file_key,
    )


def key_from_view_url(url: str | None) -> str | None:
    """The bucket key behind one of our own public URLs, or None for
    anything else (an external link, a /videos/sample.mp4 mock path)."""
    if not url:
        return None
    prefix = f"{R2_PUBLIC_BASE_URL}/"
    return url[len(prefix):] if url.startswith(prefix) else None


def view_url_for_key(key: str) -> str:
    return f"{R2_PUBLIC_BASE_URL}/{key}"


def download_object(key: str, dest_path: str) -> None:
    _s3.download_file(R2_BUCKET_NAME, key, dest_path)


def object_exists(key: str) -> bool:
    from botocore.exceptions import ClientError

    try:
        _s3.head_object(Bucket=R2_BUCKET_NAME, Key=key)
        return True
    except ClientError as e:
        if e.response.get("Error", {}).get("Code") in ("404", "NoSuchKey", "NotFound"):
            return False
        raise


def upload_file(path: str, key: str, content_type: str, cache_control: str | None = None) -> None:
    extra = {"ContentType": content_type}
    if cache_control:
        extra["CacheControl"] = cache_control
    _s3.upload_file(path, R2_BUCKET_NAME, key, ExtraArgs=extra)


def delete_view_urls(urls: "list[str | None]") -> None:
    """Best-effort removal of uploaded media given the public URLs we stored for it. Never
    raises: a failed delete leaves an orphan file, which must not undo or block whatever
    database change (an account deletion, say) it follows."""
    keys = [k for k in (key_from_view_url(u) for u in urls if u) if k]
    for i in range(0, len(keys), 1000):
        try:
            _s3.delete_objects(
                Bucket=R2_BUCKET_NAME,
                Delete={"Objects": [{"Key": k} for k in keys[i : i + 1000]], "Quiet": True},
            )
        except Exception:  # noqa: BLE001
            pass


# ---- Private files (ID documents for seller verification) -------------------------------------------------------------
# These must never be reachable by a public link, so they go in a SEPARATE bucket with no public access
# (R2_PRIVATE_BUCKET_NAME; same API credentials, which must be allowed to read/write it). They are uploaded through
# this server (small images, size-checked here), shown to an admin through a link that expires in minutes, and deleted
# as soon as the review is decided. With no private bucket configured the feature switches itself off rather than
# fall back to the public one.
R2_PRIVATE_BUCKET_NAME = os.environ.get("R2_PRIVATE_BUCKET_NAME", "").strip()
PRIVATE_VIEW_SECONDS = 300


def private_enabled() -> bool:
    return bool(R2_PRIVATE_BUCKET_NAME) and R2_PRIVATE_BUCKET_NAME != R2_BUCKET_NAME


def put_private(key: str, data: bytes, content_type: str) -> None:
    if not private_enabled():
        raise RuntimeError("private storage is not configured")
    _s3.put_object(Bucket=R2_PRIVATE_BUCKET_NAME, Key=key, Body=data, ContentType=content_type, CacheControl="private, no-store")


def private_view_url(key: str | None) -> str | None:
    """A link to one private file that stops working after a few minutes."""
    if not key or not private_enabled():
        return None
    return _s3.generate_presigned_url(
        ClientMethod="get_object", Params={"Bucket": R2_PRIVATE_BUCKET_NAME, "Key": key}, ExpiresIn=PRIVATE_VIEW_SECONDS
    )


def delete_private(keys: "list[str | None]") -> None:
    """Best-effort, never raises (same reasoning as delete_view_urls)."""
    keys = [k for k in keys if k]
    if not keys or not private_enabled():
        return
    try:
        _s3.delete_objects(Bucket=R2_PRIVATE_BUCKET_NAME, Delete={"Objects": [{"Key": k} for k in keys], "Quiet": True})
    except Exception:  # noqa: BLE001
        pass
