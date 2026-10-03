import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from app.ensure_schema import ensure_comment_schema
from app.rate_limit import limiter
from app.routers import (
    admin,
    auth,
    banners,
    cart,
    categories,
    deals,
    discounts,
    interests,
    merchant,
    notifications,
    orders,
    payments,
    products,
    reports,
    search,
    traffic,
    uploads,
    users,
    video_posts,
)

app = FastAPI(title="Lumin API")


@app.on_event("startup")
def _upgrade_schema() -> None:
    ensure_comment_schema()

# Backs the @limiter.limit(...) decorators on specific routes in auth.py
# and payments.py (see app/rate_limit.py's own comment on why this has
# to be the same instance those import) — a request that trips a limit
# gets slowapi's standard 429 response instead of reaching the route.
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

# The two local dev origins (consumer app on 3000, the separate admin
# console on 3001) stay allowed unconditionally — harmless in
# production, since nothing external can reach a developer's own
# localhost — and FRONTEND_URL (auth.py's own env var, already required
# there for password-reset links to point somewhere real) is folded in
# automatically so a deployment that's already set that one var doesn't
# also have to duplicate it here just for CORS. CORS_ORIGINS, a
# comma-separated list, is for anything beyond that single deployed
# frontend — most commonly the admin console once it's deployed
# somewhere too, since that's a second, different origin FRONTEND_URL
# alone can't cover.
_default_cors_origins = f"http://localhost:3000,http://localhost:3001,{auth.FRONTEND_URL}"
CORS_ORIGINS = [origin.strip() for origin in os.environ.get("CORS_ORIGINS", _default_cors_origins).split(",") if origin.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(categories.router)
app.include_router(banners.router)
app.include_router(deals.router)
app.include_router(products.router)
app.include_router(interests.router)
app.include_router(video_posts.router)
app.include_router(search.router)
app.include_router(cart.router)
app.include_router(orders.router)
app.include_router(payments.router)
app.include_router(discounts.router)
app.include_router(merchant.router)
app.include_router(uploads.router)
app.include_router(users.router)
app.include_router(notifications.router)
app.include_router(reports.router)
app.include_router(traffic.router)
app.include_router(admin.router)


@app.get("/health")
def health():
    return {"status": "ok"}
