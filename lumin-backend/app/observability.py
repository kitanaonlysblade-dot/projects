"""Logging, error reporting and basic response hardening.

- One log line per request: method, path (never the query string - it can hold tokens), status, milliseconds,
  and a request id that is also returned in the `X-Request-ID` header so a customer's screenshot can be matched
  to the log line.
- Unhandled errors are logged with the traceback and answered with a plain 500 that carries the request id.
- Sentry reports errors when SENTRY_DSN is set; nothing is sent otherwise. Personal data is not attached.
- Safe response headers on every reply.
"""
import logging
import os
import re
import time
import uuid

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

log = logging.getLogger("lumin")

_SAFE_ID = re.compile(r"^[A-Za-z0-9._-]{8,64}$")

SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "Cross-Origin-Resource-Policy": "cross-origin",  # the app and admin load API images/videos from another origin
}


def setup_logging() -> None:
    level = os.environ.get("LOG_LEVEL", "INFO").upper()
    logging.basicConfig(level=level, format="%(asctime)s %(levelname)s %(name)s %(message)s", force=False)
    logging.getLogger("lumin").setLevel(level)


def setup_sentry() -> bool:
    dsn = os.environ.get("SENTRY_DSN", "").strip()
    if not dsn:
        return False
    try:
        import sentry_sdk
    except ImportError:
        log.warning("SENTRY_DSN is set but sentry-sdk is not installed")
        return False
    sentry_sdk.init(
        dsn=dsn,
        environment=os.environ.get("ENVIRONMENT", "production"),
        traces_sample_rate=float(os.environ.get("SENTRY_TRACES_SAMPLE_RATE", "0")),
        send_default_pii=False,
    )
    return True


def install(app: FastAPI) -> None:
    @app.middleware("http")
    async def request_log(request: Request, call_next):
        incoming = request.headers.get("x-request-id", "")
        rid = incoming if _SAFE_ID.match(incoming) else uuid.uuid4().hex
        request.state.request_id = rid  # shared with the error handler below (same ASGI scope)
        started = time.perf_counter()
        status = "ERR"
        try:
            response = await call_next(request)
            status = response.status_code
        finally:
            ms = (time.perf_counter() - started) * 1000
            # /health is polled constantly by the host; keep it out of the logs
            if request.url.path not in ("/health", "/health/ready"):
                log.info("%s %s %s %.0fms rid=%s", request.method, request.url.path, status, ms, rid)
        response.headers["X-Request-ID"] = rid
        for k, v in SECURITY_HEADERS.items():
            response.headers.setdefault(k, v)
        return response

    @app.exception_handler(Exception)
    async def unhandled(request: Request, exc: Exception):
        rid = getattr(request.state, "request_id", None) or uuid.uuid4().hex
        log.exception("unhandled error on %s %s rid=%s", request.method, request.url.path, rid)
        return JSONResponse(
            status_code=500,
            content={"detail": "Something went wrong on our side. Please try again.", "request_id": rid},
            headers={"X-Request-ID": rid},
        )
