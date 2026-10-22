"""Which "Sponsored twin" shows under a scan result's products.

A sponsored twin COMPLEMENTS what is in the video; it never competes with it. A t-shirt video gets trousers, shoes or
a jacket that go with it; a hair clipper gets hair cream or beard care (or a top that suits a fresh cut); earbuds get
a charger. It is never the same kind of product as one in the video (no second t-shirt, no second clipper), never the
video's own products or sellers, never out of stock. Among the matching ones the least-shown goes first, so sellers
take turns. The kit also has to feel like ONE outfit, so a product's price must sit in a band around the video's own
prices (BAND_LOW to BAND_HIGH times, e.g. 0.4x to 2.5x): no 900 jacket next to a 20 tee. Price unknown: not filtered.
Then STYLE: the seller tags a product with a style, main colour and audience; products that match the video's look
(same style, neutral or matching colour, same audience) win, clashing ones (a formal piece next to sportswear, menswear
next to womenswear) are left out. The video's own look is read from its product names, descriptions and colours. And
LEARNING: pairs people actually tap, add to cart and buy rank higher (SponsoredPair counters). If no kind can be worked out, or nothing complements it: no ad rather than a distracting one. It is a COMPLETE KIT, not a capped list: one product for every kind that completes
what is in the video (trousers AND shoes AND a jacket AND a bag, not three trousers), as many as there are kinds that
have a sponsor product, and within each kind the choice rotates: the least-shown products go first (ties in random order), so with many sponsor products every one gets its
turn. Always labelled "Sponsored" in the app.

The kind of a product is worked out from its name (then its description) with the keyword table below; COMPLEMENTS says
which kinds go together. Both are plain data: add words or pairings there. English words only for now.
"""
import random
import re
import uuid
from dataclasses import dataclass, field
from datetime import datetime

# kind -> keywords (matched as whole words, plural allowed). The FIRST kind that matches wins, so the specific ones
# (hair cream) sit above the general ones (cream).
KIND_WORDS: list[tuple[str, list[str]]] = [
    ("grooming_tool", ["clipper", "trimmer", "shaver", "razor", "hair dryer", "blow dryer", "straightener", "curling iron", "barber"]),
    ("hair_care", ["hair cream", "hair gel", "hair oil", "hair wax", "hair spray", "hair dye", "pomade", "shampoo", "conditioner", "hair serum", "edge control", "hair food", "hair butter", "hair mask", "hair product", "hair"]),
    ("beard_care", ["beard oil", "beard balm", "beard wash", "beard"]),
    ("fragrance", ["perfume", "cologne", "fragrance", "deodorant", "body spray", "eau de"]),
    ("skincare", ["moisturizer", "moisturiser", "lotion", "body cream", "face cream", "cream", "serum", "sunscreen", "cleanser", "toner", "body butter", "shea", "skincare", "face wash", "lip balm"]),
    ("makeup", ["lipstick", "lip gloss", "foundation", "mascara", "eyeliner", "eyeshadow", "blush", "makeup", "concealer", "nail polish"]),
    ("footwear", ["shoe", "sneaker", "boot", "sandal", "slipper", "loafer", "heel", "trainer", "slide", "flip flop", "flip-flop", "footwear"]),
    ("bag", ["bag", "backpack", "handbag", "purse", "tote", "clutch", "wallet", "satchel"]),
    ("accessory", ["watch", "belt", "hat", "cap", "beanie", "scarf", "sunglasses", "glasses", "necklace", "bracelet", "earring", "ring", "chain", "tie", "bow tie", "gloves", "socks", "jewelry", "jewellery"]),
    ("outerwear", ["jacket", "coat", "blazer", "puffer", "vest", "parka", "windbreaker", "cardigan", "hoodie", "sweater", "jumper", "trench"]),
    ("dress", ["dress", "gown", "jumpsuit", "romper", "abaya", "kaftan", "agbada"]),
    ("bottom", ["trouser", "pants", "pant", "jeans", "denim", "skirt", "shorts", "leggings", "chinos", "joggers", "cargo"]),
    ("top", ["t-shirt", "tshirt", "tee", "shirt", "top", "tank", "blouse", "polo", "henley", "turtleneck", "tunic", "crop", "singlet", "jersey"]),
    ("audio", ["earbud", "earphone", "headphone", "headset", "speaker", "airpod", "soundbar"]),
    ("power", ["charger", "charging", "cable", "power bank", "adapter", "adaptor", "battery"]),
    ("wearable_tech", ["smart watch", "smartwatch", "smart ring", "fitness band", "fitness tracker"]),
    ("phone_acc", ["phone case", "phone stand", "screen protector", "phone holder", "pop socket", "selfie stick", "tripod", "ring light"]),
    ("desk", ["mouse", "keyboard", "hub", "mic", "microphone", "monitor stand", "desk", "lamp", "webcam", "laptop stand", "mouse pad"]),
    ("home_decor", ["vase", "candle", "frame", "wall art", "decor", "rug", "mirror", "plant"]),
    ("home_textile", ["pillow", "cushion", "blanket", "throw", "curtain", "bedsheet", "duvet", "bedding", "towel"]),
    ("kitchen", ["mug", "cup", "plate", "bowl", "kettle", "pan", "pot", "cutlery", "blender", "knife"]),
]

