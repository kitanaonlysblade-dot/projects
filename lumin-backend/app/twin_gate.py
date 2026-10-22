"""FastAPI dependency that hides the twin discovery routes while TWIN_ENABLED is off."""
from fastapi import HTTPException

from app import twin_config


def require_twin_enabled() -> None:
    if not twin_config.enabled():
        # 404, not 403: as far as the app is concerned the feature doesn't exist.
        raise HTTPException(status_code=404, detail="Not found")
