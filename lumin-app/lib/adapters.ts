// Maps the backend's snake_case API shapes (lib/api.ts) onto this app's
// existing camelCase frontend types (lib/types.ts) — kept as its own
// module rather than inlined in page.tsx so every screen that starts
// reading from the API (this pass: shop/discover feeds, comments,
// watchlist) converts the same way, once.
//
// Deliberately one-directional (API -> frontend) for now — nothing here
// writes a frontend type back into an API payload, since every write
// this pass makes (comment text, a watchlist toggle) is simple enough to
// send directly as its own small object rather than round-tripping
// through a full Product/VideoPost shape.

import type {
  ApiCartItem,
  ApiCategory,
  ApiCategoryBanner,
  ApiComment,
  ApiCommentReactor,
  ApiDeal,
  ApiMerchantAccount,
  ApiNotification,
  ApiOrder,
  ApiPersonResult,
  ApiProduct,
  ApiVideoPost,
} from './api';
import { apiShippingAddressToAddress } from './api';
import type {
  CartItem,
  Category,
  CategoryBanner,
  Comment,
  CommentReactor,
  ReactionType,
  Deal,
  MerchantAccount,
  Notification,
  Order,
  Product,
  SearchPerson,
  VideoPost,
} from './types';
import { formatRelativeTime } from './format';

export function apiCategoryToCategory(c: ApiCategory): Category {
  return { id: c.id, name: c.name };
}

export function apiDealToDeal(d: ApiDeal): Deal {
  return {
    text: d.text,
    sub: d.sub,
    // Storewide deals come back with a null category and stay
    // non-clickable in DealBanner, same as before.
    categoryId: d.category_id ?? undefined,
  };
}

// Banners and products are fetched separately (CategoryBannerRead carries
// no nested products), so the two are stitched back together here into
// the one shape the category screens already expect. Grouping client-side
// off a single GET /products beats one request per banner.
export function apiBannersToCategoryBanners(
  banners: ApiCategoryBanner[],
  products: ApiProduct[],
): CategoryBanner[] {
  const byBanner = new Map<string, Product[]>();
  for (const p of products) {
    if (!p.banner_id) continue;
    const list = byBanner.get(p.banner_id) ?? [];
    list.push(apiProductToProduct(p));
    byBanner.set(p.banner_id, list);
  }
  return banners.map((b) => ({
    id: b.id,
    categoryId: b.category_id,
    title: b.title,
    subtitle: b.subtitle ?? undefined,
    products: byBanner.get(b.id) ?? [],
  }));
}

export function apiMerchantAccountToMerchantAccount(m: ApiMerchantAccount): MerchantAccount {
  return {
    id: m.id,
    businessName: m.business_name,
    category: m.category,
    description: m.description,
    bankCode: m.bank_code ?? undefined,
    accountNumber: m.account_number ?? undefined,
    accountName: m.account_name ?? undefined,
    payoutReady: m.payout_ready,
  };
}

export function apiProductToProduct(p: ApiProduct): Product {
  const images = [...p.images].sort((a, b) => a.position - b.position).map((img) => img.url);
  return {
    id: p.id,
    name: p.name,
    price: parseFloat(p.price),
    cartCount: p.cart_count,
    imageUrl: images[0],
    images,
    description: p.description ?? undefined,
    colors: p.colors,
    sizes: p.sizes,
    bannerId: p.banner_id ?? undefined,
    isNew: p.is_new,
    stockQuantity: p.stock_quantity,
    discountPercent: p.discount_percent ?? undefined,
    inStock: p.in_stock,
  };
}

export function apiVideoPostToVideoPost(p: ApiVideoPost): VideoPost {
  return {
    id: p.id,
    posterName: p.poster_display_name,
    posterId: p.poster_id,
    posterAvatar: p.poster_avatar_url ?? undefined,
    postedAt: formatRelativeTime(p.created_at),
    createdAt: p.created_at,
    thumbnailUrl: p.thumbnail_url ?? undefined,
    description: p.description,
    videoUrl: p.video_url ?? undefined,
    liteVideoUrl: p.lite_video_url ?? undefined,
    retwinOfId: p.retwin_of_id ?? undefined,
    tagOnly: p.tag_only ?? false,
    retwinKind: p.retwin_kind ?? undefined,
    syncOffsetMs: p.sync_offset_ms ?? 0,
    productRetwins: (p.product_retwins ?? []).map((r) => ({
      id: r.id,
      posterName: r.poster_display_name,
      posterAvatar: r.poster_avatar_url ?? undefined,
    })),
    retwinOf: p.retwin_of
      ? {
          id: p.retwin_of.id,
          posterName: p.retwin_of.poster_display_name,
          videoUrl: p.retwin_of.video_url ?? undefined,
          liteVideoUrl: p.retwin_of.lite_video_url ?? undefined,
          thumbnailUrl: p.retwin_of.thumbnail_url ?? undefined,
          width: p.retwin_of.width ?? undefined,
          height: p.retwin_of.height ?? undefined,
        }
      : undefined,
    twins: (p.twins ?? []).map((t) => ({
      id: t.id,
      postId: t.video_post_id,
      productId: t.product_id,
      label: t.label,
      startMs: t.start_ms,
      endMs: t.end_ms,
      reviewStatus: t.review_status,
    })),
    views: p.views_count ?? 0,
    uniqueViewers: p.unique_viewers_count ?? 0,
    watchSeconds: p.watch_seconds_total ?? 0,
    completions: p.completions_count ?? 0,
    width: p.width ?? undefined,
    height: p.height ?? undefined,
    likes: p.likes_count,
    comments: p.comments_count,
    shares: p.shares_count,
    saves: p.saves_count,
    // Discover posts always come back with an empty products array from
    // the backend (see VideoPost's own model comment) — mapping it
    // straight through rather than special-casing feed === 'discover'
    // keeps this one function honest about what the API actually said.
    products: p.products.map(apiProductToProduct),
    interestIds: p.interests.map((i) => i.id),
    repostId: p.repost_id ?? undefined,
    repostedBy: p.reposted_by
      ? {
          id: p.reposted_by.id,
          displayName: p.reposted_by.display_name,
          avatarUrl: p.reposted_by.avatar_url ?? undefined,
        }
      : undefined,
  };
}

