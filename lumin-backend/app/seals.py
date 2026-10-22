"""Tamper-proof bag codes and the one-way status each moves through. See app/models/seal.py for the idea.

The rules that matter, all enforced here and not in the screens:
  * a code is long and random (100 bits); only its sha256 is stored;
  * the status only moves forward, and every move is one atomic "UPDATE ... WHERE status = <expected>", so two people
    scanning the same bag at once cannot both succeed;
  * every move is written to seal_events;
  * only the seller the bag was sold to can seal with it, and only for their own order;
  * the live test is timed by the server's clock, the video is hashed by the server, and the video must be at least as
    long as the minimum and no longer than the time the server saw pass.
"""
import hashlib
import io
import logging
import os
import re
import secrets
import uuid
from datetime import datetime, timezone

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import storage
from app.models import LiveTest, Order, OrderStatus, Product, SealBag, SealBatch, SealEvent
from app.models.seal import (
    BAG_DELIVERED,
    BAG_IN_TRANSIT,
    BAG_PREVIEW_USED,
    BAG_UNUSED,
    BAG_VOID,
    TEST_ABANDONED,
    TEST_RECORDING,
    TEST_SEALED,
)

log = logging.getLogger(__name__)

# No 0/O/1/I: a code typed from the label by hand cannot be misread.
ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
CODE_LEN = 20
QR_PREFIX = "LSEAL1:"
MAX_BATCH = 2000

MIN_TEST_SECONDS = float(os.environ.get("SEAL_MIN_TEST_SECONDS", "20"))
MAX_TEST_SECONDS = float(os.environ.get("SEAL_MAX_TEST_SECONDS", "900"))
# The video cannot be longer than the time the server saw between opening the test and sealing it (plus a little slack).
DURATION_SLACK_S = 5.0
# Set SEAL_REQUIRED_TO_SHIP=true to refuse "Mark as shipped" for an order with no sealed live test. Off by default so the
# existing flow keeps working until sellers have bags.
SEAL_REQUIRED_TO_SHIP = os.environ.get("SEAL_REQUIRED_TO_SHIP", "false").lower() == "true"
# Orders priced at or above this must show the product's serial number / IMEI on camera during the live test (0 = never required).
SERIAL_PROOF_OVER = float(os.environ.get("SEAL_SERIAL_PROOF_OVER", "0"))
SERIAL_CHECK = "Serial / IMEI"
ALLOW_UNASSIGNED = os.environ.get("SEAL_ALLOW_UNASSIGNED", "false").lower() == "true"

# status -> statuses it may move to
FORWARD = {
    BAG_UNUSED: {BAG_PREVIEW_USED, BAG_VOID},
    BAG_PREVIEW_USED: {BAG_IN_TRANSIT, BAG_VOID},
    BAG_IN_TRANSIT: {BAG_DELIVERED, BAG_VOID},
    BAG_DELIVERED: set(),
    BAG_VOID: set(),
}


class SealError(Exception):
    """A rule was broken. .code is stable for the app; str(e) is plain language for the person."""

    def __init__(self, code: str, message: str, status: int = 400):
        super().__init__(message)
        self.code = code
        self.status = status


# ------------------------------------------------------------------ codes
def new_code() -> str:
    return "".join(secrets.choice(ALPHABET) for _ in range(CODE_LEN))


def normalize(raw: str) -> str | None:
    """The 20-character code from what a scan or a hand-typed entry gave, or None when it cannot be one."""
    s = (raw or "").strip().upper()
    if s.startswith(QR_PREFIX.upper()):
        s = s[len(QR_PREFIX):]
    s = re.sub(r"[\s\-]", "", s)
    if len(s) != CODE_LEN or any(c not in ALPHABET for c in s):
        return None
    return s


def hash_code(code: str) -> str:
    return hashlib.sha256(code.encode()).hexdigest()


