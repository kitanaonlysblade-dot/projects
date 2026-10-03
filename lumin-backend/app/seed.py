"""
Seed script — inserts a representative copy of the frontend's
lib/data.ts mock content through the real models, so local dev has
something to look at immediately instead of an empty database.

Not a byte-for-byte mirror: fake string ids like 'apparel-b3-p1' don't
carry over (the real schema generates its own UUIDs) — this script only
keeps that mapping around long enough to wire up relationships
(notification.target_id -> the right Product, comments -> the right
VideoPost), the same way lib/data.ts's own `makeProducts` helper exists
only to keep that file less repetitive to hand-author.

`followers`/`following` counts from the mock's `posterStats` aren't
seeded — those are derived from the `follows` table on a real User (see
that model's comment), and manufacturing hundreds of fake follow rows
just to make a number match isn't worth it for seed data. Bios are
carried over; follower counts aren't.

Run with:
    python -m app.seed
"""

from decimal import Decimal

from app.auth.security import hash_password
from app.database import SessionLocal
from app.models import (
    Category,
    CategoryBanner,
    Comment,
    Deal,
    DeliveryCompany,
    DiscountCode,
    DiscountKind,
    Interest,
    MerchantAccount,
    Notification,
    NotificationType,
    Product,
    ProductImage,
    User,
    UserRole,
    VideoFeed,
    VideoPost,
)

DEMO_PASSWORD = "password123"
DEFAULT_COLORS = ["#2f2f2f", "#c9c2b4", "#7c8c78"]
DEFAULT_SIZES = ["One size"]


def slugify(name: str) -> str:
    return "".join(ch.lower() if ch.isalnum() else "-" for ch in name).strip("-")


def get_or_create_poster(db, display_name: str, bio: str = "") -> User:
    """For real display names ('Chef Amara') — slugifies into a username."""
    username = slugify(display_name)
    user = db.query(User).filter(User.username == username).first()
    if user is not None:
        return user
    user = User(
        email=f"{username}@example.com",
        hashed_password=hash_password(DEMO_PASSWORD),
        username=username,
        display_name=display_name,
        bio=bio,
    )
    db.add(user)
    db.flush()
    return user


def get_or_create_commenter(db, handle: str) -> User:
    """For handles that already look like usernames ('marco_eats') — used
    as-is rather than slugified, and doubles as the display name since
    the mock never gave these commenters a separate one."""
    user = db.query(User).filter(User.username == handle).first()
    if user is not None:
        return user
    user = User(
        email=f"{handle}@example.com",
        hashed_password=hash_password(DEMO_PASSWORD),
        username=handle,
        display_name=handle,
    )
    db.add(user)
    db.flush()
    return user