// The frontend's CartItem.id used to be a synthesized
// `${productId}-${color}-${size}` string, because nothing server-side
// existed to identify a line. Now it's the real row id the PATCH/DELETE
// routes take, and productId carries what that composite key was
// actually being read for. Variant lines stay distinct the same way
// either route does it — the backend matches on product+color+size
// before deciding to bump quantity vs. insert a new row.
export function apiCartItemToCartItem(item: ApiCartItem): CartItem {
  return {
    id: item.id,
    productId: item.product_id,
    productName: item.product.name,
    imageUrl: [...item.product.images].sort((a, b) => a.position - b.position)[0]?.url,
    price: parseFloat(item.product.price),
    color: item.color ?? undefined,
    size: item.size ?? undefined,
    quantity: item.quantity,
    inStock: item.product.in_stock,
    stockQuantity: item.product.stock_quantity,
    countsAsShopActivity: item.counts_as_shop_activity,
  };
}

export function apiOrderToOrder(o: ApiOrder): Order {
  return {
    id: o.id,
    productName: o.product_name,
    price: parseFloat(o.price),
    color: o.color ?? undefined,
    size: o.size ?? undefined,
    buyerName: o.buyer_name,
    placedAt: formatRelativeTime(o.created_at),
    status: o.status,
    shippingAddress: o.shipping_address ? apiShippingAddressToAddress(o.shipping_address) : undefined,
    cancelReason: o.cancel_reason ?? undefined,
    payoutStatus: o.payout_status,
    deliveredAt: o.delivered_at ?? undefined,
  };
}

export function apiCommentToComment(c: ApiComment): Comment {
  return {
    id: c.id,
    author: c.author_display_name,
    authorAvatarUrl: c.author_avatar_url ?? undefined,
    authorId: c.author_id ?? undefined,
    text: c.text,
    likes: c.likes_count,
    likedByMe: c.liked_by_me,
    parentId: c.parent_id ?? undefined,
    repliesCount: c.replies_count,
    // edited_at (not updated_at !== created_at): reacting to a comment
    // also touches updated_at, which used to make every reacted-to
    // comment look edited.
    isEdited: !!c.edited_at,
    createdAt: c.created_at,
    myReaction: (c.my_reaction as ReactionType | null) ?? (c.liked_by_me ? 'like' : null),
    reactionCounts: (c.reaction_counts ?? {}) as Partial<Record<ReactionType, number>>,
    isPinned: c.is_pinned,
    replyToName: c.reply_to_name ?? undefined,
    replyToUserId: c.reply_to_user_id ?? undefined,
  };
}

export function apiReactorToCommentReactor(r: ApiCommentReactor): CommentReactor {
  return {
    id: r.id,
    displayName: r.display_name,
    avatarUrl: r.avatar_url ?? undefined,
    reaction: r.reaction as ReactionType,
  };
}

export function apiPersonResultToSearchPerson(p: ApiPersonResult): SearchPerson {
  return {
    id: p.id,
    username: p.username,
    displayName: p.display_name,
    avatarUrl: p.avatar_url ?? undefined,
  };
}

// 'follow' and 'birthday' both just mean "open this person's profile"
// from the frontend's point of view — see Notification's own comment in
// lib/types.ts on why they collapse into one 'user' type here rather
// than the frontend needing to know about both. 'moderation' has
// nothing for a tap to open at all (see the backend model's comment) —
// becomes undefined, same as a notification with no type ever had
// before this.
function apiNotificationType(type: ApiNotification['type']): Notification['type'] {
  if (type === 'follow' || type === 'birthday') return 'user';
  // A twin search finally matched a product: tapping it opens that product.
  if (type === 'twin_available') return 'product';
  if (
    type === 'product' ||
    type === 'order' ||
    type === 'post_like' ||
    type === 'post_comment' ||
    type === 'comment_reply' ||
    type === 'comment_reaction' ||
    type === 'retwin' ||
    type === 'twin_request' ||
    type === 'twin_reply' ||
    // A seller offered a twin for a moment of your video: opens your twins inbox.
    type === 'twin_offered'
  ) {
    return type;
  }
  return undefined;
}

export function apiNotificationToNotification(n: ApiNotification): Notification {
  return {
    id: n.id,
    body: n.body,
    time: formatRelativeTime(n.created_at),
    read: n.read,
    type: apiNotificationType(n.type),
    targetId: n.target_id ?? undefined,
  };
}
