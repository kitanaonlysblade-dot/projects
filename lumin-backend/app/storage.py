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

_s3 = boto3.client(
    "s3",
    endpoint_url=f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com",
    aws_access_key_id=R2_ACCESS_KEY_ID,
    aws_secret_access_key=R2_SECRET_ACCESS_KEY,
    config=Config(signature_version="s3v4"),
    region_name="auto",
)


class PresignedUpload(NamedTuple):
    upload_url: str
    view_url: str
    file_key: str


def create_presigned_upload(content_type: str) -> PresignedUpload:
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

    file_key = f"{subdir}/{uuid.uuid4()}{_EXTENSIONS[content_type]}"

    upload_url = _s3.generate_presigned_url(
        ClientMethod="put_object",
        Params={"Bucket": R2_BUCKET_NAME, "Key": file_key, "ContentType": content_type},
        ExpiresIn=PRESIGN_EXPIRE_SECONDS,
    )
    return PresignedUpload(
        upload_url=upload_url,
        view_url=f"{R2_PUBLIC_BASE_URL}/{file_key}",
        file_key=file_key,
    )