COMPLEMENTS: dict[str, set[str]] = {
    "top": {"bottom", "footwear", "outerwear", "bag", "accessory", "fragrance"},
    "bottom": {"top", "footwear", "outerwear", "bag", "accessory", "fragrance"},
    "dress": {"footwear", "bag", "accessory", "outerwear", "fragrance", "makeup"},
    "outerwear": {"top", "bottom", "footwear", "bag", "accessory"},
    "footwear": {"top", "bottom", "dress", "bag", "accessory", "outerwear"},
    "bag": {"top", "bottom", "dress", "footwear", "accessory", "outerwear"},
    "accessory": {"top", "bottom", "dress", "footwear", "outerwear", "bag", "fragrance"},
    "grooming_tool": {"hair_care", "beard_care", "skincare", "fragrance", "top", "outerwear", "accessory"},
    "hair_care": {"grooming_tool", "skincare", "fragrance", "top", "accessory"},
    "beard_care": {"grooming_tool", "skincare", "fragrance", "top", "accessory"},
    "skincare": {"hair_care", "makeup", "fragrance", "beard_care", "grooming_tool"},
    "makeup": {"skincare", "hair_care", "fragrance", "dress", "accessory", "bag"},
    "fragrance": {"top", "dress", "outerwear", "accessory", "skincare", "grooming_tool"},
    "audio": {"power", "phone_acc", "wearable_tech", "bag"},
    "power": {"audio", "phone_acc", "wearable_tech", "desk"},
    "wearable_tech": {"audio", "power", "accessory", "phone_acc"},
    "phone_acc": {"power", "audio", "wearable_tech"},
    "desk": {"audio", "power", "phone_acc"},
    "home_decor": {"home_textile", "kitchen"},
    "home_textile": {"home_decor", "kitchen"},
    "kitchen": {"home_decor", "home_textile"},
}

_PATTERNS = [(k, re.compile(r"(?<![a-z])(?:" + "|".join(re.escape(w) for w in ws) + r")(?:e?s)?(?![a-z])")) for k, ws in KIND_WORDS]


def kind_of(name: str | None, description: str | None = None, extra: str | None = None) -> str | None:
    """What sort of product this is ("top", "grooming_tool", ...), from its name, else its description, else its
    category/section title (`extra`). None = unknown."""
    for text in (name, description, extra):
        t = (text or "").lower()
        if not t.strip():
            continue
        if re.search(r"smart ?(watch|ring)|fitness (band|tracker)", t):
            return "wearable_tech"
        for kind, pat in _PATTERNS:
            if pat.search(t):
                return kind
    return None


@dataclass
class Candidate:
    id: uuid.UUID
    product_id: uuid.UUID
    merchant_id: uuid.UUID | None
    kind: str | None
    in_stock: bool
    impressions: int
    created_at: datetime
    price: float | None = None
    style: str | None = None
    color: str | None = None
    audience: str | None = None
    learned: float = 0.0
    colors: set = field(default_factory=set)


STYLES = ["casual", "formal", "streetwear", "sport", "party", "traditional"]
AUDIENCES = ["men", "women", "unisex", "kids"]
COLORS = ["black", "white", "grey", "beige", "brown", "navy", "blue", "red", "green", "yellow", "orange", "pink", "purple", "multi"]
NEUTRAL_COLORS = {"black", "white", "grey", "beige", "brown", "navy"}  # go with everything
_STYLE_CLASH = {frozenset(p) for p in [("formal", "sport"), ("formal", "streetwear"), ("traditional", "sport"), ("traditional", "streetwear")]}
_STYLE_FRIENDS = {frozenset(p) for p in [("casual", "streetwear"), ("casual", "sport"), ("formal", "party"), ("party", "traditional"), ("casual", "formal")]}