# ---- Category banners + catalog products (CategoryLanding.tsx) -----------
BANNERS = [
    {"category": "Apparel", "title": "Best of Fashion", "subtitle": "Top-rated styles picked by shoppers this week", "products": [
        {"name": "Oversized Blazer", "price": 58, "cart_count": 2400},
        {"name": "Wide-Leg Trousers", "price": 44, "cart_count": 1800},
        {"name": "Satin Slip Dress", "price": 52, "cart_count": 3100},
        {"name": "Cropped Denim Jacket", "price": 65, "cart_count": 2900},
        {"name": "Knit Midi Skirt", "price": 38, "cart_count": 1500},
        {"name": "Pleated Trench Coat", "price": 89, "cart_count": 970},
    ]},
    {"category": "Apparel", "title": "T-Shirts Under $20", "subtitle": "Everyday tees that won't break the bank", "products": [
        {"name": "Classic Crew Tee", "price": 14, "cart_count": 5200},
        {"name": "Ribbed Tank Top", "price": 12, "cart_count": 4100},
        {"name": "Oversized Graphic Tee", "price": 18, "cart_count": 3600},
        {"name": "Long-Sleeve Henley", "price": 19, "cart_count": 2200},
        {"name": "Striped Boatneck Tee", "price": 16, "cart_count": 1900},
        {"name": "Organic Cotton Tee", "price": 15, "cart_count": 2700},
    ]},
    {"category": "Apparel", "title": "New Season Arrivals", "subtitle": "Fresh drops, just landed", "products": [
        {"name": "Utility Cargo Pants", "price": 48, "cart_count": 1300, "is_new": True, "seed_key": "apparel-b3-p1",
         "description": "Relaxed-fit cargo pants in a durable cotton twill, with six functional pockets and an adjustable drawcord waist. Built for everyday wear, not just the look.",
         "image_urls": ["/images/placeholder.svg"] * 3,
         # A couple of products get a real, tracked stock_quantity so the
         # low-stock / out-of-stock UI has something to actually show in
         # a fresh seed — every other product here stays untracked
         # (unlimited), same as before this column existed.
         "stock_quantity": 3},
        {"name": "Cropped Puffer Vest", "price": 56, "cart_count": 890},
        {"name": "Ribbed Turtleneck", "price": 34, "cart_count": 1600},
        {"name": "Faux Leather Skirt", "price": 42, "cart_count": 740},
        {"name": "Oversized Hoodie", "price": 46, "cart_count": 2100, "is_new": True, "seed_key": "apparel-b3-p5",
         "description": "Heavyweight fleece hoodie with a dropped shoulder and oversized fit. Brushed interior for warmth, ribbed cuffs and hem to hold its shape wash after wash.",
         "image_urls": ["/images/placeholder.svg"] * 2,
         "stock_quantity": 0},
        {"name": "Wrap Cardigan", "price": 39, "cart_count": 1050},
    ]},
    {"category": "Electronics", "title": "Top Tech Picks", "subtitle": "Editor-approved gear this month", "products": [
        {"name": "Wireless Earbuds", "price": 59, "cart_count": 6100, "colors": ["#1c1c1c", "#e8e4da"]},
        {"name": "Smart Watch", "price": 89, "cart_count": 4300, "colors": ["#1c1c1c", "#4a4a4a"]},
        {"name": "Portable Charger 10K", "price": 24, "cart_count": 3800, "colors": ["#1c1c1c"]},
        {"name": "Bluetooth Speaker", "price": 45, "cart_count": 2900, "colors": ["#1c1c1c", "#b3505c"]},
        {"name": "USB-C Hub", "price": 29, "cart_count": 1700, "colors": ["#d8d2c2"]},
        {"name": "Noise-Cancelling Headphones", "price": 99, "cart_count": 3400, "colors": ["#1c1c1c", "#7c8c78"]},
    ]},
    {"category": "Electronics", "title": "Audio Under $50", "subtitle": "Sound upgrades that won't drain your wallet", "products": [
        {"name": "Clip-On Mic", "price": 22, "cart_count": 980, "colors": ["#1c1c1c"]},
        {"name": "Wired Earphones", "price": 12, "cart_count": 2600, "colors": ["#1c1c1c", "#d8d2c2"]},
        {"name": "Mini Speaker", "price": 28, "cart_count": 1400, "colors": ["#b3505c", "#1c1c1c"]},
        {"name": "Wireless Earbuds Lite", "price": 35, "cart_count": 2100, "colors": ["#1c1c1c", "#e8e4da"]},
        {"name": "Desktop Mic Stand", "price": 18, "cart_count": 610, "colors": ["#4a4a4a"]},
        {"name": "Bass Boost Headphones", "price": 42, "cart_count": 1900, "colors": ["#1c1c1c"]},
    ]},
    {"category": "Electronics", "title": "New Arrivals in Electronics", "subtitle": "Just landed, first to shelves", "products": [
        {"name": "Fast Charging Cable", "price": 9, "cart_count": 3300, "colors": ["#1c1c1c", "#d8d2c2"]},
        {"name": "Foldable Phone Stand", "price": 14, "cart_count": 1200, "colors": ["#4a4a4a"]},
        {"name": "Smart Ring", "price": 79, "cart_count": 540, "colors": ["#1c1c1c", "#d8d2c2"], "is_new": True},
        {"name": "Mini Projector", "price": 120, "cart_count": 410, "colors": ["#1c1c1c"], "is_new": True},
        {"name": "LED Desk Lamp", "price": 22, "cart_count": 1600, "colors": ["#e8e4da", "#1c1c1c"]},
        {"name": "Wireless Mouse", "price": 17, "cart_count": 2000, "colors": ["#1c1c1c", "#7c8c78"]},
    ]},
    {"category": "Home & Living", "title": "Cozy Home Essentials", "subtitle": "Everything for a softer space", "products": [
        {"name": "Chunky Knit Throw", "price": 32, "cart_count": 1500},
        {"name": "Ceramic Table Lamp", "price": 44, "cart_count": 860},
        {"name": "Linen Cushion Cover", "price": 16, "cart_count": 2200},
        {"name": "Scented Soy Candle", "price": 18, "cart_count": 3100},
        {"name": "Faux Fur Rug", "price": 54, "cart_count": 720},
        {"name": "Woven Wall Hanging", "price": 28, "cart_count": 640},
    ]},
    {"category": "Home & Living", "title": "Decor Under $30", "subtitle": "Small touches, big difference", "products": [
        {"name": "Terracotta Planter", "price": 12, "cart_count": 1900},
        {"name": "Framed Wall Print", "price": 19, "cart_count": 980},
        {"name": "Rattan Basket", "price": 22, "cart_count": 1100},
        {"name": "Glass Bud Vase", "price": 14, "cart_count": 1400},
        {"name": "Woven Coasters (Set of 4)", "price": 10, "cart_count": 2000},
        {"name": "Mini Succulent Trio", "price": 16, "cart_count": 870},
    ]},
    {"category": "Home & Living", "title": "Trending in Home & Living", "subtitle": "What everyone's redecorating with", "products": [
        {"name": "Bouclé Accent Chair", "price": 145, "cart_count": 320},
        {"name": "Marble Coffee Table", "price": 190, "cart_count": 210},
        {"name": "Linen Duvet Set", "price": 68, "cart_count": 590, "is_new": True},
        {"name": "Rattan Pendant Light", "price": 72, "cart_count": 430, "is_new": True},
        {"name": "Velvet Ottoman", "price": 58, "cart_count": 510},
        {"name": "Sheepskin Throw", "price": 46, "cart_count": 680},
    ]},
    {"category": "Accessories", "title": "Everyday Accessories", "subtitle": "Small pieces you'll reach for daily", "products": [
        {"name": "Leather Card Holder", "price": 22, "cart_count": 1600},
        {"name": "Beaded Bracelet Set", "price": 14, "cart_count": 2400},
        {"name": "Classic Aviators", "price": 28, "cart_count": 1900},
        {"name": "Canvas Tote Bag", "price": 19, "cart_count": 3300},
        {"name": "Silk Hair Scarf", "price": 16, "cart_count": 1200},
        {"name": "Minimalist Watch", "price": 48, "cart_count": 980},
    ]},
    {"category": "Accessories", "title": "Bags Under $40", "subtitle": "Carry it all without overspending", "products": [
        {"name": "Mini Crossbody Bag", "price": 32, "cart_count": 2100},
        {"name": "Quilted Shoulder Bag", "price": 38, "cart_count": 1500},
        {"name": "Woven Straw Tote", "price": 26, "cart_count": 1100},
        {"name": "Nylon Belt Bag", "price": 22, "cart_count": 1800},
        {"name": "Canvas Backpack", "price": 35, "cart_count": 960},
        {"name": "Structured Clutch", "price": 29, "cart_count": 640},
    ]},
    {"category": "Accessories", "title": "Statement Jewelry", "subtitle": "Pieces that do the talking", "products": [
        {"name": "Chunky Hoop Earrings", "price": 18, "cart_count": 2600},
        {"name": "Layered Gold Necklace", "price": 24, "cart_count": 1900},
        {"name": "Pearl Drop Earrings", "price": 21, "cart_count": 1400, "is_new": True},
        {"name": "Cuff Bracelet", "price": 19, "cart_count": 1000, "is_new": True},
        {"name": "Signet Ring", "price": 16, "cart_count": 1700},
        {"name": "Charm Anklet", "price": 13, "cart_count": 890},
    ]},
]

