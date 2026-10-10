'use client';

import { useEffect, useRef, useState } from 'react';
import { NavBar } from '@/components/NavBar';
import { DiscoverNavBar } from '@/components/DiscoverNavBar';
import { CategoryDrawer } from '@/components/CategoryDrawer';
import { CategorySheet } from '@/components/CategorySheet';
import { DiscoverOnboarding } from '@/components/DiscoverOnboarding';
import { getRecommended } from '@/components/RecommendedDrawer';
import { VideoPrefetch } from '@/components/VideoPrefetch';
import { VideoStage } from '@/components/VideoStage';
import { ProductDrawer } from '@/components/ProductDrawer';
import type { MerchantSection } from '@/components/MerchantDashboard';
import { CategoryLanding } from '@/components/CategoryLanding';
import { CategoryCatalog } from '@/components/CategoryCatalog';
import { ProductDetailScreen } from '@/components/ProductDetailScreen';
import { SearchScreen } from '@/components/SearchScreen';
import { CommentsPanel } from '@/components/CommentsPanel';
import { ProfileScreen } from '@/components/ProfileScreen';
import { CreateAccountScreen } from '@/components/CreateAccountScreen';
import { TermsScreen } from '@/components/TermsScreen';
import { LegalScreen } from '@/components/LegalScreen';
import type { LegalDocId } from '@/lib/legalDocs';
import { LoginScreen } from '@/components/LoginScreen';
import { ForgotPasswordScreen } from '@/components/ForgotPasswordScreen';
import { SuspensionScreen } from '@/components/SuspensionScreen';
import { MerchantCreate } from '@/components/MerchantCreate';
import { TwinSearchSheet } from '@/components/TwinSearchSheet';
import { TWIN_ENABLED } from '@/lib/features';
import { BottomNav, type BottomTab } from '@/components/BottomNav';
import { WantedBoard } from '@/components/WantedBoard';
import { WantedDetail, type WantedScreen } from '@/components/WantedDetail';
import { CreatorImpact } from '@/components/CreatorImpact';
import { CreatorTwins } from '@/components/CreatorTwins';
import { getWatchedMs } from '@/lib/playbackTime';
import { MerchantDashboard } from '@/components/MerchantDashboard';
import { NotificationsScreen } from '@/components/NotificationsScreen';
import { MyOrdersScreen } from '@/components/MyOrdersScreen';
import { CartScreen } from '@/components/CartScreen';
import { ShippingAddressScreen } from '@/components/ShippingAddressScreen';
import { WatchlistScreen } from '@/components/WatchlistScreen';
import { PosterProfileScreen } from '@/components/PosterProfileScreen';
import { FollowListScreen } from '@/components/FollowListScreen';
import { SettingsScreen } from '@/components/SettingsScreen';
import { SwipeStage } from '@/components/SwipeStage';
import {
  shopPosts as fallbackShopPosts,
  discoverPosts as fallbackDiscoverPosts,
  discoverComments as fallbackDiscoverComments,
  categoryBanners as fallbackCategoryBanners,
  categories as fallbackCategories,
  deals as fallbackDeals,
  interests as fallbackInterests,
  posterStats,
} from '@/lib/data';
import type {
  CartItem,
  Category,
  CategoryBanner,
  Comment,
  CommentReactor,
  ReactionType,
  Deal,
  Interest,
  MerchantAccount,
  Notification,
  Order,
  Product,
  ShippingAddress,
  UserProfile,
  VideoPost,
  SearchPerson,
} from '@/lib/types';
import { useDiscoverInterests } from '@/hooks/useDiscoverInterests';
import { openPaystackCheckout } from '@/lib/paystack';
import {
  apiUserToProfile,
  clearToken,
  getMe,
  getToken,
  setUnauthorizedHandler,
  listVideoPosts,
  getVideoPost,
  listComments,
  addComment as apiAddComment,
  likeComment as apiLikeComment,
  unlikeComment as apiUnlikeComment,
  editComment as apiEditComment,
  deleteComment as apiDeleteComment,
  reactToComment as apiReactToComment,
  removeCommentReaction as apiRemoveCommentReaction,
  listCommentReactors as apiListCommentReactors,
  pinComment as apiPinComment,
  unpinComment as apiUnpinComment,
  addToWatchlist as apiAddToWatchlist,
  removeFromWatchlist as apiRemoveFromWatchlist,
  listMyWatchlist,
  getProduct,
  likeVideoPost as apiLikeVideoPost,
  unlikeVideoPost as apiUnlikeVideoPost,
  listMyLikedPostIds,
  shareVideoPost as apiShareVideoPost,
  unshareVideoPost as apiUnshareVideoPost,
  repostVideoPost as apiRepostVideoPost,
  removeRepost as apiRemoveRepost,
  listMyRepostPostIds,
  listMyVideoPosts,
  listVideoPostsByPoster,
  listMySharedPostIds,
  listCart,
  addToCart as apiAddToCart,
  recordProductTap,
  updateCartItemQuantity as apiUpdateCartItemQuantity,
  removeFromCart as apiRemoveFromCart,
  initializeCartPayment,
  initializeBuyNowPayment,
  verifyPayment as apiVerifyPayment,
  previewDiscount,
  listMyOrders,
  listSellingOrders,
  advanceOrderStatus as apiAdvanceOrderStatus,
  cancelOrder as apiCancelOrder,
  confirmReceipt as apiConfirmReceipt,
  reportDefect as apiReportDefect,
  listCategories,
  listBanners,
  listProducts,
  listDeals,
  listInterests,
  createMerchantAccount as apiCreateMerchantAccount,
  addMerchantPayout as apiAddMerchantPayout,
  getMyMerchantAccount,
  listNotifications,
  markNotificationRead as apiMarkNotificationRead,
  markAllNotificationsRead as apiMarkAllNotificationsRead,
  getUserPublicProfile,
  listFollowers,
  listFollowing,
  listVideoPostLikers,
  listMutualFollowers,
  listMyMerchantProducts,
  addMerchantProduct as apiAddMerchantProduct,
  updateMerchantProduct as apiUpdateMerchantProduct,
  deleteMerchantProduct as apiDeleteMerchantProduct,
  createVideoPost as apiCreateVideoPost,
  updateVideoPost as apiUpdateVideoPost,
  deleteVideoPost as apiDeleteVideoPost,
  getFollowStatus,
  followUser,
  unfollowUser,
  updateMe,
  addressToApiShippingAddress,
  recordTrafficSource,
} from '@/lib/api';
import {
  apiVideoPostToVideoPost,
  apiCommentToComment,
  apiReactorToCommentReactor,
  apiCartItemToCartItem,
  apiOrderToOrder,
  apiCategoryToCategory,
  apiBannersToCategoryBanners,
  apiDealToDeal,
  apiProductToProduct,
  apiMerchantAccountToMerchantAccount,
  apiNotificationToNotification,
  apiPersonResultToSearchPerson,
} from '@/lib/adapters';

type View =
  | 'shop'
  | 'discoverPlayer'
  | 'categoryLanding'
  | 'categoryCatalog'
  | 'productDetail'
  | 'search'
  | 'wanted'
  | 'wantedDetail'
  | 'creatorImpact'
  | 'creatorTwins'
  | 'profile'
  | 'createAccount'
  | 'terms'
  | 'legal'
  | 'login'
  | 'merchantCreate'
  | 'merchantDashboard'
  | 'notifications'
  | 'cart'
  | 'watchlist'
  | 'settings'
  | 'posterProfile'
  | 'followList'
  | 'myOrders'
  | 'shippingAddress'
  | 'forgotPassword'
  | 'suspended';

// What "Discover" opens with — no more browse grid to tap a thumbnail
// from, so something has to be chosen automatically. Prefers a post
// matching whatever the person picked during onboarding, same pool
// DiscoverFeed used to group into rows; falls back to the full pool for
// "skipped onboarding" or "nothing matched."
function pickStartingPost(selectedInterests: string[] | null, pool: VideoPost[]): VideoPost {
  if (selectedInterests && selectedInterests.length > 0) {
    const matches = pool.filter((p) => p.interestIds?.some((id) => selectedInterests.includes(id)));
    if (matches.length > 0) return matches[Math.floor(Math.random() * matches.length)];
  }
  return pool[Math.floor(Math.random() * pool.length)];
}

