from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_active_user
from app.models import User
from app.schemas.uploads import PresignedUploadRequest, PresignedUploadResponse
from app.storage import create_presigned_upload

router = APIRouter(prefix="/uploads", tags=["uploads"])

# Any logged-in user can request one — this isn't merchant-only, since a
# personal discover post needs to upload a video too (see
# handleAddDiscoverPost on the frontend). What gets attached to a merchant
# product vs. a personal post is still enforced by the merchant/video-post
# routes themselves, same as always; this route only ever hands back a
# URL, it never decides what that URL is allowed to be used for.


@router.post("/presigned-url", response_model=PresignedUploadResponse)
def request_presigned_upload(
    payload: PresignedUploadRequest,
    current_user: User = Depends(get_current_active_user),
):
    """Step 1 of the two-step upload lib/api.ts's uploadFile() does —
    this route never sees the file itself, only its declared
    content-type, and hands back a short-lived R2 URL for the client to
    PUT the actual bytes to directly (step 2, straight to Cloudflare R2,
    never back through this backend). That's the whole point of a
    presigned upload: a large video no longer has to pass through this
    API server's own request/response cycle just to end up somewhere
    else anyway.

    No file-size limit enforced here — unlike the old multipart
    endpoint, this backend never receives the bytes, so it has nothing
    to measure. A presigned PUT (as opposed to a presigned POST with a
    policy document) also has no way to cap the upload's size on R2's
    side either. What's left: content-type is still checked before a
    URL is ever signed (create_presigned_upload raises ValueError for
    anything outside app/storage.py's ALLOWED_IMAGE_TYPES/
    ALLOWED_VIDEO_TYPES), and lib/api.ts's uploadFile() still rejects an
    oversized file client-side before it ever calls this route — a
    real hardened deployment would want a size cap enforced server-side
    too (a Cloudflare Worker in front of the bucket, or switching to a
    presigned POST policy), since a client-side check alone doesn't
    stop a request built by hand.
    """
    try:
        result = create_presigned_upload(payload.file_type)
    except ValueError as exc:
        raise HTTPException(status_code=415, detail=str(exc)) from exc
    return PresignedUploadResponse(
        upload_url=result.upload_url, view_url=result.view_url, file_key=result.file_key
    )