DEALS = [
    ("20% off Apparel", "Today only — while stock lasts", "Apparel"),
    ("Buy 1 Get 1 — Accessories", "Ends in 2 days", "Accessories"),
    ("Free shipping over $50", "Storewide, no code needed", None),
    ("Flash sale — Electronics", "Up to 35% off, 3 hours left", "Electronics"),
]

INTERESTS = [
    ("Entertainment", "🎬"), ("Cooking", "🍳"), ("Travel", "✈️"),
    ("Fashion", "👗"), ("Beauty", "💄"), ("Fitness", "🏋️"),
    ("Tech", "💻"), ("Home & Decor", "🛋️"), ("Music", "🎵"),
    ("Comedy", "😂"), ("Pets", "🐾"), ("DIY & Crafts", "✂️"),
]

# ---- Shop feed video posts (VideoStage in "shop" mode) --------------------
SHOP_POSTS = [
    {"poster": "Poster's name",
     "description": 'Description of content — one to two lines, truncates with a "more" tap.',
     "likes": 2500, "comments": 1100, "shares": 340, "saves": 890,
     "product": {"name": "Product name", "price": 35.0, "cart_count": 4500,
                 "colors": ["#c9c2b4", "#4a4a4a", "#a4bfa1", "#b3505c"], "sizes": ["S", "M", "L", "XL", "XXL"]}},
    {"poster": "Nia Fields",
     "description": "Packed my whole carry-on in under 4 minutes — full breakdown in the comments.",
     "likes": 3100, "comments": 640, "shares": 210, "saves": 1200,
     "product": {"name": "Packing cubes (set of 6)", "price": 28.0, "cart_count": 2100,
                 "colors": ["#2f2f2f", "#7c8c78", "#c9c2b4"], "sizes": ["One size"]}},
    {"poster": "Marcus Lee",
     "description": "The desk setup that finally fixed my back pain — link to everything below.",
     "likes": 5400, "comments": 980, "shares": 460, "saves": 2600,
     "product": {"name": "Adjustable monitor arm", "price": 42.0, "cart_count": 3300,
                 "colors": ["#1c1c1c", "#d8d2c2"], "sizes": ["One size"]}},
    {"poster": "Priya Anand",
     "description": "This scarf is doing so much heavy lifting for a $19 outfit piece.",
     "likes": 1800, "comments": 320, "shares": 95, "saves": 740,
     "product": {"name": "Lightweight scarf", "price": 19.0, "cart_count": 1500,
                 "colors": ["#b3505c", "#4a4a4a", "#c9c2b4", "#7c8c78"], "sizes": ["One size"]}},
]