_STYLE_WORDS = {
    "formal": ["formal", "suit", "blazer", "tuxedo", "office", "oxford", "loafer", "dress shirt", "tailored", "business"],
    "streetwear": ["streetwear", "oversized", "graphic", "hoodie", "cargo", "baggy", "sneaker", "urban", "hype"],
    "sport": ["sport", "gym", "running", "training", "athletic", "workout", "jersey", "track", "yoga"],
    "party": ["party", "evening", "cocktail", "satin", "sequin", "club", "gown"],
    "traditional": ["traditional", "agbada", "kaftan", "abaya", "ankara", "kente", "dashiki", "native"],
    "casual": ["casual", "everyday", "crew", "denim", "jeans", "chino", "polo", "tee"],
}
_AUDIENCE_WORDS = {
    "women": ["women", "womens", "women's", "ladies", "lady", "girl", "dress", "skirt", "blouse", "heel", "bra"],
    "men": ["men", "mens", "men's", "gentlemen", "boys", "beard", "barber", "clipper"],
    "kids": ["kids", "children", "toddler", "baby"],
}


def _words_hit(text: str, words: list[str]) -> bool:
    return any(re.search(r"(?<![a-z])" + re.escape(w) + r"(?![a-z])", text) for w in words)


def infer_style(name: str | None, description: str | None = None) -> str | None:
    t = f"{name or ''} {description or ''}".lower()
    for style in ("formal", "traditional", "sport", "party", "streetwear", "casual"):  # most telling first
        if _words_hit(t, _STYLE_WORDS[style]):
            return style
    return None


def infer_audience(name: str | None, description: str | None = None) -> str | None:
    t = f"{name or ''} {description or ''}".lower()
    for aud in ("kids", "women", "men"):
        if _words_hit(t, _AUDIENCE_WORDS[aud]):
            return aud
    return None


def color_family(hex_or_name: str | None) -> str | None:
    """A colour word or '#rrggbb' as one of COLORS (None when it can't be told)."""
    v = (hex_or_name or "").strip().lower()
    if v in COLORS:
        return v
    m = re.fullmatch(r"#?([0-9a-f]{6})", v)
    if not m:
        return None
    import colorsys

    r, g, b = (int(m.group(1)[i : i + 2], 16) / 255 for i in (0, 2, 4))
    h, sat, val = colorsys.rgb_to_hsv(r, g, b)
    h *= 360
    if val < 0.2:
        return "black"
    if sat < 0.12:
        return "white" if val > 0.85 else "grey"
    if sat < 0.3 and val > 0.7 and 20 <= h < 65:
        return "beige"
    if (h < 40 or h >= 345) and val < 0.55 and sat < 0.9 and 10 <= h < 40:
        return "brown"
    if 200 <= h < 255 and val < 0.45:
        return "navy"
    for limit, name in ((15, "red"), (40, "orange"), (65, "yellow"), (170, "green"), (255, "blue"), (290, "purple"), (345, "pink")):
        if h < limit:
            return name
    return "red"


def category_text(p) -> str:
    """The section/category words a product sits under (e.g. "Tees under $20", "Apparel"), for when its own name is vague."""
    b = getattr(p, "banner", None)
    if b is None:
        return ""
    cat = getattr(b, "category", None)
    return f"{b.title or ''} {getattr(cat, 'name', '') or ''}".strip()


def profile_of(p, stored=None) -> dict:
    """Everything the platform can read off a product by itself: no seller questions. Name, description, section, colours.
    `stored` is the AI-read profile row (app/product_ai.py) when there is one: what it says wins, the keyword rules fill
    whatever it left out (or everything, when there is none)."""
    text = category_text(p)
    out = {
        "kind": kind_of(p.name, p.description, text),
        "style": infer_style(p.name, f"{p.description or ''} {text}"),
        "audience": infer_audience(p.name, f"{p.description or ''} {text}"),
        "colors": {x for x in (color_family(c) for c in (p.colors or [])) if x},
    }
    if stored is not None and getattr(stored, "source", None) == "ai":
        for k in ("kind", "style", "audience"):
            if getattr(stored, k, None):
                out[k] = getattr(stored, k)
        if getattr(stored, "colors", None):
            out["colors"] = set(stored.colors)
    return out


