import type { Category, CategoryBanner, Comment, Deal, Interest, Product, VideoPost } from './types';

// Content topics for the Discover onboarding picker — separate from
// `categories` above, which are shopping categories (Apparel, Electronics),
// not content interests (what kind of videos someone wants to see).
export const interests: Interest[] = [
  { id: 'entertainment', label: 'Entertainment', emoji: '🎬' },
  { id: 'cooking', label: 'Cooking', emoji: '🍳' },
  { id: 'travel', label: 'Travel', emoji: '✈️' },
  { id: 'fashion', label: 'Fashion', emoji: '👗' },
  { id: 'beauty', label: 'Beauty', emoji: '💄' },
  { id: 'fitness', label: 'Fitness', emoji: '🏋️' },
  { id: 'tech', label: 'Tech', emoji: '💻' },
  { id: 'home', label: 'Home & Decor', emoji: '🛋️' },
  { id: 'music', label: 'Music', emoji: '🎵' },
  { id: 'comedy', label: 'Comedy', emoji: '😂' },
  { id: 'pets', label: 'Pets', emoji: '🐾' },
  { id: 'diy', label: 'DIY & Crafts', emoji: '✂️' },
];

export const categories: Category[] = [
  { id: 'apparel', name: 'Apparel' },
  { id: 'electronics', name: 'Electronics' },
  { id: 'home-living', name: 'Home & Living' },
  { id: 'accessories', name: 'Accessories' },
];

export const deals: Deal[] = [
  { text: '20% off Apparel', sub: 'Today only — while stock lasts', categoryId: 'apparel' },
  { text: 'Buy 1 Get 1 — Accessories', sub: 'Ends in 2 days', categoryId: 'accessories' },
  { text: 'Free shipping over $50', sub: 'Storewide, no code needed' },
  { text: 'Flash sale — Electronics', sub: 'Up to 35% off, 3 hours left', categoryId: 'electronics' },
];

// Shorthand for the catalog-only products below — these back the category
// landing pages, not the video posts, so they don't need per-post fields.
// colors/sizes fall back to a generic default since most catalog tiles
// never surface a picker the way the video player's ProductCard does.
function makeProducts(
  entries: Array<{
    id: string;
    name: string;
    price: number;
    cartCount: number;
    colors?: string[];
    sizes?: string[];
    isNew?: boolean;
    description?: string;
    images?: string[];
  }>,
): Product[] {
  return entries.map(({ colors, sizes, ...rest }) => ({
    ...rest,
    colors: colors ?? ['#2f2f2f', '#c9c2b4', '#7c8c78'],
    sizes: sizes ?? ['One size'],
    inStock: true,
  }));
}