POSTER_BIOS = {
    "Poster's name": "Just here posting things worth watching.",
    "Nia Fields": "Travel light, pack smart. Carry-on only, always.",
    "Marcus Lee": "Desk setups, home office fixes, and ergonomics tips.",
    "Priya Anand": "Affordable fashion finds that still look expensive.",
    "Chef Amara": "Home cook. Five-minute meals that taste like more effort.",
    "Wanderlust Theo": "Chasing hidden spots before they get crowded.",
    "Kitchen Notes": "Small cooking tricks that make a big difference.",
    "Nadia Travels": "Packing hacks and budget travel, one trip at a time.",
    "Late Night Bites": "Midnight snacks made from whatever is in your fridge.",
    "Studio Cuts": "Comedy sketches, no context needed.",
}

# ---- Discover video posts, keyed by the mock's own id so comments below
# can find the right post to attach to. -------------------------------------
DISCOVER_POSTS = {
    "d1": {"poster": "Chef Amara", "description": "Five-minute garlic butter noodles that taste like a restaurant made them.",
           "likes": 4200, "comments": 212, "shares": 88, "saves": 610, "interests": ["Cooking"]},
    "d2": {"poster": "Wanderlust Theo", "description": "This hidden beach in Lombok is somehow still not crowded. Go before it changes.",
           "likes": 8900, "comments": 310, "shares": 415, "saves": 1200, "interests": ["Travel"]},
    "d3": {"poster": "Kitchen Notes", "description": "The trick to crispy skin every single time — it is all about the pat-dry step.",
           "likes": 1500, "comments": 48, "shares": 22, "saves": 340, "interests": ["Cooking"]},
    "d4": {"poster": "Nadia Travels", "description": "Packed my whole carry-on in under 4 minutes — full breakdown in the comments.",
           "likes": 6100, "comments": 96, "shares": 140, "saves": 780, "interests": ["Travel"]},
    "d5": {"poster": "Late Night Bites", "description": "Midnight ramen upgrade using stuff you already have in the fridge.",
           "likes": 3300, "comments": 1400, "shares": 260, "saves": 990, "interests": ["Cooking"]},
    "d6": {"poster": "Studio Cuts", "description": "This is the funniest thing I've watched all week, no context needed.",
           "likes": 12500, "comments": 2100, "shares": 3400, "saves": 450, "interests": ["Comedy", "Entertainment"]},
}

