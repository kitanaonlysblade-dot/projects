"""Reads a product with an AI model (name, description, colours, section and the first photo) and saves what it is, in the
same words app/sponsored.py's matcher uses: kind, style, audience, colours. Runs ONCE per product as a background job
(not on every view), so the cost is a single small call per product. The ranking itself stays plain code; this only
makes the "what is this product" step smarter, for products the keyword rules do not recognise.

Needs ANTHROPIC_API_KEY. Without it nothing is queued and the keyword rules are used, exactly as before. The model is
PRODUCT_AI_MODEL (default claude-haiku-4-5-20251001, the cheap fast one). A wrong or out-of-list answer is dropped, so the
matcher only ever sees words it knows.
"""
import json
import logging
import os
import re
import uuid

from app import sponsored

log = logging.getLogger("lumin")

PROFILE_JOB = "profile_product"
API_URL = "https://api.anthropic.com/v1/messages"
DEFAULT_MODEL = "claude-haiku-4-5-20251001"


def enabled() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY"))


def _kinds() -> list[str]:
    return [k for k, _ in sponsored.KIND_WORDS]


def build_prompt(info: dict) -> str:
    return (
        "You label one product from an online shop so it can be matched with other products that go well with it.\n"
        "Product:\n"
        f"- name: {info.get('name') or ''}\n"
        f"- description: {info.get('description') or ''}\n"
        f"- section: {info.get('section') or ''}\n"
        f"- listed colours: {', '.join(info.get('colors') or [])}\n"
        f"- price: {info.get('price')}\n"
        "Answer with ONLY a JSON object, no other text, with these keys:\n"
        f'"kind": one of {json.dumps(_kinds())} or null if none fits,\n'
        f'"style": one of {json.dumps(sponsored.STYLES)} or null,\n'
        f'"audience": one of {json.dumps(sponsored.AUDIENCES)} or null,\n'
        f'"colors": a list of up to 3 of {json.dumps(sponsored.COLORS)} (the main colours you see or are told).\n'
        "Use null when unsure. Do not guess."
    )


def parse_profile(text: str | None) -> dict | None:
    """The model's reply as a clean profile, keeping only words the matcher knows; None if it is not usable JSON."""
    if not text:
        return None
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        return None
    try:
        raw = json.loads(m.group(0))
    except ValueError:
        return None
    if not isinstance(raw, dict):
        return None

    def pick(key, allowed):
        v = raw.get(key)
        return v.strip().lower() if isinstance(v, str) and v.strip().lower() in allowed else None

    colors = raw.get("colors")
    cols = []
    if isinstance(colors, list):
        for c in colors:
            c = c.strip().lower() if isinstance(c, str) else ""
            if c in sponsored.COLORS and c not in cols:
                cols.append(c)
    return {
        "kind": pick("kind", set(_kinds())),
        "style": pick("style", set(sponsored.STYLES)),
        "audience": pick("audience", set(sponsored.AUDIENCES)),
        "colors": cols[:3],
    }


def call_model(info: dict, image_url: str | None = None) -> str | None:
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        return None
    import httpx  # only when a call is made

    content: list[dict] = []
    if image_url and image_url.startswith("http"):
        content.append({"type": "image", "source": {"type": "url", "url": image_url}})
    content.append({"type": "text", "text": build_prompt(info)})
    r = httpx.post(
        API_URL,
        headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
        json={"model": os.environ.get("PRODUCT_AI_MODEL", DEFAULT_MODEL), "max_tokens": 200, "messages": [{"role": "user", "content": content}]},
        timeout=30,
    )
    r.raise_for_status()
    parts = r.json().get("content") or []
    return "".join(p.get("text", "") for p in parts if p.get("type") == "text")


def profile_product(payload: dict, ask=None) -> None:
    """Background job: label one product and save it. Errors propagate so the job is retried."""
    from app.database import SessionLocal
    from app.models import Product, ProductProfile

    if ask is None and not enabled():
        return
    product_id = uuid.UUID(payload["product_id"])
    db = SessionLocal()
    try:
        p = db.get(Product, product_id)
        if p is None:
            return
        info = {
            "name": p.name,
            "description": p.description,
            "section": sponsored.category_text(p),
            "colors": [sponsored.color_family(c) or c for c in (p.colors or [])],
            "price": float(p.price),
        }
        image = sorted(p.images, key=lambda i: i.position)[0].url if p.images else None
        profile = parse_profile((ask or call_model)(info, image))
        if profile is None:
            raise RuntimeError("the model gave no usable profile")
        row = db.get(ProductProfile, product_id)
        if row is None:
            row = ProductProfile(product_id=product_id)
            db.add(row)
        row.kind, row.style, row.audience, row.colors = profile["kind"], profile["style"], profile["audience"], profile["colors"]
        row.source = "ai"
        db.commit()
    finally:
        db.close()


def queue_missing(db, products) -> None:
    """Queues a label job for products that have none yet, or whose product was edited since (once each: a 'pending' row
    stops the same product being queued again while its job runs). Caller commits. No key: does nothing."""
    if not enabled():
        return
    from app import jobs
    from app.models import ProductProfile

    ids = [p.id for p in products]
    have = {r.product_id: r for r in db.query(ProductProfile).filter(ProductProfile.product_id.in_(ids)).all()} if ids else {}
    for p in products:
        row = have.get(p.id)
        edited = row is not None and row.source == "ai" and p.updated_at is not None and row.updated_at is not None and p.updated_at > row.updated_at
        if row is not None and not edited:
            continue
        if row is None:
            db.add(ProductProfile(product_id=p.id, source="pending", colors=[]))
        jobs.enqueue(db, PROFILE_JOB, {"product_id": str(p.id)})