// Category landing pages — tapping a category (sidebar on desktop, sheet
// on mobile/tablet) opens one of these instead of jumping straight to a
// product grid. Each category gets a few promotional banners, and each
// banner carries the product pool its carousel/catalog draws from —
// mirrors how an Amazon category page leads with curated banners before
// the full listing.
export const categoryBanners: CategoryBanner[] = [
  {
    id: 'apparel-best-of-fashion',
    categoryId: 'apparel',
    title: 'Best of Fashion',
    subtitle: 'Top-rated styles picked by shoppers this week',
    products: makeProducts([
      { id: 'apparel-b1-p1', name: 'Oversized Blazer', price: 58, cartCount: 2400 },
      { id: 'apparel-b1-p2', name: 'Wide-Leg Trousers', price: 44, cartCount: 1800 },
      { id: 'apparel-b1-p3', name: 'Satin Slip Dress', price: 52, cartCount: 3100 },
      { id: 'apparel-b1-p4', name: 'Cropped Denim Jacket', price: 65, cartCount: 2900 },
      { id: 'apparel-b1-p5', name: 'Knit Midi Skirt', price: 38, cartCount: 1500 },
      { id: 'apparel-b1-p6', name: 'Pleated Trench Coat', price: 89, cartCount: 970 },
    ]),
  },
  {
    id: 'apparel-tshirts-under-20',
    categoryId: 'apparel',
    title: 'T-Shirts Under $20',
    subtitle: "Everyday tees that won't break the bank",
    products: makeProducts([
      { id: 'apparel-b2-p1', name: 'Classic Crew Tee', price: 14, cartCount: 5200 },
      { id: 'apparel-b2-p2', name: 'Ribbed Tank Top', price: 12, cartCount: 4100 },
      { id: 'apparel-b2-p3', name: 'Oversized Graphic Tee', price: 18, cartCount: 3600 },
      { id: 'apparel-b2-p4', name: 'Long-Sleeve Henley', price: 19, cartCount: 2200 },
      { id: 'apparel-b2-p5', name: 'Striped Boatneck Tee', price: 16, cartCount: 1900 },
      { id: 'apparel-b2-p6', name: 'Organic Cotton Tee', price: 15, cartCount: 2700 },
    ]),
  },
  {
    id: 'apparel-new-season',
    categoryId: 'apparel',
    title: 'New Season Arrivals',
    subtitle: 'Fresh drops, just landed',
    products: makeProducts([
      { id: 'apparel-b3-p1', name: 'Utility Cargo Pants', price: 48, cartCount: 1300, isNew: true, description: 'Relaxed-fit cargo pants in a durable cotton twill, with six functional pockets and an adjustable drawcord waist. Built for everyday wear, not just the look.', images: ['/images/placeholder.svg', '/images/placeholder.svg', '/images/placeholder.svg'] },
      { id: 'apparel-b3-p2', name: 'Cropped Puffer Vest', price: 56, cartCount: 890 },
      { id: 'apparel-b3-p3', name: 'Ribbed Turtleneck', price: 34, cartCount: 1600 },
      { id: 'apparel-b3-p4', name: 'Faux Leather Skirt', price: 42, cartCount: 740 },
      { id: 'apparel-b3-p5', name: 'Oversized Hoodie', price: 46, cartCount: 2100, isNew: true, description: 'Heavyweight fleece hoodie with a dropped shoulder and oversized fit. Brushed interior for warmth, ribbed cuffs and hem to hold its shape wash after wash.', images: ['/images/placeholder.svg', '/images/placeholder.svg'] },
      { id: 'apparel-b3-p6', name: 'Wrap Cardigan', price: 39, cartCount: 1050 },
    ]),
  },
  {
    id: 'electronics-top-tech',
    categoryId: 'electronics',
    title: 'Top Tech Picks',
    subtitle: 'Editor-approved gear this month',
    products: makeProducts([
      { id: 'electronics-b1-p1', name: 'Wireless Earbuds', price: 59, cartCount: 6100, colors: ['#1c1c1c', '#e8e4da'] },
      { id: 'electronics-b1-p2', name: 'Smart Watch', price: 89, cartCount: 4300, colors: ['#1c1c1c', '#4a4a4a'] },
      { id: 'electronics-b1-p3', name: 'Portable Charger 10K', price: 24, cartCount: 3800, colors: ['#1c1c1c'] },
      { id: 'electronics-b1-p4', name: 'Bluetooth Speaker', price: 45, cartCount: 2900, colors: ['#1c1c1c', '#b3505c'] },
      { id: 'electronics-b1-p5', name: 'USB-C Hub', price: 29, cartCount: 1700, colors: ['#d8d2c2'] },
      { id: 'electronics-b1-p6', name: 'Noise-Cancelling Headphones', price: 99, cartCount: 3400, colors: ['#1c1c1c', '#7c8c78'] },
    ]),
  },
  {
    id: 'electronics-audio-under-50',
    categoryId: 'electronics',
    title: 'Audio Under $50',
    subtitle: "Sound upgrades that won't drain your wallet",
    products: makeProducts([
      { id: 'electronics-b2-p1', name: 'Clip-On Mic', price: 22, cartCount: 980, colors: ['#1c1c1c'] },
      { id: 'electronics-b2-p2', name: 'Wired Earphones', price: 12, cartCount: 2600, colors: ['#1c1c1c', '#d8d2c2'] },
      { id: 'electronics-b2-p3', name: 'Mini Speaker', price: 28, cartCount: 1400, colors: ['#b3505c', '#1c1c1c'] },
      { id: 'electronics-b2-p4', name: 'Wireless Earbuds Lite', price: 35, cartCount: 2100, colors: ['#1c1c1c', '#e8e4da'] },
      { id: 'electronics-b2-p5', name: 'Desktop Mic Stand', price: 18, cartCount: 610, colors: ['#4a4a4a'] },
      { id: 'electronics-b2-p6', name: 'Bass Boost Headphones', price: 42, cartCount: 1900, colors: ['#1c1c1c'] },
    ]),
  },
  {
    id: 'electronics-new-arrivals',
    categoryId: 'electronics',
    title: 'New Arrivals in Electronics',
    subtitle: 'Just landed, first to shelves',
    products: makeProducts([
      { id: 'electronics-b3-p1', name: 'Fast Charging Cable', price: 9, cartCount: 3300, colors: ['#1c1c1c', '#d8d2c2'] },
      { id: 'electronics-b3-p2', name: 'Foldable Phone Stand', price: 14, cartCount: 1200, colors: ['#4a4a4a'] },
      { id: 'electronics-b3-p3', name: 'Smart Ring', price: 79, cartCount: 540, colors: ['#1c1c1c', '#d8d2c2'], isNew: true },
      { id: 'electronics-b3-p4', name: 'Mini Projector', price: 120, cartCount: 410, colors: ['#1c1c1c'], isNew: true },
      { id: 'electronics-b3-p5', name: 'LED Desk Lamp', price: 22, cartCount: 1600, colors: ['#e8e4da', '#1c1c1c'] },
      { id: 'electronics-b3-p6', name: 'Wireless Mouse', price: 17, cartCount: 2000, colors: ['#1c1c1c', '#7c8c78'] },
    ]),
  },
  {
    id: 'home-cozy-essentials',
    categoryId: 'home-living',
    title: 'Cozy Home Essentials',
    subtitle: 'Everything for a softer space',
    products: makeProducts([
      { id: 'home-b1-p1', name: 'Chunky Knit Throw', price: 32, cartCount: 1500 },
      { id: 'home-b1-p2', name: 'Ceramic Table Lamp', price: 44, cartCount: 860 },
      { id: 'home-b1-p3', name: 'Linen Cushion Cover', price: 16, cartCount: 2200 },
      { id: 'home-b1-p4', name: 'Scented Soy Candle', price: 18, cartCount: 3100 },
      { id: 'home-b1-p5', name: 'Faux Fur Rug', price: 54, cartCount: 720 },
      { id: 'home-b1-p6', name: 'Woven Wall Hanging', price: 28, cartCount: 640 },
    ]),
  },
  {
    id: 'home-decor-under-30',
    categoryId: 'home-living',
    title: 'Decor Under $30',
    subtitle: 'Small touches, big difference',
    products: makeProducts([
      { id: 'home-b2-p1', name: 'Terracotta Planter', price: 12, cartCount: 1900 },
      { id: 'home-b2-p2', name: 'Framed Wall Print', price: 19, cartCount: 980 },
      { id: 'home-b2-p3', name: 'Rattan Basket', price: 22, cartCount: 1100 },
      { id: 'home-b2-p4', name: 'Glass Bud Vase', price: 14, cartCount: 1400 },
      { id: 'home-b2-p5', name: 'Woven Coasters (Set of 4)', price: 10, cartCount: 2000 },
      { id: 'home-b2-p6', name: 'Mini Succulent Trio', price: 16, cartCount: 870 },
    ]),
  },
  {
    id: 'home-trending',
    categoryId: 'home-living',
    title: 'Trending in Home & Living',
    subtitle: "What everyone's redecorating with",
    products: makeProducts([
      { id: 'home-b3-p1', name: 'Bouclé Accent Chair', price: 145, cartCount: 320 },
      { id: 'home-b3-p2', name: 'Marble Coffee Table', price: 190, cartCount: 210 },
      { id: 'home-b3-p3', name: 'Linen Duvet Set', price: 68, cartCount: 590, isNew: true },
      { id: 'home-b3-p4', name: 'Rattan Pendant Light', price: 72, cartCount: 430, isNew: true },
      { id: 'home-b3-p5', name: 'Velvet Ottoman', price: 58, cartCount: 510 },
      { id: 'home-b3-p6', name: 'Sheepskin Throw', price: 46, cartCount: 680 },
    ]),
  },
  {
    id: 'accessories-everyday',
    categoryId: 'accessories',
    title: 'Everyday Accessories',
    subtitle: "Small pieces you'll reach for daily",
    products: makeProducts([
      { id: 'accessories-b1-p1', name: 'Leather Card Holder', price: 22, cartCount: 1600 },
      { id: 'accessories-b1-p2', name: 'Beaded Bracelet Set', price: 14, cartCount: 2400 },
      { id: 'accessories-b1-p3', name: 'Classic Aviators', price: 28, cartCount: 1900 },
      { id: 'accessories-b1-p4', name: 'Canvas Tote Bag', price: 19, cartCount: 3300 },
      { id: 'accessories-b1-p5', name: 'Silk Hair Scarf', price: 16, cartCount: 1200 },
      { id: 'accessories-b1-p6', name: 'Minimalist Watch', price: 48, cartCount: 980 },
    ]),
  },
  {
    id: 'accessories-bags-under-40',
    categoryId: 'accessories',
    title: 'Bags Under $40',
    subtitle: 'Carry it all without overspending',
    products: makeProducts([
      { id: 'accessories-b2-p1', name: 'Mini Crossbody Bag', price: 32, cartCount: 2100 },
      { id: 'accessories-b2-p2', name: 'Quilted Shoulder Bag', price: 38, cartCount: 1500 },
      { id: 'accessories-b2-p3', name: 'Woven Straw Tote', price: 26, cartCount: 1100 },
      { id: 'accessories-b2-p4', name: 'Nylon Belt Bag', price: 22, cartCount: 1800 },
      { id: 'accessories-b2-p5', name: 'Canvas Backpack', price: 35, cartCount: 960 },
      { id: 'accessories-b2-p6', name: 'Structured Clutch', price: 29, cartCount: 640 },
    ]),
  },
  {
    id: 'accessories-statement-jewelry',
    categoryId: 'accessories',
    title: 'Statement Jewelry',
    subtitle: 'Pieces that do the talking',
    products: makeProducts([
      { id: 'accessories-b3-p1', name: 'Chunky Hoop Earrings', price: 18, cartCount: 2600 },
      { id: 'accessories-b3-p2', name: 'Layered Gold Necklace', price: 24, cartCount: 1900 },
      { id: 'accessories-b3-p3', name: 'Pearl Drop Earrings', price: 21, cartCount: 1400, isNew: true },
      { id: 'accessories-b3-p4', name: 'Cuff Bracelet', price: 19, cartCount: 1000, isNew: true },
      { id: 'accessories-b3-p5', name: 'Signet Ring', price: 16, cartCount: 1700 },
      { id: 'accessories-b3-p6', name: 'Charm Anklet', price: 13, cartCount: 890 },
    ]),
  },
];

