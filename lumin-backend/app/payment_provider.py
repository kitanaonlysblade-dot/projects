"""Which payment gateway is live. PAYMENT_PROVIDER=stripe (default) or paystack (the old integration, kept working).

Kept in its own tiny module (no imports from the app) so models, routers and escrow can all read it without import loops.
"""
import os

PROVIDER = (os.environ.get("PAYMENT_PROVIDER") or "stripe").strip().lower()
if PROVIDER not in ("stripe", "paystack"):
    raise RuntimeError(f'PAYMENT_PROVIDER must be "stripe" or "paystack", got "{PROVIDER}"')


def is_stripe() -> bool:
    return PROVIDER == "stripe"
