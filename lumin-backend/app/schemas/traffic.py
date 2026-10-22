from pydantic import BaseModel


class TrafficSourceCreate(BaseModel):
    """POST /traffic's body — sent once per app load from the frontend.
    Every field optional: a session with no referrer and no UTM params
    (someone typed the URL directly, or opened an already-bookmarked
    tab) is itself a meaningful, real category ("direct"), not missing
    data — the admin analytics query groups a row with everything null
    into that bucket rather than dropping it."""

    referrer: str | None = None
    utm_source: str | None = None
    utm_medium: str | None = None
    utm_campaign: str | None = None