// Shop feed — several posts instead of one, so shop mode has something to
// swipe through the same way discover does. Each carries its own
// `products`, since ProductDrawer now shows whichever post is playing
// rather than always the same hardcoded one.
export const shopPosts: VideoPost[] = [
  {
    id: 'v1',
    posterName: "Poster's name",
    postedAt: 'Date',
    description: 'Description of content — one to two lines, truncates with a "more" tap.',
    // Drop your own video file into public/videos/ and match the filename here.
    // Update width/height to match your file's real resolution — this is
    // what makes the frame size correctly with zero loading delay.
    videoUrl: '/videos/sample.mp4',
    width: 1080,
    height: 1920,
    likes: 2500,
    comments: 1100,
    shares: 340,
    saves: 890,
    products: [
      {
        id: 'p1',
        name: 'Product name',
        price: 35.0,
        cartCount: 4500,
        colors: ['#c9c2b4', '#4a4a4a', '#a4bfa1', '#b3505c'],
        sizes: ['S', 'M', 'L', 'XL', 'XXL'],
        inStock: true,
      },
    ],
  },
  {
    id: 'v2',
    posterName: 'Nia Fields',
    postedAt: '3h ago',
    description: 'Packed my whole carry-on in under 4 minutes — full breakdown in the comments.',
    videoUrl: '/videos/sample.mp4',
    width: 1080,
    height: 1920,
    likes: 3100,
    comments: 640,
    shares: 210,
    saves: 1200,
    products: [
      {
        id: 'p2',
        name: 'Packing cubes (set of 6)',
        price: 28.0,
        cartCount: 2100,
        colors: ['#2f2f2f', '#7c8c78', '#c9c2b4'],
        sizes: ['One size'],
        inStock: true,
      },
    ],
  },
  {
    id: 'v3',
    posterName: 'Marcus Lee',
    postedAt: '1d ago',
    description: 'The desk setup that finally fixed my back pain — link to everything below.',
    videoUrl: '/videos/sample.mp4',
    width: 1080,
    height: 1920,
    likes: 5400,
    comments: 980,
    shares: 460,
    saves: 2600,
    products: [
      {
        id: 'p3',
        name: 'Adjustable monitor arm',
        price: 42.0,
        cartCount: 3300,
        colors: ['#1c1c1c', '#d8d2c2'],
        sizes: ['One size'],
        inStock: true,
      },
    ],
  },
  {
    id: 'v4',
    posterName: 'Priya Anand',
    postedAt: '6h ago',
    description: 'This scarf is doing so much heavy lifting for a $19 outfit piece.',
    videoUrl: '/videos/sample.mp4',
    width: 1080,
    height: 1920,
    likes: 1800,
    comments: 320,
    shares: 95,
    saves: 740,
    products: [
      {
        id: 'p4',
        name: 'Lightweight scarf',
        price: 19.0,
        cartCount: 1500,
        colors: ['#b3505c', '#4a4a4a', '#c9c2b4', '#7c8c78'],
        sizes: ['One size'],
        inStock: true,
      },
    ],
  },
];

