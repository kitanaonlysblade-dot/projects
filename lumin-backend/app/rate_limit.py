from slowapi import Limiter
from slowapi.util import get_remote_address

# One shared instance, imported both here-and-there: main.py attaches it
# to the app (app.state.limiter) and registers the 429 handler + the
# middleware that actually enforces limits; any router that wants to cap
# a specific route imports this same `limiter` and decorates with
# @limiter.limit("5/minute") — has to be the same instance in both
# places, not a second Limiter() each router builds for itself.
#
# Keyed by IP, in-memory by default. That's fine for a single-process
# deployment (the common case for this app); if this ever runs behind
# multiple worker processes or instances, counts won't be shared across
# them and effective limits get looser than the numbers below suggest —
# swap in a Redis storage_uri here first (Limiter(..., storage_uri=
# "redis://...")) if that's the setup.
limiter = Limiter(key_func=get_remote_address)
