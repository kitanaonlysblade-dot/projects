export interface Category {
  id: string;
  name: string;
  iconUrl?: string;
}

export interface Interest {
  id: string;
  label: string;
  emoji: string;
}

export interface Notification {
  id: string;
  body: string;
  time: string;
  read?: boolean;
  // What tapping this notification should open. 'product' points at a
  // real Product id (the category catalog + shop posts are both
  // searched for it); 'order' just opens the buyer's own order history
  // generally — individual orders aren't seeded, only ever created live
  // by a real purchase, so there's no stable id to link a specific one to.
  // 'user' points at a User id (a new follower, or a followed account's
  // birthday) — opens their profile. The backend actually distinguishes
  // 'follow' from 'birthday' as two separate types (see Notification's
  // own comment there); lib/adapters.ts collapses both into 'user' here
  // since the frontend only ever does one thing with either: open that
  // person's profile.
  // 'post_like'/'post_comment' point at a VideoPost id — someone liked
  // or left a top-level comment on one of your posts. 'comment_reply'/
  // 'comment_reaction' also point at a VideoPost id (this app has no
  // scroll-to-comment deep link, so opening that post's own comments
  // panel is as specific as a tap can get) — someone replied to, or
  // reacted to, one of your comments. Kept as four distinct types
  // (rather than collapsed the way follow/birthday are into 'user')
  // since NotificationsScreen shows a different icon for each; the
  // navigation they trigger overlaps in page.tsx's handleSelectNotification.
  type?: 'product' | 'order' | 'user' | 'post_like' | 'post_comment' | 'comment_reply' | 'comment_reaction' | 'retwin' | 'twin_request' | 'twin_reply' | 'twin_offered';
  targetId?: string;
}

export interface Deal {
  text: string;
  sub: string;
  // Which category this deal is actually about, if any — lets the banner
  // link somewhere real instead of just being decorative text. Left unset
  // for storewide deals (e.g. "free shipping") that don't belong to one
  // category.
  categoryId?: string;
}

export interface Product {
  id: string;
  name: string;
  price: number;
  cartCount: number;
  // A gray placeholder box renders when this (or `images`) is empty —
  // same honest-mock-data convention as every thumbnail elsewhere in this
  // app. No real upload pipeline exists, so these are just path/URL
  // strings, the same way `videoUrl` works.
  imageUrl?: string;
  // Full gallery for the product detail screen — `imageUrl` above is kept
  // only for backward compatibility with anything reading a single image;
  // new code should read this instead.
  images?: string[];
  // Shown in full on the product detail screen. Falls back to a plain
  // "no description yet" line when unset, rather than fabricating one.
  description?: string;
  colors: string[];
  sizes: string[];
  // Only set for merchant-created products (via the dashboard's Products
  // tab) — which CategoryBanner they were filed under, so they render in
  // the right spot in the consumer-facing category catalog. Seed/demo
  // products don't have this; they're already nested inside their banner.
  bannerId?: string;
  // Backs the "New Arrivals" button in the sidebar — a flat filter across
  // every category, not scoped to one. Set directly on a handful of seed
  // products, and toggleable when a merchant creates their own.
  isNew?: boolean;
  // undefined/null means untracked — unlimited, no stock UI shown at
  // all, same as every product behaved before this existed. A merchant
  // who sets a real number gets it enforced server-side (reserve_stock
  // in the backend) and reflected here via inStock/this field, not
  // decremented locally — a purchase only actually reduces this once
  // the next fetch reflects what the server did.
  stockQuantity?: number | null;
  // Server-computed (stockQuantity == null || stockQuantity > 0) —
  // trust this rather than re-deriving it from stockQuantity in every
  // component that needs to disable a Buy/Add-to-cart button.
  inStock: boolean;
  // 0-100, undefined/0 meaning no discount. A merchant raising this is
  // what fires the "an item you saved just went on sale" notification —
  // see Notification's own comment on the 'product' type below.
  discountPercent?: number | null;
}