# (handle, text, likes) — comments_count on the post above doesn't
# reconcile with how many of these there are, same intentional mismatch
# the mock's own comment on discoverComments calls out: a display
# number, not a real tally.
DISCOVER_COMMENTS = {
    "d1": [
        ("marco_eats", "The garlic step at 0:14 changed my life, no notes.", 214),
        ("priya.cooks", "Tried this last night, my kitchen has never smelled better", 89),
        ("jsalvatore", "What pan is that? Need it immediately", 33),
    ],
    "d2": [
        ("backpack_before_bag", "Okay but how did you get that shot at golden hour", 156),
        ("em.wanders", "Adding this to the list, thank you for the honest take", 61),
    ],
    "d3": [
        ("noodle_nadia", "Screenshotting this whole thread for later", 302),
        ("thegreyapron", "Finally someone explains it without skipping steps", 178),
        ("kevin.who.cooks", "Made a mess but it was worth it lol", 42),
    ],
    "d4": [
        ("triplogger", "Saving this for the trip in spring, exactly what I needed", 97),
        ("nadia.fan.acct", "The way you edit these is unmatched honestly", 54),
    ],
    "d5": [
        ("midnight_snacker", "This is going to end my diet and I regret nothing", 410),
        ("ramenrachel", "Where is this?? Need the location asap", 128),
        ("davidc", "Watched this three times already", 19),
    ],
    "d6": [
        ("cantstopwatching", "I wasn't ready for that ending, I'm crying", 890),
        ("reposter_central", "Sending this to everyone I know", 245),
    ],
}

# ---- The signed-in demo user's own posts (ProfileScreen.tsx) --------------
MY_POSTS = [
    {"description": "First cut of the new edit — tell me what you think.", "likes": 340, "comments": 28, "shares": 12, "saves": 40},
    {"description": "Testing a new transition style, curious what people think.", "likes": 890, "comments": 64, "shares": 30, "saves": 120},
    {"description": "Behind the scenes from last week, more coming soon.", "likes": 210, "comments": 15, "shares": 5, "saves": 22},
]