@dataclass
class Look:
    """The look of what is in the video, worked out from its products (any part may be unknown)."""

    styles: set
    audiences: set
    colors: set


def look_of(products: list, stored: dict | None = None) -> "Look":
    profs = [profile_of(p, (stored or {}).get(p.id)) for p in products]
    return Look(
        {x["style"] for x in profs if x["style"]},
        {x["audience"] for x in profs if x["audience"]},
        {c for x in profs for c in x["colors"]},
    )


def match_score(c: "Candidate", look: "Look | None") -> float | None:
    """How well a sponsored product suits the video's look: higher is closer, None = a clash, leave it out."""
    score = c.learned
    if look is None:
        return score
    if c.audience and look.audiences and c.audience != "unisex" and "unisex" not in look.audiences and c.audience not in look.audiences:
        return None  # menswear next to womenswear
    if c.audience and c.audience in look.audiences:
        score += 1.0
    if c.style and look.styles:
        if c.style in look.styles:
            score += 2.0
        elif all(frozenset((c.style, s)) in _STYLE_CLASH for s in look.styles):
            return None
        elif any(frozenset((c.style, s)) in _STYLE_FRIENDS for s in look.styles):
            score += 1.0
    cs = set(c.colors) | ({c.color} if c.color else set())
    if cs:
        if cs & look.colors or cs & NEUTRAL_COLORS:
            score += 1.0
        elif look.colors and not (look.colors <= NEUTRAL_COLORS):
            score -= 1.0  # a loud colour against a different loud colour
    return score


def learned_score(shown: int, clicks: int, carts: int, buys: int) -> float:
    """0 to 3: how well this pair does with shoppers. Smoothed, so a pair shown twice does not look perfect."""
    rate = (clicks + 3 * carts + 6 * buys + 0.5) / (shown + 10)
    return min(3.0, rate * 6)


BAND_LOW = 0.4
BAND_HIGH = 2.5


def in_band(price: float | None, featured_prices: list | None) -> bool:
    """True when the price suits the video's own prices (or either side is unknown, so nothing is hidden for lack of data)."""
    ps = [float(p) for p in (featured_prices or []) if p is not None and float(p) > 0]
    if not ps or price is None:
        return True
    return min(ps) * BAND_LOW <= float(price) <= max(ps) * BAND_HIGH


def wanted_kinds(featured_kinds: set) -> set:
    """Kinds that go with what is in the video, minus the kinds already in it (those would compete)."""
    out: set = set()
    for k in featured_kinds:
        out |= COMPLEMENTS.get(k, set())
    return out - set(featured_kinds)


def _closest(cs: list[Candidate], look: "Look | None") -> list[Candidate]:
    """Drops clashes, keeps the ones within 1 point of the best match (they are equally good, so they take turns)."""
    scored = [(c, match_score(c, look)) for c in cs]
    scored = [(c, sc) for c, sc in scored if sc is not None]
    if not scored:
        return []
    top = max(sc for _, sc in scored)
    return [c for c, sc in scored if sc >= top - 1.0]


def rank(candidates: list[Candidate], featured_kinds: set, exclude_products: set, exclude_merchants: set, featured_prices: list | None = None, look: "Look | None" = None) -> Candidate | None:
    """The one to show, or None. Pure, so it can be tested without a database."""
    wanted = wanted_kinds({k for k in featured_kinds if k})
    if not wanted:
        return None  # nothing known to complement: no ad rather than an unrelated one
    ok = [
        c
        for c in candidates
        if c.in_stock
        and c.merchant_id is not None
        and c.kind in wanted
        and c.product_id not in exclude_products
        and c.merchant_id not in exclude_merchants
        and in_band(c.price, featured_prices)
    ]
    ok = _closest(ok, look)
    if not ok:
        return None
    return min(ok, key=lambda c: (c.impressions, c.created_at))


# The order the kit is shown in: the pieces that complete an outfit first, the small extras after.
_SHOW_ORDER = ["bottom", "footwear", "outerwear", "dress", "top", "bag", "accessory", "hair_care", "beard_care", "grooming_tool",
               "skincare", "makeup", "fragrance", "audio", "power", "wearable_tech", "phone_acc", "desk", "home_decor", "home_textile", "kitchen"]