// A promotional banner shown on a category's landing page (tap a category
// in the sidebar/sheet to get here) — e.g. "T-Shirts Under $20" inside
// Apparel. Each banner carries its own product pool; tapping the banner
// or any product in its carousel opens the full catalog grid for just
// that pool, the same two-step "landing page -> catalog" flow Amazon
// uses for its category pages.
export interface CategoryBanner {
  id: string;
  categoryId: string;
  title: string;
  subtitle?: string;
  products: Product[];
}

export interface CartItem {
  id: string;
  // The product this line is for — separate from `id` (which also bakes
  // in color/size to keep cart lines for different variants distinct).
  // Needed to attribute a cart removal/quantity change back to the right
  // product's live activity count.
  productId: string;
  productName: string;
  // First photo of the product, undefined if it has none — CartScreen
  // falls back to the shared placeholder rather than an empty box.
  imageUrl?: string;
  price: number;
  color?: string;
  size?: string;
  quantity: number;
  // Snapshotted from the product at the moment the cart was fetched —
  // same "live view, not locked in" caveat as price above: it can go
  // stale between a fetch and checkout, which is exactly why the real
  // enforcement is still server-side (reserve_stock at payment
  // fulfillment). This is only ever a client-side early warning, same
  // as ProductCard/ProductDrawer's use of the same fields on Product.
  inStock: boolean;
  stockQuantity?: number | null;
  // Whether this line should move the shop-feed "bought & in carts"
  // counter — true only when it was added via the shop video feed's
  // drawer, not the category catalog/search/notifications. Carried on
  // the line itself so a later quantity change or removal knows whether
  // to touch that counter too.
  countsAsShopActivity?: boolean;
}

export interface ShippingAddress {
  recipientName: string;
  phone: string;
  line1: string;
  line2?: string;
  city: string;
  state?: string;
  postalCode?: string;
  country: string;
}

export interface Order {
  id: string;
  productName: string;
  price: number;
  color?: string;
  size?: string;
  buyerName: string;
  placedAt: string;
  status: 'pending' | 'shipped' | 'delivered' | 'cancelled';
  // Undefined only for an order placed before this existed — every new
  // order requires one to be created at all (see resolve_shipping_address
  // on the backend), so this is really "always present going forward."
  shippingAddress?: ShippingAddress;
  // Set only once cancelled (see the backend Order model's own comment)
  // — undefined on every order that never was, not an empty string.
  cancelReason?: string;
  // Separate from `status` on purpose — "has this shipped" and "has the
  // merchant actually been paid for it" are different questions once
  // escrow exists. See the backend's PayoutStatus for what each value
  // means and app/escrow.py for what moves it between them.
  payoutStatus: 'held' | 'released' | 'refunded';
  // Undefined until status actually reaches 'delivered' — this is what
  // the 24-hour "report a problem" window (below) counts from.
  deliveredAt?: string;
}

// How long after delivery a buyer can still report a defect — mirrors
// the backend's own CLAIM_WINDOW (app/return_policy.py) so the UI can
// show/hide the button without a failed request round-trip just to find
// out the window's already closed. If the backend's window ever changes,
// this needs to change with it — there's no single shared source of
// truth between two separate codebases here.
export const RETURN_CLAIM_WINDOW_HOURS = 24;

export interface MerchantAccount {
  id: string;
  businessName: string;
  category: string;
  description: string;
  // All undefined until POST /merchant/payout succeeds. accountName is
  // resolved from Paystack (the real name on file for the account), not
  // typed in by the merchant. payoutReady is the one components should
  // actually branch on — it's true exactly when Paystack has a transfer
  // recipient on file for this merchant, which is what release_to_
  // merchant (backend) requires before it'll pay anyone out.
  bankCode?: string;
  accountNumber?: string;
  accountName?: string;
  payoutReady: boolean;
}