def run() -> None:
    db = SessionLocal()
    try:
        if db.query(Category).first() is not None:
            print("Database already has data — skipping seed (delete the tables first to re-seed).")
            return

        # ---- Interests --------------------------------------------------
        interests = {}
        for label, emoji in INTERESTS:
            interest = Interest(label=label, emoji=emoji)
            db.add(interest)
            interests[label] = interest

        # ---- Delivery company -------------------------------------------------
        # Exactly one, marked active, so compute_shipping_fee (app/shipping.py)
        # has a real company to price checkout against out of the box rather
        # than always falling back to DEFAULT_SHIPPING_FLAT_FEE. The $50
        # threshold is here specifically so the seeded catalog can actually
        # demonstrate free shipping kicking in on a decent-sized order, not
        # just the flat-fee path.
        db.add(
            DeliveryCompany(
                name="Lumin Express",
                shipping_flat_fee=Decimal("4.99"),
                free_shipping_threshold=Decimal("50.00"),
                is_active=True,
            )
        )

        # ---- Discount codes -----------------------------------------------
        # Two, covering the two shapes DiscountCode supports and the two
        # common real-world reasons a code exists — nothing here is a
        # capability the model doesn't already have; this is just enough
        # to make /discounts/preview and a checkout screen demoable out
        # of the box, the same reasoning as seeding one DeliveryCompany
        # row just above. No creation endpoint exists yet (see
        # DiscountCode's own comment) — this is the only way a code gets
        # into the database until item #12 (an admin surface) does.
        db.add_all(
            [
                DiscountCode(
                    code="WELCOME10",
                    kind=DiscountKind.percent,
                    value=Decimal("10"),
                    max_discount_amount=Decimal("15.00"),
                    min_subtotal=None,
                    max_redemptions=None,
                    max_redemptions_per_user=1,
                ),
                DiscountCode(
                    code="SAVE5",
                    kind=DiscountKind.fixed,
                    value=Decimal("5.00"),
                    min_subtotal=Decimal("30.00"),
                    max_redemptions=500,
                    max_redemptions_per_user=None,
                ),
            ]
        )

        # ---- Categories ---------------------------------------------------
        categories = {}
        for name in ["Apparel", "Electronics", "Home & Living", "Accessories"]:
            category = Category(name=name)
            db.add(category)
            categories[name] = category
        db.flush()

        # ---- Deals ----------------------------------------------------------
        for text, sub, category_name in DEALS:
            db.add(Deal(text=text, sub=sub, category=categories.get(category_name) if category_name else None))

        # ---- Category banners + catalog products -----------------------------
        seed_products: dict[str, Product] = {}
        for banner_data in BANNERS:
            banner = CategoryBanner(
                category=categories[banner_data["category"]],
                title=banner_data["title"],
                subtitle=banner_data["subtitle"],
            )
            db.add(banner)
            db.flush()

            for p in banner_data["products"]:
                product = Product(
                    banner=banner,
                    name=p["name"],
                    price=Decimal(str(p["price"])),
                    description=p.get("description"),
                    colors=p.get("colors", DEFAULT_COLORS),
                    sizes=p.get("sizes", DEFAULT_SIZES),
                    is_new=p.get("is_new", False),
                    cart_count=p["cart_count"],
                    stock_quantity=p.get("stock_quantity"),
                    images=[ProductImage(url=url, position=i) for i, url in enumerate(p.get("image_urls", []))],
                )
                db.add(product)
                if "seed_key" in p:
                    seed_products[p["seed_key"]] = product
        db.flush()

        # ---- The signed-in demo user ("you") -----------------------------------
        you = User(
            email="you@example.com",
            hashed_password=hash_password(DEMO_PASSWORD),
            username="you",
            display_name="Your name",
            bio="Add a short bio to tell people what you post about.",
        )
        db.add(you)
        db.flush()

        db.add(Notification(
            user=you,
            body="The product you saved to your wishlist just dropped 20% — grab it before it sells out.",
            read=False, type=NotificationType.product, target_id=seed_products["apparel-b3-p1"].id,
        ))
        db.add(Notification(
            user=you,
            body="An item from your wishlist is back in stock in your size.",
            read=False, type=NotificationType.product, target_id=seed_products["apparel-b3-p5"].id,
        ))
        db.add(Notification(user=you, body="Your last order has shipped and is on its way.", read=True, type=NotificationType.order))

        for entry in MY_POSTS:
            db.add(VideoPost(
                feed=VideoFeed.discover, poster=you, description=entry["description"],
                video_url="/videos/sample.mp4", width=1080, height=1920,
                likes_count=entry["likes"], comments_count=entry["comments"],
                shares_count=entry["shares"], saves_count=entry["saves"],
            ))

        # ---- Shop feed posts -----------------------------------------------
        for entry in SHOP_POSTS:
            poster = get_or_create_poster(db, entry["poster"], bio=POSTER_BIOS.get(entry["poster"], ""))
            p = entry["product"]
            product = Product(name=p["name"], price=Decimal(str(p["price"])), cart_count=p["cart_count"],
                               colors=p["colors"], sizes=p["sizes"])
            db.add(product)
            db.flush()
            db.add(VideoPost(
                feed=VideoFeed.shop, poster=poster, description=entry["description"],
                video_url="/videos/sample.mp4", width=1080, height=1920,
                likes_count=entry["likes"], comments_count=entry["comments"],
                shares_count=entry["shares"], saves_count=entry["saves"], products=[product],
            ))

        # ---- Discover posts + their comments -----------------------------------
        discover_post_rows: dict[str, VideoPost] = {}
        for key, entry in DISCOVER_POSTS.items():
            poster = get_or_create_poster(db, entry["poster"], bio=POSTER_BIOS.get(entry["poster"], ""))
            post = VideoPost(
                feed=VideoFeed.discover, poster=poster, description=entry["description"],
                video_url="/videos/sample.mp4", width=1080, height=1920,
                likes_count=entry["likes"], comments_count=entry["comments"],
                shares_count=entry["shares"], saves_count=entry["saves"],
                interests=[interests[label] for label in entry["interests"]],
            )
            db.add(post)
            discover_post_rows[key] = post
        db.flush()

        for post_key, comments in DISCOVER_COMMENTS.items():
            post = discover_post_rows[post_key]
            for handle, text, likes in comments:
                commenter = get_or_create_commenter(db, handle)
                db.add(Comment(video_post=post, author=commenter, text=text, likes_count=likes))

        # ---- A demo merchant — not from lib/data.ts (merchantAccount starts
        # null there); added so /merchant/* and /orders/selling have
        # something real to return without a manual signup round trip first.
        demo_merchant_user = User(
            email="demo-merchant@example.com", hashed_password=hash_password(DEMO_PASSWORD),
            username="demo-merchant", display_name="Lumin Demo Shop",
        )
        db.add(demo_merchant_user)
        db.flush()

        demo_merchant = MerchantAccount(
            user=demo_merchant_user, business_name="Lumin Demo Shop",
            category="Fashion & Apparel", description="A demo storefront seeded for local development.",
        )
        db.add(demo_merchant)
        db.flush()

        demo_product = Product(merchant=demo_merchant, name="Demo Merchant Tee", price=Decimal("25.00"),
                                colors=DEFAULT_COLORS, sizes=["S", "M", "L"])
        db.add(demo_product)
        db.flush()

        db.add(VideoPost(
            feed=VideoFeed.shop, poster=demo_merchant_user, merchant=demo_merchant,
            description="Our first drop is here — check the tee out.",
            video_url="/videos/sample.mp4", width=1080, height=1920, products=[demo_product],
        ))

        # ---- A demo admin — role=admin can only ever be set by a direct
        # database write (see UserRole's own comment on why there's no
        # API route that does this); seeding one is that write, so the
        # admin frontend has something to log into locally without
        # reaching for psql first.
        db.add(User(
            email="admin@example.com", hashed_password=hash_password(DEMO_PASSWORD),
            username="admin", display_name="Lumin Admin", role=UserRole.admin,
        ))

        db.commit()
        print(f"Seed complete — demo login: you@example.com / {DEMO_PASSWORD} "
              f"(merchant: demo-merchant@example.com / {DEMO_PASSWORD}) "
              f"(admin: admin@example.com / {DEMO_PASSWORD}).")
        print(
            "Note: the demo merchant has no payout bank details — "
            "paystack_recipient_code can only come from a real Paystack API "
            "call (POST /merchant/payout), not something this script can "
            "fake without hitting the network. Add test-mode bank details "
            "through that route before trying to exercise escrow release."
        )
    finally:
        db.close()


if __name__ == "__main__":
    run()