// Discover content — no `products` field at all, so VideoStage in
// "discover" mode has nothing shopping-related to even try to render.
// All six currently point at the same test file (there's only one real
// video asset in this project) — swap in real per-post files and their
// real width/height later; the player itself already handles that fine.
export const discoverPosts: VideoPost[] = [
  {
    id: 'd1',
    posterName: 'Chef Amara',
    postedAt: '2d ago',
    description: 'Five-minute garlic butter noodles that taste like a restaurant made them.',
    videoUrl: '/videos/sample.mp4',
    width: 1080,
    height: 1920,
    likes: 4200,
    comments: 212,
    shares: 88,
    saves: 610,
    interestIds: ['cooking'],
  },
  {
    id: 'd2',
    posterName: 'Wanderlust Theo',
    postedAt: '5h ago',
    description: 'This hidden beach in Lombok is somehow still not crowded. Go before it changes.',
    videoUrl: '/videos/sample.mp4',
    width: 1080,
    height: 1920,
    likes: 8900,
    comments: 310,
    shares: 415,
    saves: 1200,
    interestIds: ['travel'],
  },
  {
    id: 'd3',
    posterName: 'Kitchen Notes',
    postedAt: '1d ago',
    description: 'The trick to crispy skin every single time — it is all about the pat-dry step.',
    videoUrl: '/videos/sample.mp4',
    width: 1080,
    height: 1920,
    likes: 1500,
    comments: 48,
    shares: 22,
    saves: 340,
    interestIds: ['cooking'],
  },
  {
    id: 'd4',
    posterName: 'Nadia Travels',
    postedAt: '3d ago',
    description: 'Packed my whole carry-on in under 4 minutes — full breakdown in the comments.',
    videoUrl: '/videos/sample.mp4',
    width: 1080,
    height: 1920,
    likes: 6100,
    comments: 96,
    shares: 140,
    saves: 780,
    interestIds: ['travel'],
  },
  {
    id: 'd5',
    posterName: 'Late Night Bites',
    postedAt: '12h ago',
    description: 'Midnight ramen upgrade using stuff you already have in the fridge.',
    videoUrl: '/videos/sample.mp4',
    width: 1080,
    height: 1920,
    likes: 3300,
    comments: 1400,
    shares: 260,
    saves: 990,
    interestIds: ['cooking'],
  },
  {
    id: 'd6',
    posterName: 'Studio Cuts',
    postedAt: '6h ago',
    description: "This is the funniest thing I've watched all week, no context needed.",
    videoUrl: '/videos/sample.mp4',
    width: 1080,
    height: 1920,
    likes: 12500,
    comments: 2100,
    shares: 3400,
    saves: 450,
    interestIds: ['comedy', 'entertainment'],
  },
];