export interface UserProfile {
  id: string;
  username: string;
  displayName: string;
  bio: string;
  // Undefined when the account has never set one — ProfileScreen falls
  // back to the same /images/placeholder.svg PosterProfileScreen uses
  // for someone else's profile, so both look the same either way.
  avatarUrl?: string;
  following: number;
  followers: number;
  // Collected at signup (CreateAccountScreen) since a real backend needs
  // it to authenticate return visits — not shown anywhere in the UI yet,
  // just carried on the profile so it's there once account settings or
  // login need it.
  email: string;
  // Settings screen toggles — carried here so handleCreateAccount (which
  // only receives a UserProfile, not the raw API user) can hydrate
  // page.tsx's own autoplayNext/defaultMuted state from it. See that
  // state's own comment in page.tsx for why it isn't just read off this
  // object directly everywhere instead.
  autoplayNext: boolean;
  defaultMuted: boolean;
  // Same reasoning as autoplayNext/defaultMuted just above — hydrates
  // page.tsx's own privateFollowLists state from handleCreateAccount.
  // Gates list_followers/list_following on the backend; nothing else.
  privateFollowLists: boolean;
  // Settings' "Hide mutual followers" toggle — see the backend's own
  // comment on hide_mutual_followers for exactly what this gates
  // (list_mutual_followers only, not the followers/following lists
  // themselves).
  hideMutualFollowers: boolean;
  // Undefined until the person either fills it in directly (Profile's
  // "Shipping address" row) or completes their first checkout — see
  // resolve_shipping_address on the backend for how a checkout address
  // becomes this saved default automatically ("remembered as last used",
  // no separate save step).
  shippingAddress?: ShippingAddress;
  // ISO date string ("YYYY-MM-DD"), undefined until the person sets one
  // in Settings — see SettingsScreen.tsx's Birthday field. Only ever
  // read for month/day, never the year: it's what
  // sync_birthday_notifications on the backend checks against everyone
  // this account follows, to notify "it's so-and-so's birthday today."
  birthday?: string;
  // False only while suspended (routers/admin.py's ban route) — checked
  // once, right after login/session-restore (see page.tsx), to route
  // to SuspensionScreen instead of the normal app. banReason/bannedAt
  // are only ever meaningful when this is false; both stay undefined
  // on an account that's never been banned, and are cleared (not kept
  // as history) the moment an unban actually happens.
  isActive: boolean;
  banReason?: string;
  bannedAt?: string;
}

export interface Comment {
  id: string;
  author: string;
  authorAvatarUrl?: string;
  // Undefined for the small hand-written fallback sets in lib/data.ts
  // (no backend behind them, no real account to compare against) — see
  // CommentsPanel's own comment on how it uses this to decide whether
  // to show Edit/Delete on a given comment.
  authorId?: string;
  text: string;
  likes: number;
  // Optional so the small hand-written fallback sets in lib/data.ts
  // (no backend behind them) don't need every field spelled out —
  // CommentsPanel/page.tsx treat a missing value the same as its
  // default (not liked, no replies, top-level).
  likedByMe?: boolean;
  // Set only on a reply — the id of the top-level comment it replies
  // to (a reply's own replies still point at that same top-level
  // parent; see the backend Comment model's own comment on why this
  // is one level deep, not true nesting). CommentsPanel groups the
  // flat list it's given into threads using this.
  parentId?: string;
  repliesCount?: number;
  // True once editComment has been called on this comment at least
  // once (the server's edited_at is set) — drives the "(edited)"
  // marker in CommentsPanel.
  isEdited?: boolean;
  // ISO timestamp — drives the "2h" / "Just now" label and the
  // Newest / Most relevant sort.
  createdAt?: string;
  // Facebook-style reactions. myReaction is the viewer's own pick;
  // reactionCounts maps reaction -> people (only non-zero entries).
  // `likes` above stays the total number of reactions of any kind.
  myReaction?: ReactionType | null;
  reactionCounts?: Partial<Record<ReactionType, number>>;
  // Pinned to the top of the thread by the post's owner.
  isPinned?: boolean;
  // Set on a reply that was aimed at another reply (not the top-level
  // comment) — shown as a blue @name in front of the text.
  replyToName?: string;
  replyToUserId?: string;
  // True while a just-posted comment is still waiting on the server.
  pending?: boolean;
}

export type ReactionType = 'like' | 'love' | 'care' | 'haha' | 'wow' | 'sad' | 'angry';

export interface CommentReactor {
  id: string;
  displayName: string;
  avatarUrl?: string;
  reaction: ReactionType;
}