def pretty(code: str) -> str:
    return "-".join(code[i:i + 5] for i in range(0, CODE_LEN, 5))


def qr_text(code: str) -> str:
    return QR_PREFIX + code


# ------------------------------------------------------------------ batches
def generate_batch(db: Session, count: int, label: str | None, admin_id: uuid.UUID | None, seller_id: uuid.UUID | None):
    """Make `count` dormant bags. -> (batch, [(serial, code)]). The codes exist in memory only here: print them now
    (print_sheet), because the database keeps hashes and they cannot be read back."""
    if not 1 <= count <= MAX_BATCH:
        raise SealError("bad_count", f"A batch is between 1 and {MAX_BATCH} bags.")
    batch = SealBatch(label=(label or None) and label.strip()[:120], count=count, created_by_id=admin_id)
    db.add(batch)
    db.flush()
    last = db.query(SealBag.serial).order_by(SealBag.serial.desc()).first()
    n = int(last[0].split("-")[1]) if last and "-" in last[0] else 0
    out = []
    for i in range(1, count + 1):
        code = new_code()
        serial = f"LB-{n + i:07d}"
        db.add(SealBag(batch_id=batch.id, serial=serial, code_hash=hash_code(code), seller_id=seller_id))
        out.append((serial, code))
    db.commit()
    return batch, out


