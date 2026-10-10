from pydantic import BaseModel


class PresignedUploadRequest(BaseModel):
    # e.g. "video/mp4", "image/jpeg" — checked against
    # app/storage.py's ALLOWED_IMAGE_TYPES/ALLOWED_VIDEO_TYPES before a
    # URL is ever signed. The client's own File/Blob.type, unchanged —
    # lib/api.ts's uploadFile() sends exactly what the browser reports.
    file_type: str


class PresignedUploadResponse(BaseModel):
    # Where the client PUTs the raw bytes — straight to Cloudflare R2,
    # never through this backend. Signed for one object key only and
    # expires shortly after issue (see PRESIGN_EXPIRE_SECONDS); unused
    # past that window, it's just a dead URL.
    upload_url: str
    # What actually goes into video_url/image_urls/thumbnail_url once
    # the PUT above succeeds — this is the one part of the response the
    # rest of the app (VideoPost, Product, etc.) ever sees or stores.
    view_url: str
    # The object's key inside the bucket (e.g. "videos/<uuid>.mp4") —
    # not currently used by the frontend, but returned in case a future
    # caller needs it (deleting the object directly, for instance)
    # without having to parse it back out of view_url.
    file_key: str
