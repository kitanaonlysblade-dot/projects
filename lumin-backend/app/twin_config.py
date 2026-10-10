"""Every tunable number behind twins and twin search, in one place.

Each value can be overridden with an environment variable (TWIN_<NAME>) so it
can be tuned from real data without a deploy. The frontend reads the few it
needs from GET /twin-config.
"""
import os


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(f"TWIN_{name}", default))
    except ValueError:
        return default


def _float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(f"TWIN_{name}", default))
    except ValueError:
        return default


def enabled() -> bool:
    """Master switch for the twin *discovery* layer: scan/twin search, the Wanted board, the
    creator twins inbox and impact page, twin notifications and the waitlist. Off unless
    TWIN_ENABLED is set to true/1/yes/on. Read on every call, so it can be flipped (and
    tested) without re-importing. Sellers tagging products on their own videos (the product
    pills) is not part of it and always works."""
    return os.environ.get("TWIN_ENABLED", "").strip().lower() in ("1", "true", "yes", "on")


# A twin must be on screen at least this long.
MIN_TWIN_MS = _int("MIN_TWIN_MS", 1000)
# Longest clip a viewer can search with.
MAX_REQUEST_CLIP_MS = _int("MAX_REQUEST_CLIP_MS", 30_000)
# Approved twins (and no flagged ones) before a seller skips review.
TRUST_AFTER_APPROVED = _int("TRUST_AFTER_APPROVED", 5)

# --- Twin search -----------------------------------------------------------
# A catalog product counts as a "twin match" for a description at or above this
# score (0..1, see app/twin_match.py). Lower = more results, more false matches.
SEARCH_MIN_SCORE = _float("SEARCH_MIN_SCORE", 0.55)
# Below SEARCH_MIN_SCORE but at least this still shows under "Closest we have" when
# nothing matched (they never count as a match, a pick or a notification).
SEARCH_CLOSEST_MIN_SCORE = _float("SEARCH_CLOSEST_MIN_SCORE", 0.15)
SEARCH_CLOSEST_MAX = _int("SEARCH_CLOSEST_MAX", 4)
# Most matches one search returns.
SEARCH_MAX_RESULTS = _int("SEARCH_MAX_RESULTS", 8)
# --- Moment index ("video Shazam") ------------------------------------------------
# A cart-add or a tap on Buy proves nothing about what is in a video, so neither
# is trusted on its own. A moment->product link only drives results once enough
# DIFFERENT shoppers have each (a) clipped that moment, (b) described it in words that
# really fit the product, (c) picked it, and then (d) kept it: the order was delivered
# and the 24h claim window passed with no return claim. Everything below is tunable.
MOMENT_MIN_BUYERS = _int("MOMENT_MIN_BUYERS", 2)
# Words<->product fit (0..1, same scale as SEARCH_MIN_SCORE) a pick needs to count at all:
# stricter than showing a result, so a loose description can't vouch for a product.
MOMENT_EVIDENCE_MIN_SCORE = _float("MOMENT_EVIDENCE_MIN_SCORE", 0.75)
# Clips longer than this are too wide to say what is where, so they teach nothing.
MOMENT_EVIDENCE_MAX_CLIP_MS = _int("MOMENT_EVIDENCE_MAX_CLIP_MS", 10_000)
# A new clip joins an existing link only if it overlaps it at least this much (IoU 0..1).
MOMENT_LINK_MIN_IOU = _float("MOMENT_LINK_MIN_IOU", 0.4)
# A search clip uses a link if it covers at least this fraction of the shorter of the two.
MOMENT_QUERY_MIN_OVERLAP = _float("MOMENT_QUERY_MIN_OVERLAP", 0.5)
# Rival products picked for the same moment: a link needs this share of the support.
MOMENT_MIN_SHARE = _float("MOMENT_MIN_SHARE", 0.6)
# A shopper who only added to cart (never bought and kept it) counts for this much
# of a buyer, in the share calculation only - never towards MOMENT_MIN_BUYERS.
MOMENT_CART_WEIGHT = _float("MOMENT_CART_WEIGHT", 0.25)
# The purchase must follow the pick within this many days to count for it.
MOMENT_PURCHASE_WINDOW_DAYS = _int("MOMENT_PURCHASE_WINDOW_DAYS", 7)
# Evidence older than this stops counting (products and videos change).
MOMENT_EVIDENCE_TTL_DAYS = _int("MOMENT_EVIDENCE_TTL_DAYS", 365)
# One shopper can vouch for at most this many products on one video.
MOMENT_MAX_PER_USER_VIDEO = _int("MOMENT_MAX_PER_USER_VIDEO", 5)
# Waiting searches older than this are no longer matched against new products.
SEARCH_WAIT_DAYS = _int("SEARCH_WAIT_DAYS", 90)
# The public Wanted board only lists a request once this many different shoppers want it,
# so one person's free text isn't published to everyone the moment they type it.
# Set to 1 to list requests instantly.
WANTED_MIN_USERS = _int("WANTED_MIN_USERS", 2)
# Two asks about the same video are one request when their clips overlap this much (IoU),
# or overlap at all and share a meaningful word.
WANTED_MERGE_MIN_IOU = _float("WANTED_MERGE_MIN_IOU", 0.6)
# Two asks about one moment that both circled something are the same request only when
# the circles overlap this much (IoU): "the jacket" and "the bag" stay separate.
WANTED_BOX_MIN_IOU = _float("WANTED_BOX_MIN_IOU", 0.25)
WANTED_NEARBY_MAX = _int("WANTED_NEARBY_MAX", 5)
# Keyword insights: how many keywords a merchant without a subscription gets to peek at.
INSIGHTS_PREVIEW_KEYWORDS = _int("INSIGHTS_PREVIEW_KEYWORDS", 3)


def public() -> dict:
    return {
        "min_twin_ms": MIN_TWIN_MS,
        "max_request_clip_ms": MAX_REQUEST_CLIP_MS,
    }


# --- Compare list ("N twinned this moment") ---------------------------------------
# How well a twinned product fits the words of the request, as shown next to it. Same
# 0..1 scale as SEARCH_MIN_SCORE; below PARTIAL it is shown as "Weak".
TWIN_MATCH_STRONG = _float("TWIN_MATCH_STRONG", 0.8)
TWIN_MATCH_PARTIAL = _float("TWIN_MATCH_PARTIAL", 0.3)
# A twin reported by this many different shoppers is hidden from compare lists until the
# admin Reports queue has looked at it (a single report never hides anything).
TWIN_REPORT_HIDE_AT = _int("TWIN_REPORT_HIDE_AT", 3)
# A seller whose shop is younger than this is marked "New seller" to the video's creator.
TWIN_NEW_SELLER_DAYS = _int("TWIN_NEW_SELLER_DAYS", 60)