// Profile info for posters reached via PosterProfileScreen (tapping a
// name/avatar in either feed) — these people aren't real accounts in
// this prototype, just names attached to posts, so there's nowhere else
// this data could live. Keyed by posterName, same lookup key
// PosterProfileScreen already uses to gather someone's posts across both
// pools. Missing entries fall back to 0/0/no-bio in the component rather
// than throwing, same "honest mock data" convention as everything else
// here.
export const posterStats: Record<string, { followers: number; following: number; bio: string }> = {
  "Poster's name": { followers: 18400, following: 212, bio: 'Just here posting things worth watching.' },
  'Nia Fields': { followers: 52300, following: 340, bio: 'Travel light, pack smart. Carry-on only, always.' },
  'Marcus Lee': { followers: 9800, following: 156, bio: 'Desk setups, home office fixes, and ergonomics tips.' },
  'Priya Anand': { followers: 27100, following: 488, bio: 'Affordable fashion finds that still look expensive.' },
  'Chef Amara': { followers: 64200, following: 95, bio: 'Home cook. Five-minute meals that taste like more effort.' },
  'Wanderlust Theo': { followers: 112000, following: 610, bio: 'Chasing hidden spots before they get crowded.' },
  'Kitchen Notes': { followers: 8300, following: 42, bio: 'Small cooking tricks that make a big difference.' },
  'Nadia Travels': { followers: 33900, following: 275, bio: 'Packing hacks and budget travel, one trip at a time.' },
  'Late Night Bites': { followers: 21500, following: 130, bio: 'Midnight snacks made from whatever is in your fridge.' },
  'Studio Cuts': { followers: 198000, following: 18, bio: 'Comedy sketches, no context needed.' },
};

