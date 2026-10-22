"""The courier behind a shipment, kept behind one small interface so a real one (Terminal Africa, ...) can replace the manual one
without touching anything else.

What a courier has to do:
  * request_pickup(shipment, order): ask for a driver. A real courier is called here and returns its own reference.
  * tell us when the driver accepted (-> shipments.mark_picked_up) and when the delivery code was confirmed
    (-> shipments.confirm_delivery). A real courier does that by calling /courier/... (or its webhook); the manual one is
    driven by an admin in Admin > Shipments.

Choose with COURIER (default "manual"). Adding one = a class here and a line in _COURIERS.
"""
import os
from typing import Protocol


class Courier(Protocol):
    name: str

    def request_pickup(self, shipment, order) -> "str | None":
        """Ask for a driver. -> the courier's own reference for the job, or None."""


class ManualCourier:
    """No outside service: an admin marks the pickup and enters the delivery code (Admin > Shipments)."""

    name = "manual"

    def request_pickup(self, shipment, order) -> "str | None":
        return None


_COURIERS = {"manual": ManualCourier}


def get_courier() -> Courier:
    return _COURIERS.get(os.environ.get("COURIER", "manual").lower(), ManualCourier)()


def courier_key_ok(given: "str | None") -> bool:
    """The shared secret a courier's system sends in X-Courier-Key (COURIER_API_KEY). Off (always False) when unset."""
    import hmac

    key = os.environ.get("COURIER_API_KEY", "")
    return bool(key) and bool(given) and hmac.compare_digest(key, given)
