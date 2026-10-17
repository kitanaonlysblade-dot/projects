from app.brand import APP_NAME
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from fastapi import Depends

from app import counters  # noqa: F401  (registers the cart_count refresh listener)
from app import observability
from app import push as push_delivery  # noqa: F401  (registers the push-after-commit listener)
from app.rate_limit import limiter
from app.twin_gate import require_twin_enabled
from app.routers import (
    admin,
    admin_moderation,
    auth,
    banners,
    cart,
    categories,
    deals,
    discounts,
    interests,
    mfa,
    merchant,
    notifications,
    orders,
    payments,
    products,
    push,
    reports,
    scan,
    search,
    sponsored,
    traffic,
    twin_search,
    creator,
    wanted,
    uploads,
    users,
    verification,
    video_posts,
)

observability.setup_logging()
observability.setup_sentry()

# Set ENVIRONMENT=production to hide the interactive API docs (/docs, /redoc, /openapi.json) from the public.
_PRODUCTION = os.environ.get("ENVIRONMENT", "").lower() == "production"
app = FastAPI(
    title=f"{APP_NAME} API",
    docs_url=None if _PRODUCTION else "/docs",
    redoc_url=None if _PRODUCTION else "/redoc",
    openapi_url=None if _PRODUCTION else "/openapi.json",
)
observability.install(app)



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
# CORS_ORIGINS is ADDED to the defaults (localhost and FRONTEND_URL), never a replacement for them: setting it
# to just the admin console's address must not lock the website out.
CORS_ORIGINS = []
for _origin in (_default_cors_origins + "," + os.environ.get("CORS_ORIGINS", "")).split(","):
    _origin = _origin.strip().rstrip("/")
    if _origin and _origin not in CORS_ORIGINS:
        CORS_ORIGINS.append(_origin)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(mfa.router)
app.include_router(push.router)
app.include_router(categories.router)
app.include_router(banners.router)
app.include_router(deals.router)
app.include_router(products.router)
app.include_router(interests.router)
app.include_router(video_posts.router)
app.include_router(scan.router)
app.include_router(sponsored.router)
# The twin discovery layer (scan, Wanted board, creator twins inbox) is switched off unless
# TWIN_ENABLED is set (app/twin_config.enabled). /twin-config stays on: seller tagging uses it.
app.include_router(twin_search.config_router)
app.include_router(twin_search.router, dependencies=[Depends(require_twin_enabled)])
app.include_router(wanted.router, dependencies=[Depends(require_twin_enabled)])
app.include_router(creator.router, dependencies=[Depends(require_twin_enabled)])
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
app.include_router(admin_moderation.router)
app.include_router(verification.router)
app.include_router(verification.admin_router)


@app.on_event("startup")
def _start_jobs() -> None:
    """Run queued background jobs (video optimising, scan fingerprinting) in a thread of this process unless a
    dedicated worker service does it (RUN_JOBS_IN_WEB=false). See app/jobs.py."""
    from app import jobs

    app.state.jobs_stop = jobs.start_in_web()


@app.on_event("shutdown")
def _stop_jobs() -> None:
    stop = getattr(app.state, "jobs_stop", None)
    if stop is not None:
        stop.set()


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/health/ready")
def ready():
    """Like /health, but also proves the database answers. For uptime monitors and dashboards - the host's own
    restart check stays on /health so a slow database doesn't get the whole service restarted."""
    from fastapi.responses import JSONResponse
    from sqlalchemy import text

    from app.database import SessionLocal

    db = SessionLocal()
    try:
        db.execute(text("SELECT 1"))
        return {"status": "ok", "database": "ok"}
    except Exception:
        observability.log.exception("readiness check: database unreachable")
        return JSONResponse(status_code=503, content={"status": "unavailable", "database": "down"})
    finally:
        db.close()