export default function Home() {
  const [view, setView] = useState<View>('shop');
  // Stateful (not a static import) — the merchant dashboard's Posts tab
  // adds/edits/deletes directly against this, and in this single-merchant
  // prototype "the shop feed" and "this merchant's catalog" are the same
  // pool, so changes there show up here immediately.
  //
  // Starts empty and is filled by the fetch effect just below rather than
  // from lib/data.ts directly — the mock arrays (fallbackShopPosts etc.)
  // are kept around only as what renders if that fetch actually fails
  // (backend unreachable), so the feed still has *something* in it
  // instead of going blank.
  const [shopPosts, setShopPosts] = useState<VideoPost[]>([]);
  // Paging for the shop feed: the first 50 load up front; more are fetched as
  // the viewer nears the end of what's loaded (see the effect after shopIndex).
  const shopLoadingMoreRef = useRef(false);
  const shopHasMoreRef = useRef(true);
  const [discoverPosts, setDiscoverPosts] = useState<VideoPost[]>([]);
  // This account's own Discover posts — real uploads and reposts alike
  // — for ProfileScreen's "Your posts" grid. Sourced from GET
  // /video-posts/mine (loadAccountState below) rather than filtered out
  // of `discoverPosts` above, since that's just whatever page of the
  // general, shuffled feed happens to be loaded right now, not a
  // reliable list of everything this account has posted.
  const [myDiscoverPosts, setMyDiscoverPosts] = useState<VideoPost[]>([]);
  // Only the signed-in merchant's own shop posts (originals + their reposts),
  // from GET /video-posts/mine?feed=shop. The merchant dashboard's Posts tab
  // must read this, NOT `shopPosts`, which is the global, shuffled shop feed
  // containing every merchant's videos.
  const [myShopPosts, setMyShopPosts] = useState<VideoPost[]>([]);
  const [shopFeedLoading, setShopFeedLoading] = useState(true);
  // Keyed by post id, filled lazily (see the effect below keyed off
  // activeDiscoverPost) rather than all upfront the way the mock version
  // loaded every post's thread at once — fetching comments for a post
  // nobody has opened yet isn't worth the request.
  const [discoverComments, setDiscoverComments] = useState<Record<string, Comment[]>>({});

  // Same fetch-with-mock-fallback shape as the feeds above. `categories`
  // and `categoryBanners` are what every category screen, deal link, and
  // search pool reads from — nothing imports the lib/data.ts versions
  // directly anymore.
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryBanners, setCategoryBanners] = useState<CategoryBanner[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  // Shared by DiscoverOnboarding, SettingsScreen's "Content interests",
  // and UploadDiscoverPostModal's topic picker — one fetch instead of
  // three, and one moment where all three switch from mock ids (like
  // 'fashion') to the real UUIDs VideoPost.interestIds actually contains.
  // Selecting/toggling against the mock ids would silently match nothing
  // once posts come from the backend.
  const [interests, setInterests] = useState<Interest[]>(fallbackInterests);

  // Re-pulls the consumer catalog after the merchant changes their own
  // listings. Needed because the two are now genuinely the same data on
  // the server: a product added/edited/removed in the dashboard changes
  // what GET /products returns, and nothing would reflect that here
  // otherwise until a full reload. Silent on failure — the dashboard's
  // own copy already updated, so the worst case is the category pages
  // lagging until the next load rather than anything breaking.
  const refreshCatalog = () => {
    Promise.all([listBanners(), listProducts()])
      .then(([banners, products]) => setCategoryBanners(apiBannersToCategoryBanners(banners, products)))
      .catch(() => {});
  };

  useEffect(() => {
    let cancelled = false;

    // Catalog — public, no auth. Banners and products are separate routes
    // (CategoryBannerRead carries no nested products), so they're fetched
    // together and stitched in the adapter. One GET /products covers every
    // banner at once, and because merchant-created products carry a
    // banner_id they come back in that same response — which is why
    // there's no longer a client-side merge of "seed products plus the
    // merchant's own" the way there used to be. The server is the one
    // source now.
    Promise.all([listCategories(), listBanners(), listProducts(), listDeals(), listInterests()])
      .then(([cats, banners, products, promos, topics]) => {
        if (cancelled) return;
        setCategories(cats.map(apiCategoryToCategory));
        setCategoryBanners(apiBannersToCategoryBanners(banners, products));
        setDeals(promos.map(apiDealToDeal));
        setInterests(topics.map((i) => ({ id: i.id, label: i.label, emoji: i.emoji })));
      })
      .catch(() => {
        if (cancelled) return;
        setCategories(fallbackCategories);
        setCategoryBanners(fallbackCategoryBanners);
        setDeals(fallbackDeals);
        setInterests(fallbackInterests);
      });

    listVideoPosts({ feed: 'shop', limit: 50 })
      .then((posts) => {
        if (!cancelled) setShopPosts(posts.map(apiVideoPostToVideoPost));
      })
      .catch(() => {
        if (!cancelled) setShopPosts(fallbackShopPosts);
      })
      .finally(() => {
        if (!cancelled) setShopFeedLoading(false);
      });
    // No loading flag tracked for this one — openDiscoverPlayer's own
    // `discoverPosts.length === 0` guard already covers "tapped Discover
    // before this resolved" by just no-op'ing, and nothing else in this
    // screen needs to render a discover-specific loading state.
    listVideoPosts({ feed: 'discover', limit: 50 })
      .then((posts) => {
        if (!cancelled) setDiscoverPosts(posts.map(apiVideoPostToVideoPost));
      })
      .catch(() => {
        if (!cancelled) setDiscoverPosts(fallbackDiscoverPosts);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  // Fixed pool, not open-ended like discover — swiping just moves the
  // index, clamped at both ends (no wraparound, no on-the-fly recommending).
  const [shopIndex, setShopIndex] = useState(0);
  // When a post is opened from someone's profile (their own, another
  // poster's, or the merchant Posts tab) the shop player is limited to
  // just that person's posts, in grid order, instead of the global feed —
  // see handleOpenShopGallery. null means the normal, global shop feed.
  const [shopScope, setShopScope] = useState<VideoPost[] | null>(null);
  const SHOP_PAGE_SIZE = 20;
  useEffect(() => {
    if (shopScope) return; // a person's own gallery is a fixed list
    if (shopPosts.length === 0 || shopLoadingMoreRef.current || !shopHasMoreRef.current) return;
    if (shopIndex < shopPosts.length - 3) return; // not near the end yet
    // The first page is shuffled, so the cursor has to be the OLDEST loaded
    // row (by date), not simply the last one in the list.
    const dated = shopPosts.filter((p) => p.createdAt);
    if (dated.length === 0) return;
    const oldest = dated.reduce((a, b) => (new Date(a.createdAt!) <= new Date(b.createdAt!) ? a : b));
    shopLoadingMoreRef.current = true;
    listVideoPosts({ feed: 'shop', limit: SHOP_PAGE_SIZE, before: oldest.repostId ?? oldest.id })
      .then((posts) => {
        if (posts.length < SHOP_PAGE_SIZE) shopHasMoreRef.current = false;
        setShopPosts((prev) => {
          const seen = new Set(prev.map((p) => p.repostId ?? p.id));
          const fresh = posts.map(apiVideoPostToVideoPost).filter((p) => !seen.has(p.repostId ?? p.id));
          if (fresh.length === 0) shopHasMoreRef.current = false;
          return fresh.length > 0 ? [...prev, ...fresh] : prev;
        });
      })
      .catch(() => {})
      .finally(() => {
        shopLoadingMoreRef.current = false;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopIndex, shopPosts.length, shopScope]);
  const [shopBackView, setShopBackView] = useState<View>('shop');
  // Where the global feed was before a gallery took over, restored on exit.
  const shopIndexBeforeScope = useRef(0);
  const feedPosts = shopScope ?? shopPosts;
  const activeShopPost: VideoPost | null = feedPosts[Math.min(shopIndex, feedPosts.length - 1)] ?? null;
  // A visited-order history rather than a single post, so swiping up/down
  // in discover mode can move forward/back through what's actually been
  // seen instead of just holding "the current one." Opening Discover fresh
  // resets this; swiping extends it forward.
  const [discoverNav, setDiscoverNav] = useState<{ items: VideoPost[]; index: number }>({
    items: [],
    index: -1,
  });
  const activeDiscoverPost = discoverNav.items[discoverNav.index] ?? null;
  // True when discoverNav holds a fixed gallery (one person's posts, opened
  // from their profile): swiping only moves within it and never pulls in
  // recommendations. Back then returns to discoverBackView, not the shop.
  const [discoverScoped, setDiscoverScoped] = useState(false);
  const [discoverBackView, setDiscoverBackView] = useState<View>('shop');

  // Fetches a post's comment thread the first time it's actually opened,
  // not upfront for the whole pool — `postId in discoverComments` (not
  // `discoverComments[postId]?.length`) is the "already fetched" check,
  // since a post with zero comments still needs to be remembered as
  // fetched or it'd be re-requested every time it comes back around.
  // discoverComments deliberately isn't a dependency here — see the same
  // pattern (and the same reasoning) on SwipeStage's settle effect.
  useEffect(() => {
    const postId = activeDiscoverPost?.id;
    if (!postId || postId in discoverComments) return;
    listComments(postId)
      .then((comments) => {
        setDiscoverComments((prev) => ({ ...prev, [postId]: comments.map(apiCommentToComment) }));
      })
      .catch(() => {
        setDiscoverComments((prev) => ({ ...prev, [postId]: fallbackDiscoverComments[postId] ?? [] }));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDiscoverPost?.id]);

  const [categoriesOpen, setCategoriesOpen] = useState(false);
  // The category someone tapped into, and — one level deeper — the banner
  // they tapped from that category's landing page. Both live here (not in
  // the pages themselves) so the "back" flow can drop straight from
  // catalog to landing to shop without losing where you were.
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [selectedBanner, setSelectedBanner] = useState<CategoryBanner | null>(null);
  // Reached either from a category tile (in which case selectedCategory
  // is already correct and stays put) or from Search, which can surface a
  // product from any category — this tracks which so "back" returns
  // somewhere that actually makes sense either way.
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [productDetailBackView, setProductDetailBackView] = useState<
    'categoryCatalog' | 'search' | 'shop' | 'notifications' | 'wantedDetail'
  >('categoryCatalog');
  // Same "remember where we came from" pattern as productDetailBackView —
  // My Orders is reachable from Profile (a buyer checking on stuff they
  // bought) and from a notification tap (routed straight to order status),
  // so back needs to return to whichever of those actually opened it.
  const [myOrdersBackView, setMyOrdersBackView] = useState<'shop' | 'profile'>('shop');

  const handleSelectProduct = (product: Product) => {
    setSelectedProduct(product);
    setProductDetailBackView('categoryCatalog');
    setView('productDetail');
  };

  // Reached by tapping a product's thumbnail/name on the shop feed's
  // ProductDrawer. Shop products live on the video post itself, not in any
  // shopping category, so — unlike handleSelectProduct/handleSelectSearchProduct
  // — this deliberately leaves selectedCategory untouched; the render below
  // falls back to a generic label instead of requiring one.
  const handleSelectShopProduct = (product: Product) => {
    // Count the tap against the video the product was tagged on (best-effort).
    if (activeShopPost) recordProductTap(activeShopPost.id, product.id).catch(() => {});
    setSelectedProduct(product);
    setProductDetailBackView('shop');
    setView('productDetail');
  };

  // Search spans every category, so unlike handleSelectProduct (reached
  // only from within a category someone already tapped into) this has to
  // work out which category a result belongs to on the fly and set it,
  // otherwise ProductDetailScreen's categoryName would show whatever
  // category was last browsed instead of the right one.
  const handleSelectSearchProduct = (product: Product) => {
    const owningBanner = categoryBanners.find((b) => b.products.some((p) => p.id === product.id));
    const category = owningBanner ? categories.find((c) => c.id === owningBanner.categoryId) : undefined;
    if (category) setSelectedCategory(category);
    setSelectedProduct(product);
    setProductDetailBackView('search');
    setView('productDetail');
  };

  // Tapping a "More like this" tile — swaps the product in place rather
  // than pushing a new screen, so productDetailBackView (wherever this
  // whole excursion started) is deliberately left untouched: "back" still
  // exits to the original category/search/shop context, however many
  // related products were tapped through along the way. selectedCategory
  // still gets corrected in case a related pick belongs to a different
  // category than the one just left.
  const handleSelectRelatedProduct = (product: Product) => {
    const owningBanner = categoryBanners.find((b) => b.products.some((p) => p.id === product.id));
    const category = owningBanner ? categories.find((c) => c.id === owningBanner.categoryId) : undefined;
    if (category) setSelectedCategory(category);
    setSelectedProduct(product);
  };

  // Same banner first (closest match), then rounded out with the rest of
  // the category if the banner alone is too sparse to feel like a real
  // "more like this" row.
  const getRelatedProducts = (product: Product): Product[] => {
    const owningBanner = categoryBanners.find((b) => b.products.some((p) => p.id === product.id));
    if (!owningBanner) return [];
    const sameBanner = owningBanner.products.filter((p) => p.id !== product.id);
    if (sameBanner.length >= 4) return sameBanner.slice(0, 8);
    const sameCategoryOthers = categoryBanners
      .filter((b) => b.categoryId === owningBanner.categoryId && b.id !== owningBanner.id)
      .flatMap((b) => b.products)
      .filter((p) => p.id !== product.id);
    return [...sameBanner, ...sameCategoryOthers].slice(0, 8);
  };

  // Notifications point at either a specific product (found the same way
  // handleSelectSearchProduct finds one — checked against the category
  // catalog first, then shop posts' own featured products) or, for order-
  // status notifications, the buyer's order history generally. There's no
  // seeded/stable id for an individual order to link to — orders only
  // ever exist because a real purchase created one — so 'order' just
  // opens My Orders rather than pointing at one specific order.
  const handleSelectNotification = (n: Notification) => {
    // A seller offered a twin for a moment of your video: it is waiting in your inbox.
    if (n.type === 'twin_offered') {
      if (!TWIN_ENABLED) return; // the inbox it points to is switched off
      setView('creatorTwins');
      return;
    }
    if (n.type === 'order') {
      setMyOrdersBackView('shop');
      setView('myOrders');
      return;
    }
    if (n.type === 'product' && n.targetId) {
      const owningBanner = categoryBanners.find((b) => b.products.some((p) => p.id === n.targetId));
      if (owningBanner) {
        const product = owningBanner.products.find((p) => p.id === n.targetId);
        const category = categories.find((c) => c.id === owningBanner.categoryId);
        if (product) {
          if (category) setSelectedCategory(category);
          setSelectedProduct(product);
          setProductDetailBackView('notifications');
          setView('productDetail');
          return;
        }
      }
      const shopProduct = shopPosts.flatMap((p) => p.products ?? []).find((p) => p.id === n.targetId);
      if (shopProduct) {
        setSelectedProduct(shopProduct);
        setProductDetailBackView('notifications');
        setView('productDetail');
        return;
      }
      // Not in anything loaded yet (e.g. a product just listed that a twin search was
      // waiting for): fetch it, so the notification still opens it.
      getProduct(n.targetId)
        .then((p) => {
          setSelectedProduct(apiProductToProduct(p));
          setProductDetailBackView('notifications');
          setView('productDetail');
        })
        .catch(() => {});
      return;
    }
    if (
      (n.type === 'post_like' ||
        n.type === 'post_comment' ||
        n.type === 'comment_reply' ||
        n.type === 'comment_reaction' ||
        n.type === 'retwin' ||
        n.type === 'twin_request' ||
        n.type === 'twin_reply') &&
      n.targetId
    ) {
      // All four point at a VideoPost id (see Notification's own
      // comment in lib/types.ts on why comment-level activity still
      // targets the post, not the comment itself). Shop and discover
      // posts each have their own "jump to this one" helper — feed
      // isn't on the frontend VideoPost type, so it's read off the raw
      // API response before mapping, same as the ?post= share-link
      // effect above does implicitly by only ever handling discover.
      const wantsComments = n.type === 'post_comment' || n.type === 'comment_reply' || n.type === 'comment_reaction';
      getVideoPost(n.targetId)
        .then((post) => {
          const mapped = apiVideoPostToVideoPost(post);
          if (post.feed === 'shop') {
            handleSelectShopPost(mapped);
          } else {
            handleOpenDiscoverPost(mapped);
            if (wantsComments) setCommentsOpen(true);
          }
        })
        .catch(() => {}); // post since deleted, or a transient error — just stay put
      return;
    }
    if (n.type === 'user' && n.targetId) {
      // A follow/birthday notification only ever carries a bare user id
      // (see ApiNotification's own comment) — resolve it into a
      // name/avatar before handing it to handleViewPoster, same as
      // search results do via apiPersonResultToSearchPerson.
      getUserPublicProfile(n.targetId)
        .then((person) => {
          handleViewPoster(
            { posterName: person.display_name, posterAvatar: person.avatar_url ?? undefined, posterId: person.id },
            'notifications',
          );
        })
        .catch(() => {}); // account since deleted, or a transient error — just stay put
      return;
    }
    // Nothing resolvable — the tap already marked it read (see
    // NotificationsScreen), so just stay put rather than navigating
    // somewhere confusing.
  };
  // Mobile/tablet only: tapping the video hides every bit of UI drawn on
  // top of it (chips, poster info, engagement rail, the floating product
  // tag) so only the video shows; tapping again — or the video looping —
  // brings it all back. Lives here so VideoStage and ProductDrawer, which
  // both draw overlay content on the video, stay in sync.
  const [overlayVisible, setOverlayVisible] = useState(true);
  // Mobile/tablet only — lifted for the same reason overlayVisible is:
  // ProductDrawer needs to survive navigating to full product details and
  // back with its sheet state intact, not reset to closed on remount.
  const [shopSheetOpen, setShopSheetOpen] = useState(false);
  // Pixel height of the on-screen shop video's poster/caption block, so the
  // floating "Shop this video" pill can sit above it (see ProductDrawer).
  const [shopCaptionHeight, setShopCaptionHeight] = useState(0);
  // Whether the shop video's "See more" scrim is open, so the floating
  // "Shop this video" pill can dim out along with everything else behind
  // that scrim instead of staying at full brightness on top of it (see
  // ProductDrawer).
  const [shopDescExpanded, setShopDescExpanded] = useState(false);
  // Remembered across a trip into the gallery player and back, because
  // PosterProfileScreen / MerchantDashboard remount when returned to and
  // would otherwise reset to their first tab.
  const [posterProfileTab, setPosterProfileTab] = useState<'posts' | 'discover' | undefined>(undefined);
  const [merchantSection, setMerchantSection] = useState<MerchantSection>('overview');

  const [discoverOpen, setDiscoverOpen] = useState(false);
  const { hasOnboarded, interests: selectedInterests, complete } = useDiscoverInterests();
  // Mobile/tablet only — desktop shows CommentsPanel permanently instead.
  // Reset to closed whenever the post changes (fresh open, swipe in either
  // direction) so it never carries over onto an unrelated video.
  const [commentsOpen, setCommentsOpen] = useState(false);

  // Empty until loadAccountState below fetches the real thing — same
  // "nothing until a session is confirmed" convention orders/cart/
  // watchlist already follow elsewhere in this file. Stateful so
  // marking one/all as read actually persists and the NavBar badge
  // reflects unread count, not total count.
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const unreadNotificationCount = notifications.filter((n) => !n.read).length;

  // Optimistic, no rollback — unlike a like/follow, a stale "still shows
  // unread" after a failed request is low-stakes and self-corrects the
  // next time notifications are loaded, so it's not worth the extra
  // state a full rollback would need.
  const handleMarkNotificationRead = (id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    apiMarkNotificationRead(id).catch(() => {});
  };

  const handleMarkAllNotificationsRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    apiMarkAllNotificationsRead().catch(() => {});
  };

  // Cart — separate from Orders (which "Buy now" writes to directly).
  // Checkout is what turns cart lines into real Orders; adding to cart on
  // its own doesn't touch the merchant's Orders queue at all.
  const [cartItems, setCartItems] = useState<CartItem[]>([]);

  // Live "bought & in carts" count per product, shown in the shop-this-
  // video drawer. Starts at 0 for every product — deliberately ignoring
  // the static `cartCount` seed value other mock numbers in this app use
  // — and only reflects actions taken through the shop video feed itself
  // (its ProductDrawer, or a product opened from it), never the category
  // catalog, search, or notifications. `trackActivity` on the two
  // handlers below is what draws that line: it defaults to false, so the
  // plain handleBuyNow/handleAddToCart used everywhere else never touch
  // this counter — only the *FromShopFeed wrappers passed to the shop
  // feed's own components set it true. Checkout doesn't touch it either
  // way: a checked-out item was already counted the moment it went into
  // the cart, and the label covers both "bought" and "in carts," so
  // moving from one bucket to the other isn't a change in the total.
  const [productActivity, setProductActivity] = useState<Record<string, number>>({});

  const bumpProductActivity = (productId: string, delta: number) => {
    setProductActivity((prev) => ({ ...prev, [productId]: Math.max(0, (prev[productId] ?? 0) + delta) }));
  };

  // Server-confirmed rather than optimistic like the watchlist toggle:
  // a cart line's id is assigned by the backend, and the "same
  // product+color+size bumps quantity instead of adding a line" decision
  // is made there too, so there's nothing meaningful to draw until the
  // response comes back. The button's own "Added ✓" flash is local to
  // ProductCard and fires immediately either way.
  const handleAddToCart = (product: Product, color: string, size: string, trackActivity = false) => {
    if (!getToken()) {
      setView('login');
      return;
    }
    apiAddToCart({
      product_id: product.id,
      color,
      size,
      quantity: 1,
      counts_as_shop_activity: trackActivity,
      // Shop-feed adds credit the video being watched (server-checked).
      source_video_post_id: trackActivity ? activeShopPost?.id : undefined,
    })
      .then((item) => {
        const line = apiCartItemToCartItem(item);
        setCartItems((prev) => {
          const index = prev.findIndex((i) => i.id === line.id);
          if (index === -1) return [...prev, line];
          const next = [...prev];
          next[index] = line;
          return next;
        });
        if (trackActivity) bumpProductActivity(product.id, 1);
      })
      .catch(() => {});
  };

  // Passed to the shop video feed's ProductDrawer specifically — same
  // handler, just with tracking switched on.
  const handleAddToCartFromShopFeed = (product: Product, color: string, size: string) =>
    handleAddToCart(product, color, size, true);

  // These two can stay optimistic where handleAddToCart couldn't — the
  // row already exists and its id is known, so the UI can move first and
  // roll back on failure (same shape as handleToggleSave). The backend
  // deletes the row itself when quantity hits 0, matching what the
  // stepper does visually here.
  const handleUpdateCartQuantity = (id: string, quantity: number) => {
    const item = cartItems.find((i) => i.id === id);
    if (!item) return;
    const snapshot = cartItems;
    if (item.countsAsShopActivity) bumpProductActivity(item.productId, quantity - item.quantity);
    setCartItems((prev) =>
      quantity <= 0 ? prev.filter((i) => i.id !== id) : prev.map((i) => (i.id === id ? { ...i, quantity } : i)),
    );
    apiUpdateCartItemQuantity(id, quantity).catch(() => {
      setCartItems(snapshot);
      if (item.countsAsShopActivity) bumpProductActivity(item.productId, item.quantity - quantity);
    });
  };

  const handleRemoveFromCart = (id: string) => {
    const item = cartItems.find((i) => i.id === id);
    if (!item) return;
    const snapshot = cartItems;
    if (item.countsAsShopActivity) bumpProductActivity(item.productId, -item.quantity);
    setCartItems((prev) => prev.filter((i) => i.id !== id));
    apiRemoveFromCart(id).catch(() => {
      setCartItems(snapshot);
      if (item.countsAsShopActivity) bumpProductActivity(item.productId, item.quantity);
    });
  };

  // Both checkout paths (this one, and handleBuyNow further down) need a
  // shipping address to exist before payment can even be initialized —
  // see resolve_shipping_address on the backend, which 400s otherwise.
  // Deliberately doesn't try to auto-resume the payment popup once an
  // address is saved: Paystack Inline's popup (like most payment
  // popups) has to open as the direct, synchronous result of a click to
  // avoid being blocked as an unwanted popup, and by the time
  // updateMe()'s promise resolves, that click is long over. Simplest
  // correct fix: send the person back to where they were and let them
  // press Pay/Buy again themselves — a fresh, real click.
  const [shippingAddressBackView, setShippingAddressBackView] = useState<'cart' | 'shop' | 'profile' | 'settings'>(
    'cart',
  );

  const handleOpenShippingAddress = (backView: 'cart' | 'shop' | 'profile' | 'settings') => {
    setShippingAddressBackView(backView);
    setView('shippingAddress');
  };

  const handleSaveShippingAddress = (address: ShippingAddress): Promise<void> =>
    updateMe({ shipping_address: addressToApiShippingAddress(address) }).then((user) => {
      setUserAccount(apiUserToProfile(user));
      setView(shippingAddressBackView);
    });

  // POST /payments/initialize computes the real amount server-side from
  // the actual cart; the Paystack popup collects the card; only once
  // POST /payments/verify confirms the charge does an Order actually
  // get created — one per unit of quantity (a line with quantity 3
  // becomes 3 orders), same expansion the old direct checkout() used,
  // just moved behind payments.py now — and the cart rows are cleared
  // server-side at that point too. Nothing is expanded or invented
  // here; the created orders come back in verify's own response.
  //
  // Returns the promise rather than swallowing it so CartScreen can await
  // it and hold off on "Order placed ✓" until it actually resolves.
  // subtotal/shipping/total in dollars (converted back from Paystack's
  // subunit convention) — CartScreen's success state shows this
  // breakdown once checkout actually resolves, rather than a bare "Order
  // placed" with no confirmation of what was actually charged. null
  // specifically means "redirected to fill in a shipping address, this
  // wasn't a real checkout attempt" — CartScreen skips its success
  // state entirely in that case rather than showing a $0 breakdown.
  const handleCheckout = (
    discountCode?: string,
  ): Promise<{ subtotal: number; discount: number; shipping: number; total: number } | null> => {
    if (!getToken()) {
      setView('login');
      return Promise.reject(new Error('Not signed in'));
    }
    if (!userAccount?.shippingAddress) {
      handleOpenShippingAddress('cart');
      // Resolves, not rejects — this isn't a failed checkout to show an
      // error for, it's a redirect to go fill in what checkout needs
      // first. CartScreen's own button is about to unmount anyway.
      return Promise.resolve(null);
    }
    let totals = { subtotal: 0, discount: 0, shipping: 0, total: 0 };
    return initializeCartPayment(addressToApiShippingAddress(userAccount.shippingAddress), discountCode)
      .then((init) => {
        totals = {
          subtotal: init.subtotal_subunit / 100,
          discount: init.discount_subunit / 100,
          shipping: init.shipping_subunit / 100,
          total: init.amount_subunit / 100,
        };
        return openPaystackCheckout({
          publicKey: init.public_key,
          email: init.email,
          amountSubunit: init.amount_subunit,
          currency: init.currency,
          reference: init.reference,
        }).then(() => apiVerifyPayment(init.reference));
      })
      .then((created) => {
        setOrders((prev) => [...created.map(apiOrderToOrder), ...prev]);
        setCartItems([]);
        return totals;
      });
  };

  // Read-only — POST /discounts/preview, used by CartScreen's "Apply"
  // button before any payment is initialized. Converts the
  // string-decimal amounts the backend returns (Pydantic Decimal ->
  // JSON string, same as every other money field) into plain numbers
  // for display; errors (invalid/expired/exhausted code) propagate as
  // ApiError for the caller's own try/catch to show verbatim, same as
  // handleCheckout already does for a stock-conflict message.
  const handlePreviewDiscount = (code: string) =>
    previewDiscount({ code, mode: 'cart' }).then((preview) => ({
      code: preview.code,
      discountAmount: parseFloat(preview.discount_amount),
    }));

  // Same idea as handlePreviewDiscount above, just against a single
  // product's price instead of the whole cart — ProductDetailScreen's
  // own Buy Now flow is the only caller, since that's the one Buy Now
  // surface with room for a code field at all (ProductCard's tile
  // version is a deliberate one-tap impulse buy; a text input there
  // would fight that).
  const handlePreviewBuyNowDiscount = (code: string, productId: string) =>
    previewDiscount({ code, mode: 'buy_now', product_id: productId, quantity: 1 }).then((preview) => ({
      code: preview.code,
      discountAmount: parseFloat(preview.discount_amount),
    }));

  // Watchlist — backed by the Save button in VideoStage's engagement rail,
  // for whichever post is currently active in either player. Real per-
  // user server state now (POST/DELETE /video-posts/{id}/watchlist,
  // initial contents loaded by the session-restore effect further down)
  // rather than local-only — same auth gate and optimistic-then-reconcile
  // shape as handleAddComment above, for the same reason (the backend
  // route requires a logged-in user, so a logged-out tap goes to sign up
  // instead of firing a request that can only 401).
  const [watchlist, setWatchlist] = useState<VideoPost[]>([]);

  const handleToggleSave = (post: VideoPost) => {
    if (!getToken()) {
      setView('login');
      return;
    }
    const alreadySaved = watchlist.some((p) => p.id === post.id);
    setWatchlist((prev) => (alreadySaved ? prev.filter((p) => p.id !== post.id) : [post, ...prev]));
    const request = alreadySaved ? apiRemoveFromWatchlist(post.id) : apiAddToWatchlist(post.id);
    request.catch(() => {
      // Request failed — put it back the way it was rather than leaving
      // the UI showing a save/un-save that never actually persisted.
      setWatchlist((prev) => (alreadySaved ? [post, ...prev] : prev.filter((p) => p.id !== post.id)));
    });
  };

  // Like/share — same real, per-user, persisted shape as watchlist just
  // above (was purely local optimistic state in VideoStage before, never
  // sent anywhere). Ids only, not full posts — nothing renders a "liked
  // posts" or "shared posts" screen, so there's nothing to browse, just
  // per-post booleans to seed (see followedPosterIds for the same
  // id-keyed-boolean shape used for Follow).
  const [likedPostIds, setLikedPostIds] = useState<Record<string, boolean>>({});
  const [sharedPostIds, setSharedPostIds] = useState<Record<string, boolean>>({});

  const handleToggleLike = (post: VideoPost) => {
    if (!getToken()) {
      setView('login');
      return;
    }
    const alreadyLiked = likedPostIds[post.id] ?? false;
    setLikedPostIds((prev) => ({ ...prev, [post.id]: !alreadyLiked }));
    const request = alreadyLiked ? apiUnlikeVideoPost(post.id) : apiLikeVideoPost(post.id);
    request.catch(() => {
      setLikedPostIds((prev) => ({ ...prev, [post.id]: alreadyLiked }));
    });
  };

  // Share keeps the same toggle shape the frontend already had (not
  // usually how real platforms treat sharing, but this isn't the place
  // to redesign that — see the backend's own comment on post_shares).
  const handleToggleShare = (post: VideoPost) => {
    if (!getToken()) {
      setView('login');
      return;
    }
    const alreadyShared = sharedPostIds[post.id] ?? false;
    setSharedPostIds((prev) => ({ ...prev, [post.id]: !alreadyShared }));
    const request = alreadyShared ? apiUnshareVideoPost(post.id) : apiShareVideoPost(post.id);
    request.catch(() => {
      setSharedPostIds((prev) => ({ ...prev, [post.id]: alreadyShared }));
    });
  };

  // Same client-side-only, doesn't-survive-a-refresh tracking as
  // likedPostIds/savedPostIds/sharedPostIds above — see handleToggleFollow's
  // own comment on why none of these are fetched from the backend on load.
  const [repostedPostIds, setRepostedPostIds] = useState<Record<string, boolean>>({});

  // The "Repost" option in ShareSheet.tsx (via VideoStage's onRepost).
  // Unlike handleToggleShare above, the create side isn't a plain
  // boolean flip — a successful repost is a brand-new feed entry, so on
  // success this also prepends the real created/resolved post (repostId
  // + repostedBy set, everything else the original's) to whichever of
  // shopPosts/discoverPosts its own `feed` says it belongs to. The
  // backend decides that feed, not this call — see create_repost's own
  // comment on why there's no feed param to get wrong.
  // Twin search ("What's this?"): from a shop video with its clip, or with no post
  // at all from the discovery search screen.
  // `shop` = opened from the shop feed's product drawer, so adds/buys credit that video.
  const [twinSearch, setTwinSearch] = useState<{ post: VideoPost | null; query: string; shop: boolean; startAtMs?: number } | null>(null);
  const handleOpenTwinSearch = (post: VideoPost | null, query = '', shop = false) => {
    if (!getToken()) {
      setView('login');
      return;
    }
    // One tap: the sheet opens with the moment they just watched already picked.
    const startAtMs = post ? getWatchedMs(post.id) ?? undefined : undefined;
    setTwinSearch({ post, query, shop, startAtMs });
  };

  const handleToggleRepost = (post: VideoPost) => {
    if (!getToken()) {
      setView('login');
      return;
    }
    const alreadyReposted = repostedPostIds[post.id] ?? false;
    setRepostedPostIds((prev) => ({ ...prev, [post.id]: !alreadyReposted }));
    if (alreadyReposted) {
      // repostedPostIds is keyed by the ORIGINAL post's id (see
      // listMyRepostPostIds' own comment), which is also what every
      // repost of it reads back as its own `id` — so this drops your
      // repost card from wherever it's currently showing (the general
      // feed cache, and your own profile) by matching on that shared id
      // plus repostId actually being set, so the original post's own
      // card (if it's also sitting in the same cache) is left alone.
      const dropMine = (list: VideoPost[]) => list.filter((p) => !(p.repostId && p.id === post.id));
      setDiscoverPosts(dropMine);
      setShopPosts(dropMine);
      setMyShopPosts(dropMine);
      setMyDiscoverPosts(dropMine);
      apiRemoveRepost(post.id).catch(() => {
        setRepostedPostIds((prev) => ({ ...prev, [post.id]: true }));
        // Not reconstructing the removed card on failure — a failed
        // un-repost is rare enough, and the next feed refresh/profile
        // load reconciles it (same "next load will fix it" reasoning
        // several other optimistic actions in this file already lean
        // on rather than fully rolling back).
      });
      return;
    }
    apiRepostVideoPost(post.id)
      .then((created) => {
        const mapped = apiVideoPostToVideoPost(created);
        if (created.feed === 'shop') {
          setShopPosts((prev) => [mapped, ...prev]);
          setMyShopPosts((prev) => [mapped, ...prev]);
        } else {
          setDiscoverPosts((prev) => [mapped, ...prev]);
          // A repost is a real row of the reposter's own — it belongs
          // on their profile the same as anything else they posted, so
          // ProfileScreen's own list (sourced from GET /video-posts/mine,
          // not filtered out of the general feed) needs it too.
          setMyDiscoverPosts((prev) => [mapped, ...prev]);
        }
      })
      .catch(() => {
        setRepostedPostIds((prev) => ({ ...prev, [post.id]: false }));
      });
  };

  // Jumps discover straight to a specific post — used by both the
  // watchlist (tapping a saved video) and Search (tapping a discover
  // result), which is why this isn't named after either one specifically.
  //
  // With `gallery` (a profile's grid), the player opens on that post but
  // holds the profile's whole list, so swiping moves only through that
  // person's posts and Back returns to their profile.
  const sameFeedEntry = (a: VideoPost, b: VideoPost) => (a.repostId ?? a.id) === (b.repostId ?? b.id);

  const handleOpenDiscoverPost = (post: VideoPost, gallery?: { posts: VideoPost[]; backView: View }) => {
    if (gallery) {
      const at = gallery.posts.findIndex((p) => sameFeedEntry(p, post));
      setDiscoverNav(
        at >= 0 ? { items: gallery.posts, index: at } : { items: [post], index: 0 },
      );
      setDiscoverScoped(true);
      setDiscoverBackView(gallery.backView);
    } else {
      setDiscoverNav({ items: [post], index: 0 });
      setDiscoverScoped(false);
      setDiscoverBackView('shop');
    }
    setDiscoverPendingDirection(null);
    setCommentsOpen(false);
    setOverlayVisible(true);
    setView('discoverPlayer');
  };

  const handleDiscoverBack = () => {
    setView(discoverBackView);
    setDiscoverScoped(false);
    setDiscoverBackView('shop');
  };

  // Shop-feed equivalent: opens the shop player on `post` but limited to
  // `posts` (a profile's or the merchant's own grid).
  const handleOpenShopGallery = (post: VideoPost, posts: VideoPost[], backView: View) => {
    const at = posts.findIndex((p) => sameFeedEntry(p, post));
    shopIndexBeforeScope.current = shopScope ? shopIndexBeforeScope.current : shopIndex;
    setShopScope(at >= 0 ? posts : [post]);
    setShopIndex(at >= 0 ? at : 0);
    setShopBackView(backView);
    setShopPendingDirection(null);
    setShopSheetOpen(false);
    setOverlayVisible(true);
    setView('shop');
  };

  const exitShopGallery = () => {
    setShopScope(null);
    setShopIndex(shopIndexBeforeScope.current);
    setShopPendingDirection(null);
    setShopSheetOpen(false);
  };

  const handleShopGalleryBack = () => {
    exitShopGallery();
    setView(shopBackView);
    setShopBackView('shop');
  };

  // Leaving the gallery by any other route (e.g. tapping the profile or a
  // category from inside it) must not leave the global shop feed stuck on
  // one person's posts the next time it opens.
  useEffect(() => {
    if (
      shopScope &&
      (view === 'profile' || view === 'posterProfile' || view === 'merchantDashboard' || view === 'discoverPlayer')
    ) {
      exitShopGallery();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // A copied "Share" link (see ShareSheet.tsx) lands back here as
  // ?post=<id> — there's no real per-post route to land on in this
  // single-page app, so this is what actually resolves that param into
  // the discover player instead of the link just reopening the feed
  // from the top. Runs once on mount and works logged-out too (the
  // backend's GET /video-posts/{id} needs no auth), since a shared link
  // should open for whoever it was sent to, not just the poster.
  useEffect(() => {
    const postId = new URLSearchParams(window.location.search).get('post');
    if (!postId) return;
    getVideoPost(postId)
      .then((post) => {
        setDiscoverNav({ items: [apiVideoPostToVideoPost(post)], index: 0 });
        setView('discoverPlayer');
      })
      .catch(() => {})
      .finally(() => {
        const url = new URL(window.location.href);
        url.searchParams.delete('post');
        window.history.replaceState({}, '', url.toString());
      });
  }, []);

  // A shared Wanted moment (?wanted=<id>, see WantedDetail's share button) opens straight
  // to it, same idea as ?post= above. Works logged-out; a request that isn't public shows
  // the screen's own "isn't available" message.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('wanted');
    if (!id) return;
    // An old shared link while the twin layer is switched off: just land on the normal app.
    if (!TWIN_ENABLED) {
      const url = new URL(window.location.href);
      url.searchParams.delete('wanted');
      window.history.replaceState({}, '', url.toString());
      return;
    }
    setWantedId(id);
    setWantedScreen('detail');
    setWantedBackView('wanted');
    setView('wantedDetail');
    const url = new URL(window.location.href);
    url.searchParams.delete('wanted');
    window.history.replaceState({}, '', url.toString());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // One call, once, on the very first load of a session — captures
  // where this visit actually came from (document.referrer) plus any
  // UTM params on the landing URL, the two things GET /admin/analytics/
  // traffic groups by. Deliberately not tied to login/session-restore
  // (recordTrafficSource takes no auth) — most real visits are
  // logged-out at the exact moment they'd be most worth attributing.
  // UTM params are read but not stripped from the URL the way ?post=
  // above is — a marketing link staying shareable/bookmarkable with its
  // own tracking intact is normal, unlike ?post= which only ever made
  // sense as a one-time redirect.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    recordTrafficSource({
      referrer: document.referrer || undefined,
      utm_source: params.get('utm_source') ?? undefined,
      utm_medium: params.get('utm_medium') ?? undefined,
      utm_campaign: params.get('utm_campaign') ?? undefined,
    }).catch(() => {});
  }, []);

  // Someone else's profile, reached by tapping their name/avatar in
  // either feed — not the viewer's own (that's handleOpenProfile,
  // elsewhere). Posts are still matched up by display name across both
  // pools (see the filter below, unchanged) — id is only carried through
  // now for the Follow button, which needs a real target to call the
  // follow/unfollow endpoints against; posts from mock/fallback data
  // still have no id, so that button just doesn't render for them.
  const [viewedPoster, setViewedPoster] = useState<{ name: string; avatar?: string; id?: string } | null>(null);
  const [posterProfileBackView, setPosterProfileBackView] = useState<
    'shop' | 'search' | 'notifications' | 'followList'
  >('shop');

  const handleViewPoster = (
    post: { posterName: string; posterAvatar?: string; posterId?: string },
    origin: 'shop' | 'search' | 'notifications' | 'followList' = 'shop',
  ) => {
    if (origin !== 'followList') followTripStack.current = [];
    setViewedPoster({ name: post.posterName, avatar: post.posterAvatar, id: post.posterId });
    setPosterProfileTab(undefined);
    setPosterProfileBackView(origin);
    setView('posterProfile');
  };

  // Follow — the button lives in three places (VideoStage in shop mode,
  // VideoStage in discover mode, PosterProfileScreen), all pointed at
  // whichever poster is actually on screen right now. Cached by poster
  // id rather than fetched per-render for the same reason discoverComments
  // is cached by post id: `posterId in followedPosterIds` is the "already
  // know this one" check (not `[posterId]` truthiness), since "confirmed
  // not following" is itself a fetched, cacheable answer.
  const [followedPosterIds, setFollowedPosterIds] = useState<Record<string, boolean>>({});

  // Real follower/following counts + bio for whichever poster is on
  // screen via PosterProfileScreen, keyed by their real backend id.
  // These used to come from the static `posterStats` mock (keyed by
  // display name, never touched by the real follow/unfollow endpoints),
  // which is why following someone never moved anyone's numbers — this
  // fetches the real ones instead, and handleToggleFollow below nudges
  // them optimistically the same way it already does followedPosterIds.
  // Mock/fallback posters with no real id (see PosterProfileScreen's own
  // comment on posterId) still fall back to the static posterStats
  // lookup wherever this is read, since there's no backend account to
  // fetch counts for.
  const [posterProfileStats, setPosterProfileStats] = useState<
    Record<
      string,
      {
        bio: string;
        followers: number;
        following: number;
        isPrivate: boolean;
        // null until the follow-up mutual-followers fetch below
        // resolves (or is skipped entirely — see that fetch's own
        // comment for when) — kept apart from 0 so the render can tell
        // "not checked yet / not checkable" from "checked, genuinely
        // none", and only show the row once it's actually a number.
        mutualFollowersCount: number | null;
      }
    >
  >({});

  useEffect(() => {
    const id = viewedPoster?.id;
    if (!id || id in posterProfileStats) return;
    getUserPublicProfile(id)
      .then((person) => {
        setPosterProfileStats((prev) => ({
          ...prev,
          [id]: {
            bio: person.bio,
            followers: person.followers_count,
            following: person.following_count,
            isPrivate: person.private_follow_lists,
            mutualFollowersCount: null,
          },
        }));
        // Skip the extra request entirely when there's nothing it could
        // return: no signed-in viewer to be "mutual" with, or the
        // account has hidden this (private_follow_lists implies it too
        // — see list_mutual_followers' own comment on the backend for
        // why) — same as never rendering the row in that case, just
        // one network round trip earlier.
        if (!getToken() || person.private_follow_lists || person.hide_mutual_followers) return;
        listMutualFollowers(id)
          .then((mutuals) => {
            setPosterProfileStats((prev) =>
              prev[id] ? { ...prev, [id]: { ...prev[id], mutualFollowersCount: mutuals.length } } : prev,
            );
          })
          .catch(() => {
            // Leave it null — falls back to not showing the row, same
            // as the outer catch below.
          });
      })
      .catch(() => {
        // Couldn't fetch — leave it unset so the render falls back to
        // posterStats rather than caching a wrong/empty answer.
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewedPoster?.id]);

  // Real posts (uploads and reposts alike) for whichever poster is on
  // screen via PosterProfileScreen — same "fetch and cache by real
  // backend id, don't filter whatever the general feed happens to have
  // loaded" reasoning as posterProfileStats just above and myDiscoverPosts'
  // own comment. Split by feed since PosterProfileScreen shows a
  // poster's Discover grid and, on their shop/merchant tab, their Shop
  // one — a poster with both a personal account and a merchant page can
  // have posts in either.
  const [viewedPosterPosts, setViewedPosterPosts] = useState<Record<string, { discover: VideoPost[]; shop: VideoPost[] }>>(
    {},
  );

  useEffect(() => {
    const id = viewedPoster?.id;
    if (!id || id in viewedPosterPosts) return;
    Promise.all([listVideoPostsByPoster(id, 'discover'), listVideoPostsByPoster(id, 'shop')])
      .then(([discover, shop]) => {
        setViewedPosterPosts((prev) => ({
          ...prev,
          [id]: { discover: discover.map(apiVideoPostToVideoPost), shop: shop.map(apiVideoPostToVideoPost) },
        }));
      })
      .catch(() => {
        // Leave it unset — falls back to the old filtered-general-feed
        // list wherever this is read, same fallback shape
        // posterProfileStats' own catch above uses.
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewedPoster?.id]);

  const relevantPosterId =
    view === 'shop'
      ? activeShopPost?.posterId
      : view === 'discoverPlayer'
        ? activeDiscoverPost?.posterId
        : view === 'posterProfile'
          ? viewedPoster?.id
          : undefined;

  useEffect(() => {
    // Not logged in: every route this hits requires auth anyway, and an
    // anonymous viewer can't be following anyone — no request needed to
    // know the answer is false, so this just skips rather than fetching
    // and caching a `false` that might go stale. That's safe to skip
    // (rather than needing an explicit retry once logged in) because
    // handleToggleFollow's own auth redirect sends view to 'createAccount'
    // when this fires while logged out, which makes relevantPosterId
    // briefly undefined and then the same value again once they're back —
    // a real dependency change, so this effect re-runs and, now logged
    // in, actually fetches.
    if (!relevantPosterId || !getToken() || relevantPosterId in followedPosterIds) return;
    getFollowStatus(relevantPosterId)
      .then((following) => {
        setFollowedPosterIds((prev) => ({ ...prev, [relevantPosterId]: following }));
      })
      .catch(() => {
        // Couldn't confirm — leave it unknown rather than guessing, so a
        // later render (e.g. after the network recovers) gets to try
        // again instead of this being cached as a wrong answer.
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relevantPosterId]);

  const handleToggleFollow = (posterId: string) => {
    if (!getToken()) {
      setView('createAccount');
      return;
    }
    const alreadyFollowing = followedPosterIds[posterId] ?? false;
    const delta = alreadyFollowing ? -1 : 1;
    setFollowedPosterIds((prev) => ({ ...prev, [posterId]: !alreadyFollowing }));
    // Same optimistic-then-revert-on-failure pattern as followedPosterIds
    // just above: nudge the *other* two numbers this action changes —
    // the target's followers count, and the viewer's own following count
    // — right away rather than waiting on a refetch, and put them back
    // if the request doesn't actually stick.
    setPosterProfileStats((prev) => {
      const current = prev[posterId];
      if (!current) return prev;
      return { ...prev, [posterId]: { ...current, followers: Math.max(0, current.followers + delta) } };
    });
    setUserAccount((prev) => (prev ? { ...prev, following: Math.max(0, prev.following + delta) } : prev));
    const request = alreadyFollowing ? unfollowUser(posterId) : followUser(posterId);
    request.catch(() => {
      // Failed — put it back the way it was, same "don't leave the UI
      // showing something that didn't actually persist" reasoning as
      // handleToggleSave.
      setFollowedPosterIds((prev) => ({ ...prev, [posterId]: alreadyFollowing }));
      setPosterProfileStats((prev) => {
        const current = prev[posterId];
        if (!current) return prev;
        return { ...prev, [posterId]: { ...current, followers: Math.max(0, current.followers - delta) } };
      });
      setUserAccount((prev) => (prev ? { ...prev, following: Math.max(0, prev.following - delta) } : prev));
    });
  };

  // Followers/Following/Likes list — reached by tapping the Followers/
  // Following label on ProfileScreen.tsx (the viewer's own) or
  // PosterProfileScreen.tsx (someone else's), or the like count on
  // VideoStage. One piece of state serves all three: `subjectId` +
  // `kind` say whose list and which one (a user id for followers/
  // following, a video post id for likes), so re-opening a different
  // label just replaces it rather than needing a separate slot per
  // screen. `people` starts empty and `loading` true on every open
  // (even a re-open of the same list) so a stale list never flashes
  // before the fresh fetch resolves.
  const [followListState, setFollowListState] = useState<{
    kind: 'followers' | 'following' | 'likes' | 'mutual';
    subjectId: string;
    ownerName?: string;
    people: SearchPerson[];
    loading: boolean;
    // Set when the fetch fails — most notably a 403 from an account
    // with private_follow_lists on, but also covers a deleted post/
    // account (404) or a network hiccup. Shown instead of the list/
    // empty-state, since "private" and "genuinely has nobody in it"
    // need different copy (see FollowListScreen).
    error: string | null;
  } | null>(null);
  const [followListBackView, setFollowListBackView] = useState<
    'profile' | 'posterProfile' | 'shop' | 'discoverPlayer'
  >('profile');

  // Fixes the followers/following back-button loop. Tapping a person in a
  // list opens THEIR profile, which replaces viewedPoster — so the list's
  // own "back" (to the profile it belongs to) used to land on the person
  // just tapped instead, whose back button returned to the list, forever.
  // Each hop from a list into a profile now pushes a snapshot of where it
  // came from (the list itself, whose profile was showing, which tab, where
  // that profile's own back went), and backing out of that profile pops it
  // and restores all of it exactly. A stack, not a single slot, so chains
  // (list -> profile -> their list -> profile ...) unwind one step at a time.
  const followTripStack = useRef<
    {
      viewedPoster: { name: string; avatar?: string; id?: string } | null;
      posterBack: 'shop' | 'search' | 'notifications' | 'followList';
      posterTab: 'posts' | 'discover' | undefined;
      listState: typeof followListState;
      listBack: 'profile' | 'posterProfile' | 'shop' | 'discoverPlayer';
    }[]
  >([]);

  const handlePosterProfileBack = () => {
    if (posterProfileBackView === 'followList') {
      const snap = followTripStack.current.pop();
      if (snap) {
        setViewedPoster(snap.viewedPoster);
        setPosterProfileBackView(snap.posterBack);
        setPosterProfileTab(snap.posterTab);
        setFollowListState(snap.listState);
        setFollowListBackView(snap.listBack);
        setView('followList');
        return;
      }
    }
    setView(posterProfileBackView);
  };

  const handleOpenPeopleList = (
    subjectId: string,
    kind: 'followers' | 'following' | 'likes' | 'mutual',
    ownerName: string | undefined,
    backView: 'profile' | 'posterProfile' | 'shop' | 'discoverPlayer',
  ) => {
    // A list opened from a profile that was itself reached through a list
    // continues that chain; from anywhere else it starts a fresh one.
    if (!(backView === 'posterProfile' && posterProfileBackView === 'followList')) {
      followTripStack.current = [];
    }
    setFollowListBackView(backView);
    setFollowListState({ kind, subjectId, ownerName, people: [], loading: true, error: null });
    setView('followList');
    const request =
      kind === 'followers'
        ? listFollowers(subjectId)
        : kind === 'following'
          ? listFollowing(subjectId)
          : kind === 'likes'
            ? listVideoPostLikers(subjectId)
            : listMutualFollowers(subjectId);
    request
      .then((people) => {
        // Only apply if this is still the list that's on screen — a
        // fast second tap (Followers then immediately Following, or
        // Back then a different poster/post) shouldn't have an
        // in-flight response from the first tap land on top of the
        // second.
        setFollowListState((prev) =>
          prev && prev.subjectId === subjectId && prev.kind === kind
            ? { ...prev, people: people.map(apiPersonResultToSearchPerson), loading: false }
            : prev,
        );
      })
      .catch((err: unknown) => {
        // The backend's own detail message (e.g. "This account's
        // followers list is private.") is specific enough to show
        // verbatim — same as handlePreviewDiscount elsewhere trusting
        // ApiError's message for the same reason.
        const message = err instanceof Error && err.message ? err.message : 'Couldn\u2019t load this list.';
        setFollowListState((prev) =>
          prev && prev.subjectId === subjectId && prev.kind === kind
            ? { ...prev, loading: false, error: message }
            : prev,
        );
      });
  };

  const handleSelectFollowListPerson = (person: SearchPerson) => {
    // Tapping yourself in a followers/following/likes list should open
    // your own profile (with the edit button etc.), not the read-only
    // PosterProfileScreen — same distinction handleOpenProfile/
    // handleViewPoster already draw everywhere else.
    if (person.id === userAccount?.id) {
      setView('profile');
      return;
    }
    followTripStack.current.push({
      viewedPoster,
      posterBack: posterProfileBackView,
      posterTab: posterProfileTab,
      listState: followListState,
      listBack: followListBackView,
    });
    handleViewPoster(
      { posterName: person.displayName, posterAvatar: person.avatarUrl, posterId: person.id },
      'followList',
    );
  };

  // Search's shop-post equivalent — the shop feed is a fixed, index-based
  // array rather than discover's open-ended history, so "jump to this
  // post" just means moving the index. SwipeStage renders `current`
  // directly with no animation whenever pendingDirection is null (see its
  // own comment on settledKey), which is exactly what a direct jump like
  // this needs — no transition to fake.
  const handleSelectShopPost = (post: VideoPost) => {
    // A global jump (search result, notification, shared link) is never
    // part of someone's profile gallery.
    if (shopScope) exitShopGallery();
    const index = shopPosts.findIndex((p) => p.id === post.id);
    if (index === -1) {
      // Not in the currently-loaded window — the common case for a
      // search result now that search queries the whole backend catalog
      // independently of whatever page of the feed happened to already
      // be loaded here. Prepending and jumping to it, same as a freshly
      // published post already does in handleAddShopPost, rather than
      // silently doing nothing (this used to just return early whenever
      // a post wasn't already in shopPosts, back when every caller of
      // this only ever passed a post that already was).
      setShopPosts((prev) => [post, ...prev]);
      setShopPendingDirection(null);
      setShopIndex(0);
      setView('shop');
      return;
    }
    setShopPendingDirection(null);
    setShopIndex(index);
    setView('shop');
  };

  const handleOpenSearch = () => setView('search');

  // The Wanted board (shop side only; Discover stays entertainment).
  const [wantedId, setWantedId] = useState<string | null>(null);
  // Which Wanted screen is open (the moment, or its compare list), so coming back from a
  // product page lands on the same one.
  const [wantedScreen, setWantedScreen] = useState<WantedScreen>('detail');
  // Where Back from a Wanted moment goes: the wall, or the creator screen it was opened from.
  const [wantedBackView, setWantedBackView] = useState<'wanted' | 'creatorImpact'>('wanted');
  const handleOpenWanted = () => setView('wanted');
  const handleNeedLogin = () => setView('login');

  // Settings — both genuinely change playback behavior (see the VideoStage
  // props below), not inert preferences. Autoplay defaults off, preserving
  // the app's original stop-and-show-overlay behavior unless opted into;
  // muted-by-default stays on, since browsers block autoplay-with-sound
  // regardless of this setting. These defaults are what a logged-out
  // viewer sees; a logged-in session's own values (real per-user server
  // state now, same PATCH /users/me profile editing already used, rather
  // than local-only) get hydrated in on top by the session-restore
  // effect and by login/signup, same as userAccount itself.
  const [autoplayNext, setAutoplayNext] = useState(false);
  const [defaultMuted, setDefaultMuted] = useState(true);
  const [privateFollowLists, setPrivateFollowLists] = useState(false);
  const [hideMutualFollowers, setHideMutualFollowers] = useState(false);

  // Drops straight into the full-bleed player with an auto-picked post —
  // there's no browse grid to choose from anymore. First time ever: show
  // the interest picker first, same as before; already onboarded: straight
  // in, no repeated interruption.
  //
  // Guards against an empty pool — genuinely possible now for the brief
  // window before the fetch effect above resolves (never true of the old
  // static mock import), and pickStartingPost's `pool[0]` fallback would
  // otherwise hand back `undefined` for a real VideoPost.
  const openDiscoverPlayer = (interestsForPick: string[] | null) => {
    if (discoverPosts.length === 0) return;
    setDiscoverNav({ items: [pickStartingPost(interestsForPick, discoverPosts)], index: 0 });
    setDiscoverScoped(false);
    setDiscoverBackView('shop');
    setDiscoverPendingDirection(null);
    setCommentsOpen(false);
    setView('discoverPlayer');
  };

  const handleOpenDiscover = () => {
    if (!hasOnboarded) {
      setDiscoverOpen(true);
    } else {
      openDiscoverPlayer(selectedInterests ?? null);
    }
  };

  const handleDiscoverDone = (selected: string[] | null) => {
    complete(selected);
    setDiscoverOpen(false);
    openDiscoverPlayer(selected);
  };

  // Tapping a category label (desktop sidebar or mobile/tablet sheet):
  // straight to its landing page of promo banners, not a product grid yet.
  const handleSelectCategory = (category: Category) => {
    setSelectedCategory(category);
    setView('categoryLanding');
  };

  // Tapping a banner (or one of its carousel thumbnails): the full catalog
  // for just that banner's product pool.
  const handleSelectBanner = (banner: CategoryBanner) => {
    setSelectedBanner(banner);
    setView('categoryCatalog');
  };

  // Clicking the sidebar's deal banner: the same product-tile catalog
  // screen "See more" uses, but aggregated across every banner in that
  // deal's category rather than scoped to just one collection — "20% off
  // Apparel" means the whole category, not one collection within it.
  // Storewide deals (no categoryId) never reach here — DealBanner only
  // makes deals with a real category clickable in the first place.
  const handleSelectDeal = (deal: Deal) => {
    const category = categories.find((c) => c.id === deal.categoryId);
    if (!category) return;
    const products = categoryBanners
      .filter((b) => b.categoryId === category.id)
      .flatMap((b) => b.products);
    setSelectedCategory(category);
    setSelectedBanner({
      id: `deal-${category.id}`,
      categoryId: category.id,
      title: deal.text,
      subtitle: deal.sub,
      products,
    });
    setView('categoryCatalog');
  };

  // "New Arrivals" pill: same idea as a deal click, but flat across every
  // category rather than one — there's no single real category to fall
  // back to on "back," so this uses a synthetic pseudo-category id that
  // the categoryCatalog view's onBack checks for (see below) to skip
  // straight to Shop instead of a landing page that doesn't exist.
  const NEW_ARRIVALS_CATEGORY_ID = 'new-arrivals';

  const handleSelectNewArrivals = () => {
    const products = categoryBanners.flatMap((b) => b.products).filter((p) => p.isNew);
    setSelectedCategory({ id: NEW_ARRIVALS_CATEGORY_ID, name: 'New Arrivals' });
    setSelectedBanner({
      id: 'new-arrivals-banner',
      categoryId: NEW_ARRIVALS_CATEGORY_ID,
      title: 'New Arrivals',
      subtitle: 'Fresh across every category',
      products,
    });
    setView('categoryCatalog');
  };

  // Same two-step pattern as shop: a swipe sets which way we're headed,
  // SwipeStage animates to it, and only once that finishes does the real
  // history update happen (handleDiscoverSwipeSettled) — that's what was
  // previously inline here directly.
  const [discoverPendingDirection, setDiscoverPendingDirection] = useState<
    'next' | 'prev' | null
  >(null);

  // What swiping up would show, computed *before* the swipe happens (not
  // after) so SwipeStage always has a real post to slide toward. Reuses a
  // step already gone back from if there is one; otherwise the same
  // recommendation logic that used to run inline inside handleSwipeNext.
  const upcomingDiscoverPost: VideoPost | undefined = (() => {
    const { items, index } = discoverNav;
    if (index + 1 < items.length) return items[index + 1];
    if (discoverScoped) return undefined; // end of this person's posts
    const current = items[index];
    if (!current) return undefined;
    // Best-first order: videos related to this one, then everything else in
    // the feed (so a narrow interest never dead-ends the scroll).
    const related = getRecommended(current, discoverPosts);
    const relatedIds = new Set(related.map((p) => p.id));
    const rest = discoverPosts.filter((p) => p.id !== current.id && !relatedIds.has(p.id));
    const ordered = [...related, ...rest];
    // Something not watched yet always wins.
    const unseen = ordered.find((p) => !items.some((it) => it.id === p.id));
    if (unseen) return unseen;
    // Everything has been seen: bring back whichever video was watched
    // longest ago. The old fallback always took `related[0]`, which is the
    // same top pick from almost every video, so after a while the scroll
    // bounced between just two videos.
    const lastSeen = (id: string) => {
      for (let i = items.length - 1; i >= 0; i--) if (items[i].id === id) return i;
      return -1;
    };
    return [...ordered].sort((a, b) => lastSeen(a.id) - lastSeen(b.id))[0];
  })();

  const handleSwipeNext = () => {
    if (discoverPendingDirection || !upcomingDiscoverPost) return;
    setDiscoverPendingDirection('next');
  };

  const handleSwipePrev = () => {
    if (discoverPendingDirection || discoverNav.index <= 0) return;
    setDiscoverPendingDirection('prev');
  };

  // Takes `direction` as a parameter rather than reading
  // discoverPendingDirection back out of state: the touch-drag path in
  // SwipeStage never sets that state at all (it tracks its own gesture
  // entirely internally — see its own comment), it only ever calls this:
  // reading state here would miss that path's direction entirely, and
  // even for the wheel path that does set it, calling this synchronously
  // right after setDiscoverPendingDirection would still read the
  // pre-update value, since React batches the two and this closure's
  // `discoverPendingDirection` wouldn't reflect it yet.
  const handleDiscoverSwipeSettled = (direction: 'next' | 'prev') => {
    if (direction === 'next' && upcomingDiscoverPost) {
      setDiscoverNav((prev) => {
        const { items, index } = prev;
        if (index + 1 < items.length) return { items, index: index + 1 };
        return { items: [...items, upcomingDiscoverPost], index: index + 1 };
      });
    } else if (direction === 'prev') {
      setDiscoverNav((prev) => (prev.index > 0 ? { ...prev, index: prev.index - 1 } : prev));
    }
    setDiscoverPendingDirection(null);
    setOverlayVisible(true);
    setCommentsOpen(false);
  };

  // The slide animation is a separate step from the actual index change:
  // a swipe/scroll first sets which way we're headed, SwipeStage animates
  // the current post fully off-screen while the next one slides fully
  // into place, and only once that finishes does the real index update
  // happen (see handleShopSwipeSettled) — so the visible content and the
  // underlying state change in the same instant the motion completes,
  // not before it.
  const [shopPendingDirection, setShopPendingDirection] = useState<'next' | 'prev' | null>(null);

  const handleShopSwipeNext = () => {
    if (shopPendingDirection || shopIndex >= feedPosts.length - 1) return;
    setShopPendingDirection('next');
  };

  const handleShopSwipePrev = () => {
    if (shopPendingDirection || shopIndex <= 0) return;
    setShopPendingDirection('prev');
  };

  // See handleDiscoverSwipeSettled's comment on why `direction` is a
  // parameter here rather than read back from shopPendingDirection.
  const handleShopSwipeSettled = (direction: 'next' | 'prev') => {
    setShopIndex((i) =>
      direction === 'next' ? Math.min(i + 1, feedPosts.length - 1) : Math.max(i - 1, 0),
    );
    setShopPendingDirection(null);
    setOverlayVisible(true);
    setShopSheetOpen(false);
  };

  // Only these two need to check the Autoplay setting — the "next" side
  // of ending, not the swipe handlers themselves (swiping is always
  // manual, regardless of this setting).
  const handleShopVideoEnded = () => {
    if (autoplayNext && shopIndex < feedPosts.length - 1) handleShopSwipeNext();
    else setOverlayVisible(true);
  };

  const handleDiscoverVideoEnded = () => {
    if (autoplayNext) handleSwipeNext();
    else setOverlayVisible(true);
  };

  // Starts as null (no personal account loaded yet), same "starts empty,
  // created once via a form" pattern as merchantAccount just below.
  // Tapping the profile icon before this exists routes to
  // CreateAccountScreen instead of a profile with placeholder info in it.
  //
  // Unlike merchantAccount, this can also get filled in by the session-
  // restore effect right below rather than only by that form — a stored
  // JWT from a previous visit (see lib/api.ts's token storage) means
  // there's a real account to load, not an empty one to create.
  const [userAccount, setUserAccount] = useState<UserProfile | null>(null);

  // Everything scoped to the signed-in account. Shared by the mount-time
  // session restore and by login/signup, since that effect only runs once
  // — without calling this on login too, an existing account signing in
  // mid-session would sit on an empty cart and no order history until a
  // refresh.
  //
  // Each call is independently non-fatal: one failing fetch shouldn't
  // take down a valid session or the other five. The merchant ones 404
  // for buyer-only accounts, which is a normal answer rather than an
  // error — the dashboard simply stays locked behind "create a page".
  const loadAccountState = () => {
    listNotifications()
      .then((rows) => setNotifications(rows.map(apiNotificationToNotification)))
      .catch(() => {});
    listMyWatchlist()
      .then((posts) => setWatchlist(posts.map(apiVideoPostToVideoPost)))
      .catch(() => {});
    listMyLikedPostIds()
      .then((ids) => setLikedPostIds(Object.fromEntries(ids.map((id) => [id, true]))))
      .catch(() => {});
    listMySharedPostIds()
      .then((ids) => setSharedPostIds(Object.fromEntries(ids.map((id) => [id, true]))))
      .catch(() => {});
    listMyRepostPostIds()
      .then((ids) => setRepostedPostIds(Object.fromEntries(ids.map((id) => [id, true]))))
      .catch(() => {});
    listMyVideoPosts('discover')
      .then((posts) => setMyDiscoverPosts(posts.map(apiVideoPostToVideoPost)))
      .catch(() => {});
    listMyVideoPosts('shop')
      .then((posts) => setMyShopPosts(posts.map(apiVideoPostToVideoPost)))
      .catch(() => {});
    listCart()
      .then((items) => setCartItems(items.map(apiCartItemToCartItem)))
      .catch(() => {});
    listMyOrders()
      .then((placed) => setOrders(placed.map(apiOrderToOrder)))
      .catch(() => {});
    getMyMerchantAccount()
      .then((account) => {
        setMerchantAccount(apiMerchantAccountToMerchantAccount(account));
        listMyMerchantProducts()
          .then((products) => setMerchantProducts(products.map(apiProductToProduct)))
          .catch(() => {});
        listSellingOrders()
          .then((selling) => setSellingOrders(selling.map(apiOrderToOrder)))
          .catch(() => {});
      })
      .catch(() => {});
  };

  useEffect(() => {
    if (!getToken()) return;
    getMe()
      .then((user) => {
        setUserAccount(apiUserToProfile(user));
        setAutoplayNext(user.autoplay_next);
        setDefaultMuted(user.default_muted);
        setPrivateFollowLists(user.private_follow_lists);
        setHideMutualFollowers(user.hide_mutual_followers);
        if (!user.is_active) {
          // Same reasoning as handleCreateAccount's own check — a
          // restored session for a since-banned account has nothing
          // else worth loading, and shouldn't silently sit on the shop
          // feed as if nothing happened.
          setView('suspended');
          return;
        }
        loadAccountState();
      })
      .catch(() => clearToken()); // token expired/invalid — back to logged-out
  }, []);

  const handleOpenProfile = () => setView(userAccount ? 'profile' : 'login');

  // Shared by signup and login — see loadAccountState above for why this
  // has to happen here as well as in the session-restore effect.
  const handleCreateAccount = (profile: UserProfile) => {
    setUserAccount(profile);
    setAutoplayNext(profile.autoplayNext);
    setDefaultMuted(profile.defaultMuted);
    setPrivateFollowLists(profile.privateFollowLists);
    setHideMutualFollowers(profile.hideMutualFollowers);
    if (!profile.isActive) {
      // Suspended — nothing else on the account (cart, orders,
      // watchlist, notifications) is reachable anyway once
      // get_current_active_user starts rejecting this session, so
      // there's nothing loadAccountState below would actually get back
      // besides a pile of caught 403s. SuspensionScreen is the only
      // place this session goes until an appeal changes that.
      setView('suspended');
      return;
    }
    loadAccountState();
    setView('profile');
  };

  // ProfileScreen's Edit profile form — a real PATCH now, not just local
  // state. Returns the promise (rather than swallowing it) so the caller
  // can show its own inline error and stay in edit mode on failure,
  // rather than this silently reverting text someone just typed the way
  // the optimistic toggles elsewhere in this file do; a save the person
  // explicitly submitted needs to either visibly succeed or visibly fail,
  // not vanish either way.
  const handleSaveProfile = (displayName: string, bio: string) =>
    updateMe({ display_name: displayName, bio }).then((user) => {
      setUserAccount(apiUserToProfile(user));
    });

  // ProfileScreen's own AvatarPicker uploads the file (uploadFile, same
  // presigned-R2 flow every other image/video upload in this app goes
  // through) before ever calling this — by the time it's here, `url` is
  // either a real, already-hosted image or explicitly null to clear the
  // photo back to the placeholder, never a local blob: URL.
  const handleChangeAvatar = (url: string | null) =>
    updateMe({ avatar_url: url }).then((user) => {
      setUserAccount(apiUserToProfile(user));
    });

  // Optimistic, same as the autoplay/mute toggles below rather than
  // handleSaveProfile's explicit-success-or-failure shape — a date
  // picker firing on every change is closer to a toggle than a form
  // submission someone's actively watching for a result.
  const handleChangeBirthday = (birthday: string) => {
    if (!userAccount) return;
    const previous = userAccount.birthday;
    setUserAccount({ ...userAccount, birthday });
    updateMe({ birthday }).catch(() => setUserAccount((prev) => (prev ? { ...prev, birthday: previous } : prev)));
  };

  // Shown on LoginScreen only when handleLogOut below was triggered by
  // an expired/invalid token rather than someone tapping "Log out"
  // themselves — see setUnauthorizedHandler's own comment in lib/api.ts
  // for why that can happen well into an otherwise-normal session.
  const [sessionExpiredNotice, setSessionExpiredNotice] = useState(false);

  const handleLogOut = (reason?: 'expired') => {
    clearToken();
    setUserAccount(null);
    // Tied to whoever was just logged in — the next visitor (or the same
    // person logged back out) shouldn't see someone else's saved posts,
    // cart lines, order history, merchant dashboard, or settings.
    setWatchlist([]);
    setMyDiscoverPosts([]);
    setMyShopPosts([]);
    setViewedPosterPosts({});
    setCartItems([]);
    setOrders([]);
    setMerchantAccount(null);
    setMerchantProducts([]);
    setSellingOrders([]);
    setAutoplayNext(false);
    setDefaultMuted(true);
    setPrivateFollowLists(false);
    setHideMutualFollowers(false);
    if (reason === 'expired') {
      setSessionExpiredNotice(true);
      setView('login');
    } else {
      setView('shop');
    }
  };

  // Registered once — lib/api.ts calls this the moment any authenticated
  // request comes back 401, from wherever in the app that happened to be.
  // handleLogOut only ever reads from stable setState functions and
  // clearToken/setView, so capturing this one render's copy of it is
  // safe to keep using for the lifetime of the app; it doesn't need to
  // be re-registered on every render the way the exhaustive-deps rule
  // would otherwise ask for.
  useEffect(() => {
    setUnauthorizedHandler(() => handleLogOut('expired'));
    return () => setUnauthorizedHandler(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The company pages (About, Help & contact, Community guidelines, Terms, Privacy Policy):
  // opened from Settings > Support & About, and the privacy policy also from sign-up.
  const [legalDoc, setLegalDoc] = useState<LegalDocId>('about');
  const [legalBackView, setLegalBackView] = useState<'settings' | 'createAccount'>('settings');
  const handleOpenLegal = (doc: LegalDocId, back: 'settings' | 'createAccount' = 'settings') => {
    setLegalDoc(doc);
    setLegalBackView(back);
    setView('legal');
  };
  const [settingsBackView, setSettingsBackView] = useState<'shop' | 'discoverPlayer' | 'profile'>('profile');
  const handleOpenSettings = (origin: 'shop' | 'discoverPlayer' | 'profile' = 'profile') => {
    setSettingsBackView(origin);
    setView('settings');
  };
  const handleOpenWatchlist = () => setView('watchlist');
  const handleOpenCart = () => setView('cart');
  const handleOpenNotifications = () => setView('notifications');
  // Real per-user server state now when there's an account to attach it
  // to (same PATCH /users/me profile editing already used) — but unlike
  // handleToggleSave/handleToggleLike, a logged-out tap doesn't redirect
  // to sign up first. These aren't an auth-gated action, just a
  // preference that also happens to sync when there's somewhere to sync
  // it to; an anonymous viewer can still flip them for the session, same
  // as before this was ever persisted anywhere.
  const handleToggleAutoplayNext = () => {
    const next = !autoplayNext;
    setAutoplayNext(next);
    if (!getToken()) return;
    updateMe({ autoplay_next: next }).catch(() => setAutoplayNext(!next));
  };

  const handleToggleDefaultMuted = () => {
    const next = !defaultMuted;
    setDefaultMuted(next);
    if (!getToken()) return;
    updateMe({ default_muted: next }).catch(() => setDefaultMuted(!next));
  };

  // Same optimistic/sync-if-there's-somewhere-to-sync-it shape as the
  // two toggles just above, but this one only actually means anything
  // once there's a real account behind it (an anonymous session has no
  // followers/following list of its own to hide) — SettingsScreen is
  // reachable without one, so this just never does anything useful in
  // that case rather than needing its own separate gate.
  const handleTogglePrivateFollowLists = () => {
    const next = !privateFollowLists;
    setPrivateFollowLists(next);
    if (!getToken()) return;
    updateMe({ private_follow_lists: next }).catch(() => setPrivateFollowLists(!next));
  };

  // Same shape as handleTogglePrivateFollowLists just above, for the
  // narrower "just hide the mutual-followers comparison, not the whole
  // followers/following lists" setting.
  const handleToggleHideMutualFollowers = () => {
    const next = !hideMutualFollowers;
    setHideMutualFollowers(next);
    if (!getToken()) return;
    updateMe({ hide_mutual_followers: next }).catch(() => setHideMutualFollowers(!next));
  };

  // One merchant page per personal account (the agreed v1 scope) — the
  // backend enforces that with a unique constraint on user_id, so a
  // second attempt comes back as a 400 rather than silently creating
  // another. Loaded by the session-restore effect for anyone who already
  // has one; a 404 there just means this account is buyer-only.
  const [merchantAccount, setMerchantAccount] = useState<MerchantAccount | null>(null);

  const handleCreateMerchant = (account: MerchantAccount) => {
    apiCreateMerchantAccount({
      business_name: account.businessName,
      category: account.category,
      description: account.description,
    })
      .then((created) => {
        // MerchantCreate builds a draft with a placeholder id; the real
        // one from the server is what replaces it here.
        setMerchantAccount(apiMerchantAccountToMerchantAccount(created));
        setView('merchantDashboard');
      })
      .catch(() => {});
  };

  // Never optimistic — MerchantPayouts needs the real outcome (Paystack
  // either verified the account or it didn't) to show a specific error
  // or flip into its "payouts are set up" state, not a guess that might
  // have to be quietly reverted.
  const handleAddMerchantPayout = (bankCode: string, accountNumber: string): Promise<void> =>
    apiAddMerchantPayout(bankCode, accountNumber).then((updated) => {
      setMerchantAccount(apiMerchantAccountToMerchantAccount(updated));
    });

  // Posts management — same state the shop feed reads from (see the
  // `shopPosts` declaration above). Deleting resets back to the first post
  // rather than trying to preserve the current swipe position, since the
  // post you were looking at might be the one that just got removed.
  //
  // MerchantPosts builds a draft VideoPost with a placeholder id and the
  // full Product objects it selected; the API takes product_ids and
  // assigns the real id, so the server's response replaces the draft
  // rather than being merged into it.
  // What the merchant dashboard's Posts tab shows: ONLY this signed-in
  // account's own shop posts (their uploads, plus reposts they made).
  // Built from two sources and de-duplicated, so it stays correct even if
  // GET /video-posts/mine?feed=shop is slow, fails, or hasn't been
  // deployed on the backend yet:
  //   1. myShopPosts — the dedicated per-account fetch.
  //   2. shopPosts filtered by ownership — anything in the public shop
  //      feed that is genuinely this account's.
  // Ownership of a feed entry: a repost belongs to whoever reposted it
  // (repostedBy), everything else to its poster. Never falls back to
  // "show the whole shop feed" — an unknown/signed-out account gets [].
  const myAccountId = userAccount?.id;
  const merchantOwnPosts: VideoPost[] = (() => {
    if (!myAccountId) return [];
    const isMine = (p: VideoPost) => (p.repostedBy ? p.repostedBy.id === myAccountId : p.posterId === myAccountId);
    const seen = new Set<string>();
    const out: VideoPost[] = [];
    for (const p of [...myShopPosts, ...shopPosts.filter(isMine)]) {
      const key = p.repostId ?? p.id;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(p);
    }
    return out;
  })();

  const handleAddShopPost = (post: VideoPost) => {
    apiCreateVideoPost({
      feed: 'shop',
      description: post.description,
      video_url: post.videoUrl,
      thumbnail_url: post.thumbnailUrl,
      width: post.width,
      height: post.height,
      product_ids: (post.products ?? []).map((p) => p.id),
      twins: (post.twins ?? []).map((t) => ({ product_id: t.productId, label: t.label, start_ms: t.startMs, end_ms: t.endMs })),
    })
      .then((created) => {
        const mapped = apiVideoPostToVideoPost(created);
        setShopPosts((prev) => [mapped, ...prev]);
        setMyShopPosts((prev) => [mapped, ...prev]);
        setShopIndex(0);
      })
      .catch(() => {});
  };

  const handleUpdateShopPost = (post: VideoPost) => {
    apiUpdateVideoPost(post.id, {
      description: post.description,
      video_url: post.videoUrl,
      thumbnail_url: post.thumbnailUrl,
      width: post.width,
      height: post.height,
      product_ids: (post.products ?? []).map((p) => p.id),
      twins: (post.twins ?? []).map((t) => ({ product_id: t.productId, label: t.label, start_ms: t.startMs, end_ms: t.endMs })),
      ...(post.retwinKind === 'video' ? { sync_offset_ms: post.syncOffsetMs ?? 0 } : {}),
    })
      .then((updated) => {
        const mapped = apiVideoPostToVideoPost(updated);
        setShopPosts((prev) => prev.map((p) => (p.id === post.id ? mapped : p)));
        setMyShopPosts((prev) => prev.map((p) => (p.id === post.id ? mapped : p)));
      })
      .catch(() => {});
  };

  const handleDeleteShopPost = (post: VideoPost) => {
    const targetId = post.repostId ?? post.id;
    const snapshot = shopPosts;
    const mineSnapshot = myShopPosts;
    setShopPosts((prev) => prev.filter((p) => (p.repostId ?? p.id) !== targetId));
    setMyShopPosts((prev) => prev.filter((p) => (p.repostId ?? p.id) !== targetId));
    setShopIndex(0);
    apiDeleteVideoPost(targetId).catch(() => {
      setShopPosts(snapshot);
      setMyShopPosts(mineSnapshot);
    });
  };

  // Personal-account equivalent of handleAddShopPost — a regular user
  // posting from their own profile lands in Discover, the same way a
  // merchant posting from their dashboard lands in the shop feed. No
  // products field gets attached here at all, which is what keeps this
  // content out of any shopping UI regardless of what VideoStage mode
  // it's viewed in.
  const handleAddDiscoverPost = (post: VideoPost) => {
    apiCreateVideoPost({
      feed: 'discover',
      description: post.description,
      video_url: post.videoUrl,
      thumbnail_url: post.thumbnailUrl,
      width: post.width,
      height: post.height,
      interest_ids: post.interestIds ?? [],
    })
      .then((created) => {
        const mapped = apiVideoPostToVideoPost(created);
        setDiscoverPosts((prev) => [mapped, ...prev]);
        setMyDiscoverPosts((prev) => [mapped, ...prev]);
      })
      .catch(() => {});
  };

  // The row this specific feed entry actually is, for both "which id do
  // I delete" and "which entries does removing it match" — a repost's
  // own `id` is the ORIGINAL post's id (content stays attributed to
  // whoever made it; see _resolve_video_post_for_read's own comment),
  // so `id` alone can't tell a repost apart from the original it's
  // showing. `repostId`, when set, is this row's real identity.
  const videoPostRowKey = (post: VideoPost) => post.repostId ?? post.id;

  const handleDeleteDiscoverPost = (post: VideoPost) => {
    const targetId = videoPostRowKey(post);
    const discoverSnapshot = discoverPosts;
    const mineSnapshot = myDiscoverPosts;
    setDiscoverPosts((prev) => prev.filter((p) => videoPostRowKey(p) !== targetId));
    setMyDiscoverPosts((prev) => prev.filter((p) => videoPostRowKey(p) !== targetId));
    apiDeleteVideoPost(targetId).catch(() => {
      setDiscoverPosts(discoverSnapshot);
      setMyDiscoverPosts(mineSnapshot);
    });
  };

  // Lifted so a comment survives swiping away from a video and back to it
  // later in the same session — see the explanation in CommentsPanel for
  // why a local useState there couldn't do that.
  //
  // Posting is a real, authenticated write now (POST /video-posts/{id}/
  // comments) — this is exactly the "business logic as a filter" case
  // from the backend's own comment on that route: a logged-out tap can't
  // reach the endpoint at all, so it's routed to sign up instead of
  // firing a request that the server would just reject. Shown optimistic
  // with a temporary id, then reconciled with the server's real comment
  // (real id, real author name) once the request resolves — or rolled
  // back if it fails, same shape as handleToggleSave below.
  // Auto-expands the thread a reply just landed in — otherwise a reply
  // posted to a collapsed thread sits behind "View N replies" and reads
  // as "my reply didn't show up." Facebook expands the thread you just
  // replied to for the same reason. Keyed by the *root* comment id,
  // same id CommentsPanel's own groupThreads groups replies under.
  const [expandedCommentThreads, setExpandedCommentThreads] = useState<Record<string, boolean>>({});

  const handleAddComment = (postId: string, text: string, parentId?: string) => {
    if (!getToken()) {
      setView('login');
      return;
    }
    const tempId = `pending-${Date.now()}`;
    // A reply typed while replying to a *reply* still needs to be filed
    // under that reply's own top-level parent (threads stay one level
    // deep) — mirrors what add_comment does server-side. Look the
    // target comment up in the same list this optimistic entry is about
    // to be inserted into.
    const existing = discoverComments[postId] ?? [];
    const target = parentId ? existing.find((c) => c.id === parentId) : undefined;
    const rootParentId = target?.parentId ?? parentId;
    const replyToName = target?.parentId ? target.author : undefined;
    const replyToUserId = target?.parentId ? target.authorId : undefined;

    setDiscoverComments((prev) => ({
      ...prev,
      [postId]: [
        {
          id: tempId,
          author: userAccount?.displayName ?? 'You',
          authorId: userAccount?.id,
          authorAvatarUrl: userAccount?.avatarUrl,
          text,
          likes: 0,
          parentId: rootParentId,
          replyToName,
          replyToUserId,
          createdAt: new Date().toISOString(),
          pending: true,
        },
        ...existing,
      ],
    }));
    if (rootParentId) {
      setExpandedCommentThreads((prev) => ({ ...prev, [rootParentId]: true }));
    }
    apiAddComment(postId, text, parentId)
      .then((comment) => {
        setDiscoverComments((prev) => ({
          ...prev,
          [postId]: (prev[postId] ?? []).map((c) => (c.id === tempId ? apiCommentToComment(comment) : c)),
        }));
      })
      .catch(() => {
        setDiscoverComments((prev) => ({
          ...prev,
          [postId]: (prev[postId] ?? []).filter((c) => c.id !== tempId),
        }));
      });
  };

  // Same optimistic-then-reconcile shape as handleToggleLike (the post-
  // level version) below, one level down — flip the one comment's
  // likedByMe/likes in place across every post's thread (a comment id
  // is unique regardless of which post it's under, so no need to know
  // which key of discoverComments it lives in), then roll back on
  // failure. Auth-gated the same way handleToggleLike is (redirect to
  // sign up rather than firing a request the server would reject) —
  // unlike handleAddComment, a comment thread can be full of *other*
  // people's seeded/fetched comments that a logged-out viewer can
  // reach the Like button on, so this can't lean on posting having
  // already checked getToken() first.
  const setCommentLikeState = (commentId: string, likedByMe: boolean, likeDelta: number) => {
    setDiscoverComments((prev) => {
      const next: typeof prev = {};
      for (const [postId, list] of Object.entries(prev)) {
        next[postId] = list.map((c) =>
          c.id === commentId ? { ...c, likedByMe, likes: Math.max(0, c.likes + likeDelta) } : c,
        );
      }
      return next;
    });
  };

  const handleLikeComment = (commentId: string) => {
    if (!getToken()) {
      setView('login');
      return;
    }
    setCommentLikeState(commentId, true, 1);
    apiLikeComment(commentId).catch(() => setCommentLikeState(commentId, false, -1));
  };

  const handleUnlikeComment = (commentId: string) => {
    if (!getToken()) {
      setView('login');
      return;
    }
    setCommentLikeState(commentId, false, -1);
    apiUnlikeComment(commentId).catch(() => setCommentLikeState(commentId, true, 1));
  };

  // Applies a reaction change to one comment id across every post's
  // thread — same "a comment id is unique regardless of which post it's
  // under" reasoning setCommentLikeState above uses. `likes` (the total
  // reaction count shown everywhere) moves by however many reactions
  // were added/removed net (0 when just switching from one reaction to
  // another).
  const applyCommentReaction = (
    commentId: string,
    reaction: ReactionType | null,
    prevReaction: ReactionType | null | undefined,
  ) => {
    setDiscoverComments((prev) => {
      const next: typeof prev = {};
      for (const [postId, list] of Object.entries(prev)) {
        next[postId] = list.map((c) => {
          if (c.id !== commentId) return c;
          const counts = { ...(c.reactionCounts ?? {}) };
          if (prevReaction) counts[prevReaction] = Math.max(0, (counts[prevReaction] ?? 0) - 1);
          if (reaction) counts[reaction] = (counts[reaction] ?? 0) + 1;
          const delta = (reaction ? 1 : 0) - (prevReaction ? 1 : 0);
          return {
            ...c,
            myReaction: reaction,
            likedByMe: !!reaction,
            reactionCounts: counts,
            likes: Math.max(0, c.likes + delta),
          };
        });
      }
      return next;
    });
  };

  // Facebook-style single reaction per person per comment — picking a
  // new one (via long-press/hover on the Like button in CommentsPanel)
  // replaces whichever one was already there; tapping the same reaction
  // again clears it. Optimistic with rollback, same shape as every
  // other like-style action in this file.
  const handleReactToComment = (comment: Comment, reaction: ReactionType) => {
    if (!getToken()) {
      setView('login');
      return;
    }
    const prevReaction = comment.myReaction ?? null;
    if (prevReaction === reaction) {
      applyCommentReaction(comment.id, null, prevReaction);
      apiRemoveCommentReaction(comment.id).catch(() => applyCommentReaction(comment.id, prevReaction, null));
      return;
    }
    applyCommentReaction(comment.id, reaction, prevReaction);
    apiReactToComment(comment.id, reaction).catch(() => applyCommentReaction(comment.id, prevReaction, reaction));
  };

  const handleRemoveCommentReaction = (comment: Comment) => {
    if (!getToken()) {
      setView('login');
      return;
    }
    const prevReaction = comment.myReaction ?? null;
    if (!prevReaction) return;
    applyCommentReaction(comment.id, null, prevReaction);
    apiRemoveCommentReaction(comment.id).catch(() => applyCommentReaction(comment.id, prevReaction, null));
  };

  // Who reacted — the sheet opened by tapping the reaction summary
  // under a comment. Fetched on demand (not carried on every comment
  // object) since it's only ever needed for a thread that's already
  // open, same reasoning the backend route's own comment gives.
  const [commentReactors, setCommentReactors] = useState<CommentReactor[]>([]);
  const [commentReactorsLoading, setCommentReactorsLoading] = useState(false);
  const [commentReactorsFor, setCommentReactorsFor] = useState<string | null>(null);

  const handleShowCommentReactors = (commentId: string) => {
    setCommentReactorsFor(commentId);
    setCommentReactorsLoading(true);
    apiListCommentReactors(commentId)
      .then((rows) => setCommentReactors(rows.map(apiReactorToCommentReactor)))
      .catch(() => setCommentReactors([]))
      .finally(() => setCommentReactorsLoading(false));
  };

  const handleCloseCommentReactors = () => {
    setCommentReactorsFor(null);
    setCommentReactors([]);
  };

  // Pin/unpin — post owner only (enforced server-side too). Only one
  // pinned comment per post, so pinning a different one moves the pin;
  // reflected here by clearing isPinned on every other comment in that
  // post's thread at the same time it's set on the new one.
  const handlePinComment = (postId: string, commentId: string) => {
    setDiscoverComments((prev) => ({
      ...prev,
      [postId]: (prev[postId] ?? []).map((c) => ({ ...c, isPinned: c.id === commentId })),
    }));
    apiPinComment(commentId).catch(() => {
      setDiscoverComments((prev) => ({
        ...prev,
        [postId]: (prev[postId] ?? []).map((c) => ({ ...c, isPinned: false })),
      }));
    });
  };

  const handleUnpinComment = (postId: string, commentId: string) => {
    setDiscoverComments((prev) => ({
      ...prev,
      [postId]: (prev[postId] ?? []).map((c) => (c.id === commentId ? { ...c, isPinned: false } : c)),
    }));
    apiUnpinComment(commentId).catch(() => {
      setDiscoverComments((prev) => ({
        ...prev,
        [postId]: (prev[postId] ?? []).map((c) => (c.id === commentId ? { ...c, isPinned: true } : c)),
      }));
    });
  };

  // Unlike setCommentLikeState above, there's no cheap "flip it back"
  // for arbitrary edited text, so this snapshots the whole map up front
  // and restores it wholesale on failure instead.
  const handleEditComment = (commentId: string, text: string) => {
    if (!getToken()) {
      setView('login');
      return;
    }
    const snapshot = discoverComments;
    setDiscoverComments((prev) => {
      const next: typeof prev = {};
      for (const [postId, list] of Object.entries(prev)) {
        next[postId] = list.map((c) => (c.id === commentId ? { ...c, text, isEdited: true } : c));
      }
      return next;
    });
    apiEditComment(commentId, text).catch(() => setDiscoverComments(snapshot));
  };

  // Deleting a top-level comment also deletes every reply under it
  // server-side (cascade — see the Comment model's own comment on
  // replies_count/comments_count), so the optimistic removal here drops
  // anything whose parentId points at the deleted comment too, not just
  // the comment itself.
  const handleDeleteComment = (commentId: string) => {
    if (!getToken()) {
      setView('login');
      return;
    }
    const snapshot = discoverComments;
    setDiscoverComments((prev) => {
      const next: typeof prev = {};
      for (const [postId, list] of Object.entries(prev)) {
        next[postId] = list.filter((c) => c.id !== commentId && c.parentId !== commentId);
      }
      return next;
    });
    apiDeleteComment(commentId).catch(() => setDiscoverComments(snapshot));
  };

  // Orders the signed-in person has placed as a buyer — GET /orders/me.
  // `buyerName` is whatever the server snapshotted from the real account
  // at purchase time, not a name picked at random.
  const [orders, setOrders] = useState<Order[]>([]);

  // The merchant's fulfillment queue — GET /orders/selling: every order
  // placed against this merchant's products, whoever bought them. A
  // genuinely different set from `orders` above, which is why the
  // dashboard no longer reads that one: your own purchases and the orders
  // you owe other people are only the same list in a single-account demo.
  const [sellingOrders, setSellingOrders] = useState<Order[]>([]);

  // Same Paystack flow as handleCheckout above, just for a single
  // product/variant instead of the whole cart — initialize, pop up the
  // card, then verify creates exactly one Order once the charge is
  // actually confirmed.
  const handleBuyNow = (
    product: Product,
    color: string,
    size: string,
    discountCode?: string,
    trackActivity = false,
  ) => {
    if (!getToken()) {
      setView('login');
      return;
    }
    if (!userAccount?.shippingAddress) {
      handleOpenShippingAddress('shop');
      return;
    }
    initializeBuyNowPayment({
      product_id: product.id,
      color,
      size,
      shipping_address: addressToApiShippingAddress(userAccount.shippingAddress),
      discount_code: discountCode,
      source_video_post_id: trackActivity ? activeShopPost?.id : undefined,
    })
      .then((init) =>
        openPaystackCheckout({
          publicKey: init.public_key,
          email: init.email,
          amountSubunit: init.amount_subunit,
          currency: init.currency,
          reference: init.reference,
        }).then(() => apiVerifyPayment(init.reference)),
      )
      .then((created) => {
        const order = created[0];
        if (!order) return;
        setOrders((prev) => [apiOrderToOrder(order), ...prev]);
        if (trackActivity) bumpProductActivity(product.id, 1);
      })
      .catch(() => {});
  };

  // Passed to the shop video feed's ProductDrawer specifically — same
  // handler, just with tracking switched on.
  const handleBuyNowFromShopFeed = (product: Product, color: string, size: string, discountCode?: string) =>
    handleBuyNow(product, color, size, discountCode, true);

  // Merchant-only, and only for orders against this merchant's own
  // products — the backend re-checks both. Optimistic with rollback: the
  // row already exists and only its status moves.
  const handleAdvanceOrderStatus = (id: string, status: Order['status']) => {
    const snapshot = sellingOrders;
    setSellingOrders((prev) => prev.map((o) => (o.id === id ? { ...o, status } : o)));
    apiAdvanceOrderStatus(id, status).catch(() => setSellingOrders(snapshot));
  };

  // Either the buyer or the selling merchant can cancel — same backend
  // route either way (it figures out which one you are), so this just
  // updates whichever of orders/sellingOrders actually contains this id;
  // the other list's .map is a harmless no-op since it won't find a
  // match. Optimistic with rollback, same as handleAdvanceOrderStatus
  // above — reverts both lists together on failure since only one of
  // them will have actually changed anyway.
  const handleCancelOrder = (id: string, reason?: string) => {
    const ordersSnapshot = orders;
    const sellingSnapshot = sellingOrders;
    const applyCancel = (list: Order[]) =>
      list.map((o) => (o.id === id ? { ...o, status: 'cancelled' as const, cancelReason: reason } : o));
    setOrders(applyCancel);
    setSellingOrders(applyCancel);
    apiCancelOrder(id, reason).catch(() => {
      setOrders(ordersSnapshot);
      setSellingOrders(sellingSnapshot);
    });
  };

  const handleConfirmReceipt = (id: string) => {
    const snapshot = orders;
    setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, payoutStatus: 'released' as const } : o)));
    apiConfirmReceipt(id).catch(() => setOrders(snapshot));
  };

  // Never optimistic, unlike the two handlers above — a defect claim
  // either succeeds (money actually moves) or it doesn't, and
  // MyOrdersScreen needs the real error message on failure (the 24-hour
  // window closing mid-recording is a real case, not just network
  // flakiness) rather than a silent rollback.
  const handleReportDefect = (id: string, videoUrl: string, reason?: string): Promise<void> =>
    apiReportDefect(id, videoUrl, reason).then((updated) => {
      setOrders((prev) => prev.map((o) => (o.id === id ? apiOrderToOrder(updated) : o)));
    });

  // Products the merchant lists via the dashboard's Products tab — step
  // one of the required sequence, and what the Posts tab picks from when
  // making a video. Loaded from GET /merchant/products (owner-scoped) by
  // the session-restore effect.
  //
  // These no longer have to be merged into the consumer catalog by hand:
  // a merchant product carries a banner_id, so it already comes back in
  // the public GET /products that builds `categoryBanners` above. Listing
  // one here genuinely does make it appear when you go browse that
  // category, without this screen stitching the two together.
  const [merchantProducts, setMerchantProducts] = useState<Product[]>([]);

  const handleAddMerchantProduct = (product: Product) => {
    apiAddMerchantProduct({
      name: product.name,
      price: product.price,
      description: product.description,
      colors: product.colors,
      sizes: product.sizes,
      is_new: product.isNew,
      banner_id: product.bannerId,
      image_urls: product.images ?? [],
      stock_quantity: product.stockQuantity ?? null,
      discount_percent: product.discountPercent ?? null,
    })
      .then((created) => {
        // The server's row replaces the locally-built one wholesale —
        // MerchantProducts builds a draft with a placeholder id, and
        // that id is what every later PATCH/DELETE has to target.
        setMerchantProducts((prev) => [apiProductToProduct(created), ...prev]);
        refreshCatalog();
      })
      .catch(() => {});
  };

  const handleUpdateMerchantProduct = (product: Product) => {
    apiUpdateMerchantProduct(product.id, {
      name: product.name,
      price: product.price,
      description: product.description,
      colors: product.colors,
      sizes: product.sizes,
      is_new: product.isNew,
      banner_id: product.bannerId,
      image_urls: product.images ?? [],
      stock_quantity: product.stockQuantity ?? null,
      discount_percent: product.discountPercent ?? null,
    })
      .then((updated) => {
        setMerchantProducts((prev) => prev.map((p) => (p.id === product.id ? apiProductToProduct(updated) : p)));
        refreshCatalog();
      })
      .catch(() => {});
  };

  const handleDeleteMerchantProduct = (id: string) => {
    const snapshot = merchantProducts;
    setMerchantProducts((prev) => prev.filter((p) => p.id !== id));
    apiDeleteMerchantProduct(id)
      .then(refreshCatalog)
      .catch(() => setMerchantProducts(snapshot));
  };

  // Builds one shop VideoStage instance with the props every copy shares.
  // `interactive` is what actually differs between them: only the
  // currently-settled post should respond to swipe/scroll — the next/prev
  // copies rendered alongside it during a transition are purely visual
  // until they become current themselves.
  // Shared by both render helpers below and by PosterProfileScreen further
  // down — undefined means "don't show a Follow button here" rather than
  // "show one that does nothing," covering both real cases that mean
  // that: no real posterId to target (mock/fallback content), or it's
  // the viewer's own post/profile (following yourself isn't a thing the
  // backend allows either — see users.py's 400 on that).
  const followPropsFor = (posterId: string | undefined) => {
    if (!posterId || posterId === userAccount?.id) {
      return { isFollowing: false, onToggleFollow: undefined };
    }
    return {
      isFollowing: followedPosterIds[posterId] ?? false,
      onToggleFollow: () => handleToggleFollow(posterId),
    };
  };

  // Same shape as followPropsFor just above, for the Repost button in
  // ShareSheet.tsx (via VideoStage's canRepost/isReposted/onRepost) —
  // canRepost is a plain required boolean rather than an
  // undefined-hides-it prop like onToggleFollow, since ShareSheet just
  // wraps its Repost button in `{canRepost && (...)}` either way.
  const repostPropsFor = (post: VideoPost) => ({
    canRepost: !!post.posterId && post.posterId !== userAccount?.id,
    isReposted: repostedPostIds[post.id] ?? false,
    onRepost: () => handleToggleRepost(post),
  });

  // Same undefined-when-there's-no-real-account convention as
  // followPropsFor just above, for the Followers/Following labels on
  // PosterProfileScreen.
  const followListPropsFor = (posterId: string | undefined, posterName: string) => {
    if (!posterId) {
      return { onOpenFollowers: undefined, onOpenFollowing: undefined, onOpenMutualFollowers: undefined };
    }
    return {
      onOpenFollowers: () => handleOpenPeopleList(posterId, 'followers', posterName, 'posterProfile'),
      onOpenFollowing: () => handleOpenPeopleList(posterId, 'following', posterName, 'posterProfile'),
      onOpenMutualFollowers: () => handleOpenPeopleList(posterId, 'mutual', posterName, 'posterProfile'),
    };
  };

  const renderShopVideoStage = (p: VideoPost, interactive: boolean) => (
    <VideoStage
      key={p.id}
      post={p}
      standby={!interactive}
      mode="shop"
      overlayVisible={overlayVisible}
      onToggleOverlay={() => setOverlayVisible((v) => !v)}
      onVideoEnded={interactive ? handleShopVideoEnded : () => {}}
      onSwipeNext={interactive ? handleShopSwipeNext : undefined}
      onSwipePrev={interactive ? handleShopSwipePrev : undefined}
      // High-water mark: only ever grows, so the "Shop this video" pill
      // stays at one fixed height across videos (see ProductDrawer).
      onCaptionHeightChange={interactive ? (h: number) => setShopCaptionHeight((prev) => Math.max(prev, h)) : undefined}
      onDescExpandedChange={interactive ? setShopDescExpanded : undefined}
      onBack={shopScope ? handleShopGalleryBack : undefined}
      onOpenProfile={handleOpenProfile}
      onViewPoster={handleViewPoster}
      onOpenSettings={() => handleOpenSettings('shop')}
      onOpenWatchlist={handleOpenWatchlist}
      onOpenCart={handleOpenCart}
      onOpenNotifications={handleOpenNotifications}
      onOpenSearch={handleOpenSearch}
      onOpenWanted={TWIN_ENABLED ? handleOpenWanted : undefined}
      notifications={notifications}
      unreadNotificationCount={unreadNotificationCount}
      isSaved={watchlist.some((w) => w.id === p.id)}
      onToggleSave={() => handleToggleSave(p)}
      isLiked={likedPostIds[p.id] ?? false}
      onToggleLike={() => handleToggleLike(p)}
      onOpenLikers={() => handleOpenPeopleList(p.id, 'likes', p.posterName, 'shop')}
      isShared={sharedPostIds[p.id] ?? false}
      onToggleShare={() => handleToggleShare(p)}
      defaultMuted={defaultMuted}
      {...followPropsFor(p.posterId)}
      {...repostPropsFor(p)}
    />
  );

  // Same idea as renderShopVideoStage, for discover mode's extra props
  // (back button instead of category pills, comments instead of a badge).
  const renderDiscoverVideoStage = (p: VideoPost, interactive: boolean) => (
    <VideoStage
      key={p.id}
      post={p}
      standby={!interactive}
      mode="discover"
      onBack={handleDiscoverBack}
      onVisualSearch={TWIN_ENABLED && interactive ? () => handleOpenTwinSearch(p) : undefined}
      overlayVisible={overlayVisible}
      onToggleOverlay={() => setOverlayVisible((v) => !v)}
      onVideoEnded={interactive ? handleDiscoverVideoEnded : () => {}}
      onSwipeNext={interactive ? handleSwipeNext : undefined}
      onSwipePrev={interactive ? handleSwipePrev : undefined}
      onOpenComments={interactive ? () => setCommentsOpen(true) : undefined}
      onOpenProfile={handleOpenProfile}
      onViewPoster={handleViewPoster}
      onOpenSettings={() => handleOpenSettings('discoverPlayer')}
      onOpenWatchlist={handleOpenWatchlist}
      onOpenCart={handleOpenCart}
      onOpenNotifications={handleOpenNotifications}
      onOpenSearch={handleOpenSearch}
      notifications={notifications}
      unreadNotificationCount={unreadNotificationCount}
      isSaved={watchlist.some((w) => w.id === p.id)}
      onToggleSave={() => handleToggleSave(p)}
      isLiked={likedPostIds[p.id] ?? false}
      onToggleLike={() => handleToggleLike(p)}
      onOpenLikers={() => handleOpenPeopleList(p.id, 'likes', p.posterName, 'discoverPlayer')}
      isShared={sharedPostIds[p.id] ?? false}
      onToggleShare={() => handleToggleShare(p)}
      defaultMuted={defaultMuted}
      {...followPropsFor(p.posterId)}
      {...repostPropsFor(p)}
    />
  );

  // The grids PosterProfileScreen shows for whoever is being viewed — also
  // the exact lists its gallery player swipes through.
  const viewedPosterDiscoverList: VideoPost[] = viewedPoster
    ? ((viewedPoster.id ? viewedPosterPosts[viewedPoster.id]?.discover : undefined) ??
      discoverPosts.filter((p) => p.posterName === viewedPoster.name))
    : [];
  const viewedPosterShopList: VideoPost[] = viewedPoster
    ? ((viewedPoster.id ? viewedPosterPosts[viewedPoster.id]?.shop : undefined) ??
      shopPosts.filter((p) => p.posterName === viewedPoster.name))
    : [];

  // The bottom tab bar (mobile/tablet) shows on the screens you move between, not on
  // detail/flow screens (cart, profile, login...) that have their own back arrow.
  const bottomTab: BottomTab | null =
    view === 'shop'
      ? 'home'
      : view === 'discoverPlayer'
        ? 'discover'
        : view === 'wanted' || view === 'wantedDetail'
          ? 'wanted'
          : view === 'categoryLanding' || view === 'categoryCatalog'
            ? 'categories'
            : null;
  const showBottomNav = bottomTab !== null || view === 'search';

  const handleTabHome = () => {
    if (shopScope) exitShopGallery();
    setDiscoverScoped(false);
    setDiscoverBackView('shop');
    setShopBackView('shop');
    setView('shop');
  };
  // Scan always means "what is this?": for the video on screen when there is one (a shop
  // video's clip credits that video; Discover videos scan the same way), otherwise it
  // opens the plain description search.
  const handleTabScan = () => {
    if (view === 'shop' && activeShopPost) {
      handleOpenTwinSearch(activeShopPost, '', Boolean(activeShopPost.posterId) && activeShopPost.posterId !== userAccount?.id);
    } else if (view === 'discoverPlayer' && activeDiscoverPost) {
      handleOpenTwinSearch(activeDiscoverPost);
    } else {
      handleOpenTwinSearch(null);
    }
  };

  return (
    <main
      className="app-shell flex flex-col overflow-hidden bg-white"
      data-bottom-nav={showBottomNav ? '' : undefined}
    >
      <div className="relative min-h-0 flex-1">
      {view === 'shop' && (
        <>
          <NavBar
            onOpenProfile={handleOpenProfile}
            onOpenWatchlist={handleOpenWatchlist}
            onOpenNotifications={handleOpenNotifications}
            onOpenCart={handleOpenCart}
            onOpenSearch={handleOpenSearch}
            unreadNotificationCount={unreadNotificationCount}
            cartCount={cartItems.reduce((sum, i) => sum + i.quantity, 0)}
          />
          <div className="flex h-full">
            <CategoryDrawer
              categories={categories}
              deals={deals}
              onOpenDiscover={handleOpenDiscover}
              onSelectCategory={handleSelectCategory}
              onSelectDeal={handleSelectDeal}
              onSelectNewArrivals={handleSelectNewArrivals}
            />
            {activeShopPost ? (
              <>
                <SwipeStage
                  settledKey={activeShopPost.id}
                  pendingDirection={shopPendingDirection}
                  onSettled={handleShopSwipeSettled}
                  current={renderShopVideoStage(activeShopPost, true)}
                  next={
                    shopIndex < feedPosts.length - 1
                      ? renderShopVideoStage(feedPosts[shopIndex + 1], false)
                      : undefined
                  }
                  prev={
                    shopIndex > 0
                      ? renderShopVideoStage(feedPosts[shopIndex - 1], false)
                      : undefined
                  }
                />
                <VideoPrefetch urls={[feedPosts[shopIndex + 1]?.videoUrl]} />
                <ProductDrawer
                  key={activeShopPost.id}
                  post={activeShopPost}
                  overlayVisible={overlayVisible}
                  sheetOpen={shopSheetOpen}
                  captionHeight={shopCaptionHeight}
                  descExpanded={shopDescExpanded}
                  onSheetOpenChange={setShopSheetOpen}
                  productActivity={productActivity}
                  onSelectProduct={handleSelectShopProduct}
                  onBuyNow={handleBuyNowFromShopFeed}
                  onAddToCart={handleAddToCartFromShopFeed}
                  onAskTwin={
                    TWIN_ENABLED && activeShopPost.posterId && activeShopPost.posterId !== userAccount?.id
                      ? () => handleOpenTwinSearch(activeShopPost, '', true)
                      : undefined
                  }
                />
              </>
            ) : (
              // Two real cases now, not one: still loading from the API
              // (brief, but real — the old static mock import never had
              // this gap), or genuinely empty (every post deleted from
              // the merchant dashboard, or the fetch failed and even the
              // mock fallback came up empty).
              <div className="flex flex-1 items-center justify-center bg-panel">
                <p className="max-w-[220px] text-center text-[13.5px] text-text-mute">
                  {shopFeedLoading
                    ? 'Loading the shop feed…'
                    : "Nothing in the shop feed yet — add a post from your business page's Posts tab."}
                </p>
              </div>
            )}
          </div>
        </>
      )}

      {view === 'discoverPlayer' && activeDiscoverPost && (
        <div className="flex h-full">
          <DiscoverNavBar onBack={handleDiscoverBack} onOpenSearch={handleOpenSearch} />
          {/* Same CategoryDrawer shop uses, desktop-only — lets discover
              carry the same left nav column (categories, deals, new
              arrivals) instead of stranding people who want to browse the
              shop mid-scroll. Discover pill hidden here — the header's
              back arrow already covers "leave discover," so a second
              control for it (relabeled or not) would just be a duplicate
              of that one, not a real second option. */}
          <CategoryDrawer
              categories={categories}
              deals={deals}
            onOpenDiscover={handleOpenDiscover}
            onSelectCategory={handleSelectCategory}
            onSelectDeal={handleSelectDeal}
            onSelectNewArrivals={handleSelectNewArrivals}
            hideDiscoverPill
          />
          {/* Video column is no longer full-bleed on desktop now that it
              sits between the category drawer and comments panel — still
              full-bleed on mobile/tablet where neither renders. Next/
              previous is swipe (touch) or scroll (wheel) only now, same
              mechanism the shop tab already used. Comments get the side
              panel instead — this is discussion content, that list
              wasn't. */}
          <SwipeStage
            settledKey={activeDiscoverPost.id}
            pendingDirection={discoverPendingDirection}
            onSettled={handleDiscoverSwipeSettled}
            current={renderDiscoverVideoStage(activeDiscoverPost, true)}
            next={upcomingDiscoverPost ? renderDiscoverVideoStage(upcomingDiscoverPost, false) : undefined}
            prev={
              discoverNav.index > 0
                ? renderDiscoverVideoStage(discoverNav.items[discoverNav.index - 1], false)
                : undefined
            }
          />
          <VideoPrefetch urls={[upcomingDiscoverPost?.videoUrl]} />
          <CommentsPanel
            key={`${activeDiscoverPost.id}-comments`}
            currentUserId={userAccount?.id}
            currentUserAvatarUrl={userAccount?.avatarUrl}
            isPostOwner={!!userAccount?.id && activeDiscoverPost.posterId === userAccount.id}
            onReactToComment={handleReactToComment}
            onRemoveCommentReaction={handleRemoveCommentReaction}
            onShowReactors={handleShowCommentReactors}
            reactors={commentReactors}
            reactorsLoading={commentReactorsLoading}
            reactorsFor={commentReactorsFor}
            onCloseReactors={handleCloseCommentReactors}
            onPinComment={(commentId) => handlePinComment(activeDiscoverPost.id, commentId)}
            onUnpinComment={(commentId) => handleUnpinComment(activeDiscoverPost.id, commentId)}
            onEditComment={handleEditComment}
            onDeleteComment={handleDeleteComment}
            post={activeDiscoverPost}
            comments={discoverComments[activeDiscoverPost.id] ?? []}
            onAddComment={handleAddComment}
            expandedThreads={expandedCommentThreads}
            onToggleThread={(id) => setExpandedCommentThreads((prev) => ({ ...prev, [id]: !prev[id] }))}
            mobileOpen={commentsOpen}
            onMobileClose={() => setCommentsOpen(false)}
          />
        </div>
      )}

      {view === 'categoryLanding' && selectedCategory && (
        <CategoryLanding
          category={selectedCategory}
          banners={categoryBanners.filter((b) => b.categoryId === selectedCategory.id)}
          onSelectBanner={handleSelectBanner}
          onBack={() => setView('shop')}
        />
      )}

      {view === 'categoryCatalog' && selectedCategory && selectedBanner && (
        <CategoryCatalog
          category={selectedCategory}
          banner={selectedBanner}
          onBack={() =>
            setView(selectedCategory.id === NEW_ARRIVALS_CATEGORY_ID ? 'shop' : 'categoryLanding')
          }
          onSelectProduct={handleSelectProduct}
        />
      )}

      {view === 'productDetail' && selectedProduct && (
        <ProductDetailScreen
          key={selectedProduct.id}
          product={selectedProduct}
          categoryName={selectedCategory?.name ?? 'Shop'}
          backLabel={
            productDetailBackView === 'shop'
              ? 'Back to video'
              : productDetailBackView === 'search'
                ? 'Back to search'
                : productDetailBackView === 'notifications'
                  ? 'Back to notifications'
                  : productDetailBackView === 'wantedDetail'
                    ? 'Back to request'
                    : 'Back to category'
          }
          onBack={() => setView(productDetailBackView)}
          onBuyNow={productDetailBackView === 'shop' ? handleBuyNowFromShopFeed : handleBuyNow}
          onAddToCart={productDetailBackView === 'shop' ? handleAddToCartFromShopFeed : handleAddToCart}
          onPreviewDiscount={handlePreviewBuyNowDiscount}
          relatedProducts={getRelatedProducts(selectedProduct)}
          onSelectRelatedProduct={handleSelectRelatedProduct}
        />
      )}

      {view === 'myOrders' && (
        <MyOrdersScreen
          orders={orders}
          onBack={() => setView(myOrdersBackView)}
          backLabel={myOrdersBackView === 'profile' ? 'Back to profile' : 'Back to shop'}
          onCancel={handleCancelOrder}
          onConfirmReceipt={handleConfirmReceipt}
          onReportDefect={handleReportDefect}
        />
      )}

      {view === 'search' && (
        <SearchScreen
          onBack={() => setView('shop')}
          onSelectProduct={handleSelectSearchProduct}
          onSelectShopPost={handleSelectShopPost}
          onSelectDiscoverPost={handleOpenDiscoverPost}
          onSelectPerson={(person) =>
            handleViewPoster({ posterName: person.displayName, posterAvatar: person.avatarUrl, posterId: person.id }, 'search')
          }
        />
      )}

      {view === 'wanted' && (
        <WantedBoard
          onBack={() => setView('shop')}
          onOpen={(id, screen) => {
            setWantedId(id);
            setWantedScreen(screen ?? 'detail');
            setWantedBackView('wanted');
            setView('wantedDetail');
          }}
          onRequest={() => handleOpenTwinSearch(null)}
          onNeedLogin={handleNeedLogin}
        />
      )}

      {view === 'wantedDetail' && wantedId && (
        <WantedDetail
          key={wantedId}
          id={wantedId}
          initialScreen={wantedScreen}
          onScreenChange={setWantedScreen}
          onBack={() => setView(wantedBackView)}
          onOpenProduct={(product) => {
            setSelectedProduct(product);
            setProductDetailBackView('wantedDetail');
            setView('productDetail');
          }}
          isMerchant={Boolean(merchantAccount)}
          onOpenMerchantCreate={() => setView('merchantCreate')}
          onNeedLogin={handleNeedLogin}
        />
      )}

      {view === 'creatorImpact' && userAccount && (
        <CreatorImpact
          username={userAccount.username}
          onBack={() => setView('profile')}
          onOpenTwins={() => setView('creatorTwins')}
          onOpenRequest={(id) => {
            setWantedId(id);
            setWantedScreen('detail');
            setWantedBackView('creatorImpact');
            setView('wantedDetail');
          }}
        />
      )}

      {view === 'creatorTwins' && <CreatorTwins onBack={() => setView('creatorImpact')} />}

      {view === 'profile' && userAccount && (
        <ProfileScreen
          account={userAccount}
          posts={myDiscoverPosts}
          onAddPost={handleAddDiscoverPost}
          onDeletePost={handleDeleteDiscoverPost}
          onOpenPost={(post) => handleOpenDiscoverPost(post, { posts: myDiscoverPosts, backView: 'profile' })}
          onBack={() => setView('shop')}
          merchantAccount={merchantAccount}
          onOpenMerchantCreate={() => setView('merchantCreate')}
          onSwitchToMerchant={() => setView('merchantDashboard')}
          onOpenSettings={() => handleOpenSettings('profile')}
          orderCount={orders.length}
          onOpenOrders={() => {
            setMyOrdersBackView('profile');
            setView('myOrders');
          }}
          interests={interests}
          onSaveProfile={handleSaveProfile}
          onChangeAvatar={handleChangeAvatar}
          onOpenCreatorImpact={TWIN_ENABLED ? () => setView('creatorImpact') : undefined}
          onOpenFollowers={() => handleOpenPeopleList(userAccount.id, 'followers', undefined, 'profile')}
          onOpenFollowing={() => handleOpenPeopleList(userAccount.id, 'following', undefined, 'profile')}
        />
      )}

      {view === 'createAccount' && (
        <CreateAccountScreen
          onBack={() => setView('shop')}
          onCreate={handleCreateAccount}
          onGoToLogin={() => setView('login')}
          onOpenTerms={() => setView('terms')}
          onOpenPrivacy={() => handleOpenLegal('privacy', 'createAccount')}
        />
      )}

      {view === 'terms' && <TermsScreen onBack={() => setView('createAccount')} />}

      {view === 'legal' && (
        <LegalScreen
          doc={legalDoc}
          onBack={() => setView(legalBackView)}
          backLabel={legalBackView === 'createAccount' ? 'Back to sign up' : 'Back to settings'}
        />
      )}

      {view === 'login' && (
        <LoginScreen
          notice={sessionExpiredNotice ? 'Your session expired — log in again to continue.' : undefined}
          onBack={() => {
            setSessionExpiredNotice(false);
            setView('shop');
          }}
          onLogin={(profile) => {
            setSessionExpiredNotice(false);
            handleCreateAccount(profile);
          }}
          onGoToSignup={() => {
            setSessionExpiredNotice(false);
            setView('createAccount');
          }}
          onForgotPassword={() => setView('forgotPassword')}
        />
      )}

      {view === 'forgotPassword' && <ForgotPasswordScreen onBack={() => setView('login')} />}

      {view === 'suspended' && (
        <SuspensionScreen
          banReason={userAccount?.banReason}
          bannedAt={userAccount?.bannedAt}
          onLogOut={handleLogOut}
        />
      )}

      {view === 'merchantCreate' && (
        <MerchantCreate onBack={() => setView('profile')} onCreate={handleCreateMerchant} />
      )}

      {view === 'merchantDashboard' && merchantAccount && (
        <MerchantDashboard
          account={merchantAccount}
          onSwitchToPersonal={() => setView('profile')}
          posts={merchantOwnPosts}
          onAddPost={handleAddShopPost}
          onUpdatePost={handleUpdateShopPost}
          onDeletePost={handleDeleteShopPost}
          onOpenPost={(post) => handleOpenShopGallery(post, merchantOwnPosts, 'merchantDashboard')}
          initialSection={merchantSection}
          onSectionChange={setMerchantSection}
          orders={sellingOrders}
          onAdvanceOrderStatus={handleAdvanceOrderStatus}
          onCancelOrder={handleCancelOrder}
          merchantProducts={merchantProducts}
          categories={categories}
          categoryBanners={categoryBanners}
          onAddProduct={handleAddMerchantProduct}
          onUpdateProduct={handleUpdateMerchantProduct}
          onDeleteProduct={handleDeleteMerchantProduct}
          onAddPayout={handleAddMerchantPayout}
        />
      )}

      {view === 'notifications' && (
        <NotificationsScreen
          notifications={notifications}
          onBack={() => setView('shop')}
          onMarkRead={handleMarkNotificationRead}
          onMarkAllRead={handleMarkAllNotificationsRead}
          onSelectNotification={handleSelectNotification}
        />
      )}

      {view === 'cart' && (
        <CartScreen
          items={cartItems}
          onBack={() => setView('shop')}
          onStartShopping={() => setView('shop')}
          onUpdateQuantity={handleUpdateCartQuantity}
          onRemove={handleRemoveFromCart}
          onCheckout={handleCheckout}
          onPreviewDiscount={handlePreviewDiscount}
          shippingAddress={userAccount?.shippingAddress}
          onEditShippingAddress={() => handleOpenShippingAddress('cart')}
        />
      )}

      {view === 'shippingAddress' && (
        <ShippingAddressScreen
          address={userAccount?.shippingAddress}
          onBack={() => setView(shippingAddressBackView)}
          onSave={handleSaveShippingAddress}
        />
      )}

      {view === 'watchlist' && (
        <WatchlistScreen posts={watchlist} onBack={() => setView('shop')} onSelectPost={handleOpenDiscoverPost} />
      )}

      {view === 'posterProfile' && viewedPoster && (
        <PosterProfileScreen
          posterName={viewedPoster.name}
          posterAvatar={viewedPoster.avatar}
          bio={(viewedPoster.id ? posterProfileStats[viewedPoster.id]?.bio : undefined) ?? posterStats[viewedPoster.name]?.bio}
          followers={
            (viewedPoster.id ? posterProfileStats[viewedPoster.id]?.followers : undefined) ??
            posterStats[viewedPoster.name]?.followers ??
            0
          }
          following={
            (viewedPoster.id ? posterProfileStats[viewedPoster.id]?.following : undefined) ??
            posterStats[viewedPoster.name]?.following ??
            0
          }
          isFollowListPrivate={viewedPoster.id ? (posterProfileStats[viewedPoster.id]?.isPrivate ?? false) : false}
          mutualFollowersCount={viewedPoster.id ? (posterProfileStats[viewedPoster.id]?.mutualFollowersCount ?? null) : null}
          discoverPosts={viewedPosterDiscoverList}
          shopPosts={viewedPosterShopList}
          initialTab={posterProfileTab}
          onTabChange={setPosterProfileTab}
          onBack={handlePosterProfileBack}
          onSelectDiscoverPost={(post) =>
            handleOpenDiscoverPost(post, { posts: viewedPosterDiscoverList, backView: 'posterProfile' })
          }
          onSelectShopPost={(post) => handleOpenShopGallery(post, viewedPosterShopList, 'posterProfile')}
          posterId={viewedPoster.id}
          {...followListPropsFor(viewedPoster.id, viewedPoster.name)}
          {...followPropsFor(viewedPoster.id)}
        />
      )}

      {view === 'followList' && followListState && (
        <FollowListScreen
          kind={followListState.kind}
          ownerName={followListState.ownerName}
          people={followListState.people}
          loading={followListState.loading}
          error={followListState.error}
          onBack={() => setView(followListBackView)}
          onSelectPerson={handleSelectFollowListPerson}
        />
      )}

      {view === 'settings' && (
        <SettingsScreen
          onBack={() => setView(settingsBackView)}
          autoplayNext={autoplayNext}
          onToggleAutoplayNext={handleToggleAutoplayNext}
          defaultMuted={defaultMuted}
          onToggleDefaultMuted={handleToggleDefaultMuted}
          privateFollowLists={privateFollowLists}
          onTogglePrivateFollowLists={handleTogglePrivateFollowLists}
          hideMutualFollowers={hideMutualFollowers}
          onToggleHideMutualFollowers={handleToggleHideMutualFollowers}
          interests={interests}
          discoverInterests={selectedInterests}
          onChangeDiscoverInterests={complete}
          shippingAddress={userAccount?.shippingAddress}
          onOpenShippingAddress={() => handleOpenShippingAddress('settings')}
          birthday={userAccount?.birthday}
          onChangeBirthday={handleChangeBirthday}
          onLogOut={handleLogOut}
          onOpenLegal={(doc) => handleOpenLegal(doc, 'settings')}
        />
      )}

      <CategorySheet
        categories={categories}
        deals={deals}
        open={categoriesOpen}
        onClose={() => setCategoriesOpen(false)}
        onSelectCategory={handleSelectCategory}
        onSelectDeal={handleSelectDeal}
        onSelectNewArrivals={handleSelectNewArrivals}
      />
      {TWIN_ENABLED && twinSearch && (
        <TwinSearchSheet
          key={twinSearch.post?.id ?? 'discover'}
          post={twinSearch.post}
          initialQuery={twinSearch.query}
          startAtMs={twinSearch.startAtMs}
          categories={categories}
          onClose={() => setTwinSearch(null)}
          onSelectProduct={twinSearch.shop ? handleSelectShopProduct : handleSelectSearchProduct}
          /* From a shop video, adds and buys credit that video (the server checks the
             product really is tagged there, so a search-only match is just uncredited). */
          onBuyNow={twinSearch.shop ? handleBuyNowFromShopFeed : handleBuyNow}
          onAddToCart={twinSearch.shop ? handleAddToCartFromShopFeed : handleAddToCart}
        />
      )}
      <DiscoverOnboarding open={discoverOpen} interests={interests} onDone={handleDiscoverDone} />
      </div>
      {showBottomNav && (
        <BottomNav
          active={categoriesOpen ? 'categories' : bottomTab}
          onHome={handleTabHome}
          onDiscover={() => {
            if (view !== 'discoverPlayer') handleOpenDiscover();
          }}
          onScan={handleTabScan}
          onWanted={() => setView('wanted')}
          onCategories={() => setCategoriesOpen(true)}
        />
      )}
    </main>
  );
}