_KIND_ORDER = {k: i for i, k in enumerate(_SHOW_ORDER)}

PER_KIND = 2      # a choice of two in each kind (the lead and one alternative)
MAX_TILES = 10    # and no more than this many in the strip


def rank_many(
    candidates: list[Candidate],
    featured_kinds: set,
    exclude_products: set,
    exclude_merchants: set,
    limit: int | None = None,
    rng: random.Random | None = None,
    featured_prices: list | None = None,
    look: "Look | None" = None,
    per_kind: int = 1,
    max_total: int | None = None,
) -> list[Candidate]:
    """The kit: a lead product for every complementary kind (no cap unless `limit` is given), plus up to `per_kind` - 1 equally good
    alternatives in the same kind, `max_total` tiles at most, the kinds in a steady order, the product
    chosen within each kind from the closest matches in style/colour/audience (clashes dropped), least-shown first with ties
    shuffled, so the choice rotates. Pure."""
    rng = rng or random
    wanted = wanted_kinds({k for k in featured_kinds if k})
    if not wanted or (limit is not None and limit < 1):
        return []
    ok = [
        c
        for c in candidates
        if c.in_stock
        and c.merchant_id is not None
        and c.kind in wanted
        and c.product_id not in exclude_products
        and c.merchant_id not in exclude_merchants
        and in_band(c.price, featured_prices)
    ]
    groups: dict[str, list[Candidate]] = {}
    for c in ok:
        groups.setdefault(c.kind, []).append(c)
    by_kind: dict[str, list[Candidate]] = {}
    for kind, cs in groups.items():
        best = _closest(cs, look)
        if best:
            by_kind[kind] = sorted(best, key=lambda c: (c.impressions, rng.random()))
    kinds = sorted(by_kind, key=lambda k: _KIND_ORDER.get(k, 99))[:limit]
    # The lead pick of every kind first; then, up to `per_kind` and `max_total`, extra choices in the same kind (equally good
    # fits only: by_kind already holds just the closest matches). Shown grouped by kind, the lead first in each group.
    take = {k: 1 for k in kinds}
    room = (max_total if max_total is not None else 10**6) - len(kinds)
    for round_ in range(1, max(per_kind, 1)):
        for k in kinds:
            if room > 0 and len(by_kind[k]) > take[k] and take[k] <= round_:
                take[k] += 1
                room -= 1
    return [c for k in kinds for c in by_kind[k][: take[k]]]


def _pair_rows(db, twin_ids, anchor_ids):
    from app.models import SponsoredPair

    if not twin_ids or not anchor_ids:
        return []
    return db.query(SponsoredPair).filter(SponsoredPair.sponsored_id.in_(twin_ids), SponsoredPair.anchor_product_id.in_(anchor_ids)).all()


def bump_pairs(db, twin_ids, anchor_ids, field: str) -> None:
    """Counts `field` ('shown' | 'clicks' | 'carts' | 'buys') for every sponsored product x video product pair."""
    from app.models import SponsoredPair

    have = {(r.sponsored_id, r.anchor_product_id): r for r in _pair_rows(db, twin_ids, anchor_ids)}
    for t in twin_ids:
        for a in anchor_ids:
            row = have.get((t, a))
            if row is None:
                row = SponsoredPair(sponsored_id=t, anchor_product_id=a, shown=0, clicks=0, carts=0, buys=0)
                db.add(row)
            setattr(row, field, (getattr(row, field) or 0) + 1)


def pick_for_post(db, post) -> list:
    """The sponsored twins to show for this video's scan result / product sheet (and counts the showing)."""
    source = post.repost_of or post
    return pick_for_products(db, list(source.products))


def pick_for_product(db, product) -> list:
    """The add-ons ("buy this too") for one product's detail screen: the same ranking, anchored on that single product."""
    return pick_for_products(db, [product])