// SearchScreen.tsx's People section — a real user, not a VideoPost
// author, so it's its own thin type rather than a fake/partial
// VideoPost. Deliberately minimal (no email, no following/followers
// counts) — matches the same public-safe slice the backend's
// PersonResult schema returns, since search results are visible to
// anyone, logged in or not.
export interface SearchPerson {
  id: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
}

// "Twinning": a product paired with the stretch of a shop video where it is
// on screen. `label` is the short name the shop pill shows ("bag").
export interface Twin {
  id: string;
  // Which post holds this twin (a retwin's feed entry also carries the original's).
  postId?: string;
  productId: string;
  label: string;
  startMs: number;
  endMs: number;
  // Set by the server; a flagged twin no longer drives the pill.
  reviewStatus?: 'pending' | 'approved' | 'flagged';
}

export interface RetwinOriginal {
  id: string;
  posterName: string;
  videoUrl?: string;
  liteVideoUrl?: string;
  thumbnailUrl?: string;
  width?: number;
  height?: number;
}

export interface VideoPost {
  id: string;
  posterName: string;
  // Real backend user id for the poster — undefined for mock/fallback
  // posts (lib/data.ts has no real signed-up users behind its sample
  // posters, so there's nothing a Follow button could actually target).
  // Screens offering a Follow action treat a missing posterId as "can't
  // follow this," not as an error.
  posterId?: string;
  // Falls back to /images/placeholder.svg where data.ts doesn't set one —
  // same fallback convention ProductDetailScreen already uses for
  // product images, kept consistent rather than inventing a second one.
  posterAvatar?: string;
  postedAt: string;
  // ISO timestamp behind postedAt — lets analytics filter by period. Absent for
  // posts created locally this session (treated as brand new).
  createdAt?: string;
  // Auto-generated from the clip at post time (see generateVideoThumbnail
  // in MerchantPosts.tsx) — a data URL, not a separate uploaded asset.
  // Optional: mock/seed posts created before this existed, or a post
  // whose thumbnail generation failed, simply have none, and every grid
  // that renders posts falls back to a solid-color tile for that case.
  thumbnailUrl?: string;
  description: string;
  videoUrl?: string;
  // Smaller copy made in the background after upload; only played when the
  // viewer has Lumin Lite on (see lib/lite.ts). Absent until it exists.
  liteVideoUrl?: string;
  // Shop posts only; absent/empty on older posts (pill keeps its whole-video behaviour).
  twins?: Twin[];
  // Set only on a retwin: the original video it plays alongside (stacked
  // above it). On a retwin, `products` and `twins` are already the merged set.
  retwinOfId?: string;
  // A retwin with no video of its own: products tagged onto the original.
  tagOnly?: boolean;
  retwinKind?: 'video' | 'product';
  // Video retwins: where in the original the retwin's own video starts.
  syncOffsetMs?: number;
  // On an original: sellers who tagged their products onto it.
  productRetwins?: { id: string; posterName: string; posterAvatar?: string }[];
  retwinOf?: RetwinOriginal;
  // Viewing stats (shop analytics): a view = ~3s of real playback, once per
  // viewer per day. watchSeconds is total time played across all views.
  views?: number;
  uniqueViewers?: number;
  watchSeconds?: number;
  completions?: number;
  // Known dimensions from upload processing — lets the frame size itself
  // correctly on first paint, without waiting for the video file to load
  // and report its own dimensions. This is what real platforms store.
  width?: number;
  height?: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  // Optional: absent entirely for Discover content, which never shows
  // shopping UI regardless of whether this array is empty or missing.
  products?: Product[];
  // Which Discover topics this post belongs to — unused by the main feed.
  interestIds?: string[];
  // Set only when this feed entry is a repost — see the backend's own
  // comment on VideoPost.repost_of_id. Every field above (id included)
  // still describes the ORIGINAL post: interactions, product tags, and
  // poster/merchant attribution all stay the original's, matching how
  // a retweet keeps the original tweet's content. `repostId` is the
  // repost row's own id, used only as a stable React key (see
  // renderShopVideoStage/renderDiscoverVideoStage in page.tsx) since
  // the same original could otherwise appear twice on one feed page —
  // interactions never target it.
  repostId?: string;
  repostedBy?: { id: string; displayName: string; avatarUrl?: string };
}
