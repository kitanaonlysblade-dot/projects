"""What a buyer's reasons are worth against the seller's live test.

The idea: the live test video shows the product working at the moment it was sealed. If the buyer reports a fault the seller
showed working (and ticked), the claim is covered by the test and there is no money back. If the fault was never shown, the
buyer wins. This module turns that into a recommendation for the person reviewing the dispute; it does not decide anything.
"""
import os
import uuid
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models import LiveTest, Notification, NotificationType, Order, ReturnClaimStatus, SealBag

# What a buyer can pick. The first group are things a live test can show working; the rest need a person to look.
TESTABLE_FAULTS = {
    "screen": "Screen",
    "sound": "Sound",
    "buttons": "Buttons",
    "power": "Power / battery",
    "camera": "Camera",
    "fit": "Fit / size",
}
REVIEW_FAULTS = {
    "damaged": "Damaged",
    "missing_parts": "Missing parts",
    "not_as_described": "Not as described",
    "wrong_item": "Wrong item",
    "other": "Other",
}
FAULTS = {**TESTABLE_FAULTS, **REVIEW_FAULTS}

# The seller's ticks in the live test screen (components/LiveTestScreen.tsx) -> the faults each one covers.
_ALL_FUNCTIONAL = {"screen", "sound", "buttons", "power", "camera"}
CHECK_COVERS = {
    "screen": {"screen"},
    "sound": {"sound"},
    "buttons": {"buttons"},
    "power / battery": {"power"},
    "camera": {"camera"},
    "fit / size": {"fit"},
    "everything works": _ALL_FUNCTIONAL,
}


def clean_reasons(reasons: "list[str] | None") -> "list[str]":
    """Only known codes, once each, in the order given."""
    out: list[str] = []
    for r in reasons or []:
        r = (r or "").strip().lower()
        if r in FAULTS and r not in out:
            out.append(r)
    return out


def covered_faults(checklist: "list[str]") -> "set[str]":
    out: set[str] = set()
    for item in checklist or []:
        out |= CHECK_COVERS.get((item or "").strip().lower(), set())
    return out


def assess(db: Session, order: Order, reasons: "list[str]", seal_intact: "bool | None" = None) -> dict:
    test = (
        db.query(LiveTest).filter(LiveTest.order_id == order.id, LiveTest.status == "sealed").first()
    )
    reasons = clean_reasons(reasons)
    bag = db.get(SealBag, test.bag_id) if test is not None and test.bag_id else None
    showed = list(test.checklist or []) if test is not None else []
    covers = covered_faults(showed)
    covered = [r for r in reasons if r in TESTABLE_FAULTS and r in covers]
    not_covered = [r for r in reasons if r in TESTABLE_FAULTS and r not in covers]
    needs_review = [r for r in reasons if r in REVIEW_FAULTS]

    if test is None:
        suggestion, summary = "refund", "The seller did no live test, so nothing shows the product working when it was sent."
    elif not reasons:
        suggestion, summary = "review", "The buyer gave no reason. Watch both videos."
    elif not_covered:
        suggestion = "refund"
        summary = "The live test did not cover: " + ", ".join(FAULTS[r] for r in not_covered) + "."
    elif needs_review:
        suggestion = "review"
        summary = "Needs a person to compare the videos: " + ", ".join(FAULTS[r] for r in needs_review) + "."
    else:
        suggestion = "deny"
        summary = "The live test showed this working: " + ", ".join(FAULTS[r] for r in covered) + "."
    video = None
    if test is not None and test.video_key:
        try:
            from app import storage

            video = storage.evidence_view_url(test.video_key, test.video_private)
        except Exception:
            video = None
    return dict(
        seller_video_url=video,
        seller_video_s=test.claimed_duration_s if test is not None else None,
        has_test=test is not None,
        serial=bag.serial if bag else None,
        test_id=test.id if test is not None else None,
        seller_showed=showed,
        covered=[FAULTS[r] for r in covered],
        not_covered=[FAULTS[r] for r in not_covered],
        needs_review=[FAULTS[r] for r in needs_review],
        suggestion=suggestion,
        summary=summary,
        seal_intact_at_delivery=seal_intact,
    )


# ------------------------------------------------------------------ deciding clear cases without a person
def auto_refund_enabled() -> bool:
    """AUTO_REFUND_CLEAR_CASES=true: a claim that is clearly the buyer's (a fault the live test never showed, or no live test at
    all) is refunded the moment it is filed, as long as nothing in app/fraud_signals.py warns about it. Off by default."""
    return os.environ.get("AUTO_REFUND_CLEAR_CASES", "false").lower() == "true"


def _notify(db: Session, user_id, body: str) -> None:
    if user_id is not None:
        db.add(Notification(user_id=user_id, body=body, type=NotificationType.moderation))


def auto_decide(db: Session, claim) -> bool:
    """Refund a clear buyer win straight away. Never denies anything (a denial always needs a person). -> True when it refunded.
    The claim must already be saved (this commits, and rolls back only its own refund attempt)."""
    from fastapi import HTTPException

    from app import fraud_signals
    from app.escrow import refund_for_defect

    if not auto_refund_enabled() or claim.status != ReturnClaimStatus.pending_review:
        return False
    order = claim.order
    reasons = clean_reasons(list(claim.reasons or []))
    if not reasons:
        return False
    cov = assess(db, order, reasons)
    if cov["suggestion"] != "refund" or fraud_signals.flags_for_claim(db, order):
        return False
    try:
        refund_for_defect(db, order)
    except HTTPException:
        db.rollback()  # funds already settled or no payment on record: leave it for a person
        return False
    claim.status = ReturnClaimStatus.refunded
    claim.auto_resolved = True
    claim.resolution_note = "Refunded automatically. " + cov["summary"]
    claim.resolved_at = datetime.now(timezone.utc)
    _notify(db, claim.buyer_id, "Your claim was approved and refunded. " + cov["summary"])
    if order.product is not None and order.product.merchant is not None:
        _notify(db, order.product.merchant.user_id, f"A claim on order {str(order.id)[:8]} was refunded automatically. {cov['summary']} You can appeal within {APPEAL_WINDOW_HOURS} hours.")
    db.commit()
    return True


# ------------------------------------------------------------------ appeals
APPEAL_WINDOW_HOURS = int(os.environ.get("APPEAL_WINDOW_HOURS", "48"))


def appeal_side(claim) -> "str | None":
    """Which side may appeal this claim now (the one that lost, once, within the window), or None."""
    if claim.appeal_by is not None or claim.resolved_at is None:
        return None
    if (datetime.now(timezone.utc) - claim.resolved_at).total_seconds() > APPEAL_WINDOW_HOURS * 3600:
        return None
    if claim.status == ReturnClaimStatus.denied:
        return "buyer"
    if claim.status == ReturnClaimStatus.refunded:
        return "seller"
    return None
