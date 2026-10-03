import logging
import os

import httpx

logger = logging.getLogger(__name__)

# Unlike PAYSTACK_SECRET_KEY/GOOGLE_CLIENT_ID (hard-required — this app
# genuinely can't take a payment or log someone in without those),
# RESEND_API_KEY is optional. Every caller of send_email already treats
# email as a best-effort side effect, not something the operation it's
# confirming depends on (see that function's own comment) — an order
# still gets created and a password still gets reset with no email
# provider configured at all, same as if Resend were just down. Making
# this hard-required would mean the whole API refuses to boot over a
# feature that's explicitly designed to fail without consequence, which
# doesn't make sense: a person spinning this up locally shouldn't need
# a Resend account before they can even sign up.
RESEND_API_KEY = os.environ.get("RESEND_API_KEY")
# Has to be an address on a domain verified with Resend, not just any
# address — resend.dev's own sandbox sender is a reasonable local-dev
# default, but a real deployment sets this to something on the
# platform's own domain (e.g. "orders@lumin.app").
EMAIL_FROM = os.environ.get("EMAIL_FROM", "Lumin <onboarding@resend.dev>")
RESEND_BASE_URL = "https://api.resend.com"


def send_email(to: str, subject: str, html: str) -> None:
    """One HTTP call, same shape as every other outbound integration in
    this app (app/paystack.py's calls to Paystack's API) — a POST with a
    bearer token, nothing Resend-specific leaking into callers beyond
    this one function.

    Silently no-ops (logged, not raised) if RESEND_API_KEY was never
    set — see that constant's own comment for why this has to degrade
    gracefully rather than erroring, let alone crashing on import the
    way it did before. Otherwise raises on a non-2xx response (network
    error or bad request alike); callers that treat email as a
    best-effort side effect (order confirmations in payments.py's
    _fulfill, the reset link in routers/auth.py's forgot_password) catch
    that and log rather than let a flaky provider fail the real thing
    it's about.
    """
    if not RESEND_API_KEY:
        logger.warning("RESEND_API_KEY not set — skipping email (subject: %r)", subject)
        return
    resp = httpx.post(
        f"{RESEND_BASE_URL}/emails",
        headers={"Authorization": f"Bearer {RESEND_API_KEY}"},
        json={"from": EMAIL_FROM, "to": [to], "subject": subject, "html": html},
        timeout=15.0,
    )
    resp.raise_for_status()