// A handful of sample comments per discover post — enough to make the
// comments panel feel real rather than empty. Not meant to reconcile with
// each post's `comments` count above, same as every other mock-data count
// in this file (cartCount, likes, etc.) doesn't reconcile with anything
// either — it's a display number, not a real tally.
export const discoverComments: Record<string, Comment[]> = {
  d1: [
    { id: 'd1-c1', author: 'marco_eats', text: 'The garlic step at 0:14 changed my life, no notes.', likes: 214 },
    { id: 'd1-c2', author: 'priya.cooks', text: 'Tried this last night, my kitchen has never smelled better', likes: 89 },
    { id: 'd1-c3', author: 'jsalvatore', text: 'What pan is that? Need it immediately', likes: 33 },
  ],
  d2: [
    { id: 'd2-c1', author: 'backpack_before_bag', text: 'Okay but how did you get that shot at golden hour', likes: 156 },
    { id: 'd2-c2', author: 'em.wanders', text: 'Adding this to the list, thank you for the honest take', likes: 61 },
  ],
  d3: [
    { id: 'd3-c1', author: 'noodle_nadia', text: 'Screenshotting this whole thread for later', likes: 302 },
    { id: 'd3-c2', author: 'thegreyapron', text: 'Finally someone explains it without skipping steps', likes: 178 },
    { id: 'd3-c3', author: 'kevin.who.cooks', text: 'Made a mess but it was worth it lol', likes: 42 },
  ],
  d4: [
    { id: 'd4-c1', author: 'triplogger', text: 'Saving this for the trip in spring, exactly what I needed', likes: 97 },
    { id: 'd4-c2', author: 'nadia.fan.acct', text: 'The way you edit these is unmatched honestly', likes: 54 },
  ],
  d5: [
    { id: 'd5-c1', author: 'midnight_snacker', text: 'This is going to end my diet and I regret nothing', likes: 410 },
    { id: 'd5-c2', author: 'ramenrachel', text: 'Where is this?? Need the location asap', likes: 128 },
    { id: 'd5-c3', author: 'davidc', text: 'Watched this three times already', likes: 19 },
  ],
  d6: [
    { id: 'd6-c1', author: 'cantstopwatching', text: "I wasn't ready for that ending, I'm crying", likes: 890 },
    { id: 'd6-c2', author: 'reposter_central', text: 'Sending this to everyone I know', likes: 245 },
  ],
};