def print_sheet(rows: "list[tuple[str, str]]", title: str | None = None) -> bytes:
    """A print-ready A4 PDF for the bag manufacturer: a grid of labels, each with the QR, the serial and the code in
    words (the backup when a scan fails). Labels are 45 x 40 mm."""
    from reportlab.graphics import renderPDF
    from reportlab.graphics.barcode.qr import QrCodeWidget
    from reportlab.graphics.shapes import Drawing
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.pdfgen import canvas

    W, H = A4
    lw, lh = 45 * mm, 40 * mm
    cols, rows_per = int(W // lw), int((H - 12 * mm) // lh)
    per_page = cols * rows_per
    x0 = (W - cols * lw) / 2
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    for i, (serial, code) in enumerate(rows):
        k = i % per_page
        if k == 0:
            if i:
                c.showPage()
            c.setFont("Helvetica", 7)
            c.drawString(x0, H - 8 * mm, f"Lumin seal labels{' - ' + title if title else ''}  (print at 100% scale, no fit-to-page)")
        col, row = k % cols, k // cols
        x, y = x0 + col * lw, H - 12 * mm - (row + 1) * lh
        c.setStrokeColorRGB(0.8, 0.8, 0.8)
        c.rect(x + 1, y + 1, lw - 2, lh - 2, stroke=1, fill=0)
        qr = QrCodeWidget(qr_text(code), barLevel="Q")
        b = qr.getBounds()
        size = 26 * mm
        d = Drawing(size, size, transform=[size / (b[2] - b[0]), 0, 0, size / (b[3] - b[1]), 0, 0])
        d.add(qr)
        renderPDF.draw(d, c, x + (lw - size) / 2, y + lh - size - 3 * mm)
        c.setFillColorRGB(0, 0, 0)
        c.setFont("Helvetica-Bold", 8)
        c.drawCentredString(x + lw / 2, y + 7.5 * mm, serial)
        c.setFont("Courier-Bold", 6.6)
        c.drawCentredString(x + lw / 2, y + 3.5 * mm, pretty(code))
    c.save()
    return buf.getvalue()


# ------------------------------------------------------------------ the one-way status
def advance(db: Session, bag_id: uuid.UUID, to: str, actor_id: uuid.UUID | None, note: str | None = None, commit: bool = True, **fields) -> None:
    """Move a bag forward. The row is locked while its status is checked and changed, so two people scanning the same
    bag at once cannot both succeed: the second one finds the new status and gets a SealError. Writes the history row."""
    bag = db.query(SealBag).filter(SealBag.id == bag_id).with_for_update().one_or_none()
    if bag is None:
        raise SealError("not_found", "Bag not found.", 404)
    if to not in FORWARD.get(bag.status, set()):
        db.rollback()
        raise SealError("bad_status", f"That bag is {label_of(bag.status)}, so it can't be marked {label_of(to)}.", 409)
    db.add(SealEvent(bag_id=bag.id, from_status=bag.status, to_status=to, actor_id=actor_id, note=(note or None) and note[:300]))
    bag.status = to
    for k, v in fields.items():
        setattr(bag, k, v)
    if to == BAG_VOID:
        bag.void_reason = (note or None) and note[:300]
    if commit:
        db.commit()


STATUS_LABEL = {
    BAG_UNUSED: "unused",
    BAG_PREVIEW_USED: "sealed (preview/used)",
    BAG_IN_TRANSIT: "in transit",
    BAG_DELIVERED: "delivered",
    BAG_VOID: "void",
}


def label_of(s: str | None) -> str:
    return STATUS_LABEL.get(s or "", str(s))


def find_bag(db: Session, raw_code: str) -> SealBag | None:
    code = normalize(raw_code)
    if code is None:
        return None
    return db.query(SealBag).filter(SealBag.code_hash == hash_code(code)).first()


# ------------------------------------------------------------------ the seller's live test
def _order_for_seller(db: Session, order_id: uuid.UUID, user) -> Order:
    merchant = user.merchant_account
    order = db.get(Order, order_id)
    if order is None or merchant is None or order.product_id is None:
        raise SealError("not_found", "Order not found.", 404)
    product = db.get(Product, order.product_id)
    if product is None or product.merchant_id != merchant.id:
        raise SealError("not_found", "Order not found.", 404)
    return order


def serial_required(order: Order) -> bool:
    return SERIAL_PROOF_OVER > 0 and float(order.price) >= SERIAL_PROOF_OVER


def sealed_test_for(db: Session, order_id: uuid.UUID) -> LiveTest | None:
    return db.query(LiveTest).filter(LiveTest.order_id == order_id, LiveTest.status == TEST_SEALED).first()


def start_test(db: Session, order_id: uuid.UUID, user, content_type: str):
    """Open a live test for the seller's own pending order. -> (test, upload_url)."""
    order = _order_for_seller(db, order_id, user)
    from app import seal_packs

    if seal_packs.pack_size_of(db, order) > 0:
        raise SealError("bag_pack", "This order is a pack of bags. Pack and ship the bags listed on it; it needs no live test.", 409)
    if order.status != OrderStatus.pending:
        raise SealError("order_not_pending", "A live test is only for an order that hasn't shipped yet.", 409)
    if sealed_test_for(db, order.id) is not None:
        raise SealError("already_sealed", "This order already has a sealed live test.", 409)
    # Any earlier unfinished attempt is dropped: one open test per order.
    db.query(LiveTest).filter(LiveTest.order_id == order.id, LiveTest.status == TEST_RECORDING).update({LiveTest.status: TEST_ABANDONED})
    try:
        upload_url, key, private = storage.create_evidence_upload(content_type)
    except ValueError as e:
        raise SealError("bad_type", str(e), 415)
    test = LiveTest(
        order_id=order.id,
        seller_id=user.id,
        order_code="".join(secrets.choice("23456789") for _ in range(4)),
        status=TEST_RECORDING,
        video_key=key,
        video_private=private,
        started_at=datetime.now(timezone.utc),
    )
    db.add(test)
    db.commit()
    return test, upload_url


def check_bag(db: Session, user, raw_code: str) -> SealBag:
    """What a seller's scan shows while still recording: is this a bag they may use now? Raises SealError when not."""
    bag = find_bag(db, raw_code)
    if bag is None:
        raise SealError("unknown_code", "That isn't a Lumin seal code. Scan the QR on the bag.", 404)
    _check_usable(bag, user)
    return bag


def _check_usable(bag: SealBag, user) -> None:
    if bag.status != BAG_UNUSED:
        raise SealError("bag_used", f"This bag is already {label_of(bag.status)}. A bag can only be used once.", 409)
    if bag.seller_id != user.id and not (bag.seller_id is None and ALLOW_UNASSIGNED):
        raise SealError("not_your_bag", "This bag wasn't sold to your account.", 403)


def seal_test(
    db: Session,
    test_id: uuid.UUID,
    user,
    raw_code: str,
    claimed_duration_s: float,
    checklist: "list[str]",
    note: str | None,
) -> LiveTest:
    test = db.get(LiveTest, test_id)
    if test is None or test.seller_id != user.id:
        raise SealError("not_found", "Live test not found.", 404)
    if test.status != TEST_RECORDING:
        raise SealError("not_open", "This live test is already finished.", 409)
    now = datetime.now(timezone.utc)
    elapsed = (now - test.started_at).total_seconds()
    if elapsed > MAX_TEST_SECONDS + 600:
        raise SealError("too_old", "This test was open too long. Start a new live test.", 409)
    if claimed_duration_s < MIN_TEST_SECONDS:
        raise SealError("too_short", f"The live test must be at least {MIN_TEST_SECONDS:g} seconds of video.")
    if claimed_duration_s > MAX_TEST_SECONDS:
        raise SealError("too_long", f"The live test can be at most {MAX_TEST_SECONDS / 60:g} minutes.")
    if claimed_duration_s > elapsed + DURATION_SLACK_S:
        # The video is longer than the time that has passed since this test was opened: it was not recorded now.
        raise SealError("not_live", "That video wasn't recorded during this live test.")
    order = db.get(Order, test.order_id)
    if order is None or order.status != OrderStatus.pending:
        raise SealError("order_not_pending", "This order can't be sealed any more.", 409)
    if sealed_test_for(db, test.order_id) is not None:
        raise SealError("already_sealed", "This order already has a sealed live test.", 409)

    if serial_required(order) and SERIAL_CHECK.lower() not in [(c or "").strip().lower() for c in (checklist or [])]:
        raise SealError("serial_needed", "For an order this valuable, show the serial number / IMEI on camera and tick it before sealing.")
    bag = find_bag(db, raw_code)
    if bag is None:
        raise SealError("unknown_code", "That isn't a Lumin seal code. Scan the QR on the bag.", 404)
    _check_usable(bag, user)

    size = storage.evidence_size(test.video_key, test.video_private)
    if not size:
        raise SealError("no_video", "The video didn't finish uploading. Try again.")
    if size > storage.MAX_VIDEO_BYTES:
        raise SealError("video_too_big", "That video is too large.", 413)
    digest = storage.evidence_sha256(test.video_key, test.video_private)

    # The bag moves first (atomic): if someone else sealed it a moment ago this raises and nothing else changes.
    advance(db, bag.id, BAG_PREVIEW_USED, user.id, f"sealed for order {order.id}", commit=False, order_id=order.id, test_id=test.id, sealed_at=now)
    items = []
    for s in checklist or []:
        s = (s or "").strip()[:60]
        if s and s.lower() not in [i.lower() for i in items]:
            items.append(s)
        if len(items) >= 30:
            break
    test.bag_id = bag.id
    test.status = TEST_SEALED
    test.sealed_at = now
    test.claimed_duration_s = claimed_duration_s
    test.video_sha256 = digest
    test.video_bytes = size
    test.checklist = items
    test.note = (note or None) and note.strip()[:300]
    try:
        db.commit()  # the bag, its history row and the test are saved together or not at all
    except IntegrityError:
        db.rollback()
        raise SealError("already_sealed", "This order already has a sealed live test.", 409)
    try:
        from app import shipments

        shipments.create_for_seal(db, order, bag)  # the bag now waits for a driver
    except Exception:
        db.rollback()
        log.exception("could not start the shipment for order %s", order.id)
    return test