def pick_for_products(db, featured: list) -> list:
    """Shared picker: what goes with these products (a video's, or the one a shopper opened); counts the showing."""
    from sqlalchemy import update
    from sqlalchemy.orm import joinedload

    from app.models import Product, SponsoredTwin

    if not featured:
        return []
    from app import product_ai
    from app.models import ProductProfile

    rows = (
        db.query(SponsoredTwin)
        .join(Product, Product.id == SponsoredTwin.product_id)
        .options(joinedload(SponsoredTwin.product))
        .filter(SponsoredTwin.active.is_(True), Product.merchant_id.is_not(None))
        .all()
    )
    # What each product IS: the AI-read profile when it has one; the ones without get queued once (needs ANTHROPIC_API_KEY).
    every = featured + [r.product for r in rows]
    stored = {r.product_id: r for r in db.query(ProductProfile).filter(ProductProfile.product_id.in_([p.id for p in every])).all()} if every else {}
    if product_ai.enabled():
        product_ai.queue_missing(db, every)  # also re-queues a product edited since it was read
        db.commit()
    wanted = {k for k in (profile_of(p, stored.get(p.id))["kind"] for p in featured) if k}
    if not wanted_kinds(wanted):
        return []
    anchor_ids = [p.id for p in featured]
    pairs: dict = {}
    for r in _pair_rows(db, [r.id for r in rows], anchor_ids):
        pairs.setdefault(r.sponsored_id, []).append(learned_score(r.shown, r.clicks, r.carts, r.buys))
    cands = []
    for r in rows:
        prod = r.product
        seen = pairs.get(r.id)
        pr = profile_of(prod, stored.get(prod.id))  # AI-read when available, else the keyword rules; an old seller tag still wins
        cands.append(
            Candidate(
                r.id, r.product_id, prod.merchant_id, pr["kind"], prod.in_stock, r.impressions,
                r.created_at, float(prod.price), r.style or pr["style"], r.color, r.audience or pr["audience"],
                (sum(seen) / len(seen)) if seen else learned_score(0, 0, 0, 0),
                pr["colors"],
            )
        )
    best = rank_many(
        cands, wanted, set(anchor_ids), {p.merchant_id for p in featured if p.merchant_id},
        featured_prices=[p.price for p in featured], look=look_of(featured, stored), per_kind=PER_KIND, max_total=MAX_TILES,
    )
    if not best:
        return []
    ids = [b.id for b in best]
    db.execute(update(SponsoredTwin).where(SponsoredTwin.id.in_(ids)).values(impressions=SponsoredTwin.impressions + 1))
    bump_pairs(db, ids, anchor_ids, "shown")
    db.commit()
    by_id = {r.id: r for r in rows}
    out = []
    seen_kinds: set = set()
    for b in best:
        row = by_id[b.id]
        row._kind = b.kind  # what sort of thing it is ("bottom", "footwear"), so the card can say "Shoes" on the picture
        row._lead = b.kind not in seen_kinds  # the first of its kind is the lead pick; the rest are alternatives
        seen_kinds.add(b.kind)
        out.append(row)
    return out


# ---- pay per sale ---------------------------------------------------------------------------------------------------
# Sellers pay nothing to be shown: when a shopper buys through a sponsored card, the platform keeps a percent of that
# sale, held back from the seller's payout (app/escrow.py). The percent is SPONSORED_SALE_PERCENT (default 10).

def sale_percent():
    import os
    from decimal import Decimal, InvalidOperation

    try:
        v = Decimal(os.environ.get("SPONSORED_SALE_PERCENT", "10"))
    except InvalidOperation:
        v = Decimal("10")
    return min(Decimal("100"), max(Decimal("0"), v))


def sale_fee(price, percent):
    """The platform's share of one sale, in money, rounded to the cent."""
    from decimal import ROUND_HALF_UP, Decimal

    return (Decimal(str(price)) * Decimal(str(percent)) / Decimal("100")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def resolve_twin(db, sponsored_twin_id, product_id):
    """The sponsored twin id a sale may be credited to, or None. The client names it; it is believed only when that
    twin really is for the product being bought (so nobody can credit, or dodge, a fee by naming another)."""
    if sponsored_twin_id is None or product_id is None:
        return None
    from app.models import SponsoredTwin

    row = db.get(SponsoredTwin, sponsored_twin_id)
    return row.id if row is not None and row.product_id == product_id else None


def apply_to_order(order, sponsored_twin_id) -> None:
    """Marks an order as sold through a sponsored card and snapshots the percent and fee."""
    if sponsored_twin_id is None:
        return
    pct = sale_percent()
    order.sponsored_twin_id = sponsored_twin_id
    order.sponsored_fee_percent = pct
    order.sponsored_fee = sale_fee(order.price, pct)