// Options for the "create a Page" category picker — plain business
// categories, unrelated to the shop's own product `categories` above.
export const merchantCategories: string[] = [
  'Fashion & Apparel',
  'Beauty & Personal Care',
  'Home & Living',
  'Electronics',
  'Food & Beverage',
  'Handmade & Crafts',
  'Other',
];

// `sampleBuyerNames` and `currentUser` used to live here. Both are gone
// now that they'd actively lie: orders carry a buyer_name the backend
// snapshotted from the real purchasing account (see _snapshot_order), and
// the signed-in person comes from GET /auth/me rather than one fixed
// mock. Nothing referenced either after the cart/orders migration.

// What shows in the personal profile's post grid — same VideoPost shape
// Discover posts use (no `products`, since a plain profile can't sell
// anything), just authored by the current user instead of a mock creator.
export const myPosts: VideoPost[] = [
  {
    id: 'm1',
    posterName: 'Your name',
    postedAt: '2d ago',
    description: 'First cut of the new edit — tell me what you think.',
    videoUrl: '/videos/sample.mp4',
    width: 1080,
    height: 1920,
    likes: 340,
    comments: 28,
    shares: 12,
    saves: 40,
  },
  {
    id: 'm2',
    posterName: 'Your name',
    postedAt: '1w ago',
    description: 'Testing a new transition style, curious what people think.',
    videoUrl: '/videos/sample.mp4',
    width: 1080,
    height: 1920,
    likes: 890,
    comments: 64,
    shares: 30,
    saves: 120,
  },
  {
    id: 'm3',
    posterName: 'Your name',
    postedAt: '3w ago',
    description: 'Behind the scenes from last week, more coming soon.',
    videoUrl: '/videos/sample.mp4',
    width: 1080,
    height: 1920,
    likes: 210,
    comments: 15,
    shares: 5,
    saves: 22,
  },
];
