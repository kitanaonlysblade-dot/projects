// Thin fetch wrapper for the FastAPI backend (see the separate
// lumin-backend project). Every function here mirrors one route from
// that project's app/routers/ — same grouping, same names where they
// translate cleanly. This file only makes HTTP calls and returns typed
// JSON; it doesn't hold app state itself (that's still page.tsx's job)
// and doesn't know anything about lib/data.ts.
//
// Field names below are snake_case on purpose, matching exactly what
// the backend's Pydantic schemas serialize — resist the urge to
// camelCase them here, since that would silently break the moment a
// field is added or renamed on the backend and nobody notices the two
// sides drifted.

import type { ShippingAddress, UserProfile } from './types';

// NEXT_PUBLIC_API_URL must be an ABSOLUTE url (scheme + host) pointing at
// the backend. If it's ever set to a bare host (no "http://"/"https://"
// — e.g. just "my-backend.up.railway.app"), `fetch(`${API_BASE_URL}${path}`)`
// below doesn't fail — it silently resolves the bare host as a *path* on
// THIS app's own origin instead of an absolute URL, producing a request
// like "https://this-frontend.app/my-backend.up.railway.app/auth/login"
// (a 404 against the frontend's own server, not the backend) with
// nothing in the error pointing at the real cause. Guard against that
// footgun here rather than relying on every deploy getting the env var
// right: default a scheme-less value to https (the only scheme Railway/
// most hosts serve over) and warn loudly so it's obvious in the console
// instead of a silent wrong-URL 404.
function resolveApiBaseUrl(value: string): string {
  const trimmed = value.replace(/\/+$/, '');
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (typeof window !== 'undefined') {
    // eslint-disable-next-line no-console
    console.error(
      `NEXT_PUBLIC_API_URL ("${value}") is missing its scheme (http:// or https://). ` +
        `Requests would otherwise resolve as a path on this app's own origin instead of ` +
        `hitting the backend. Defaulting to "https://${trimmed}" for now — fix the env var ` +
        `(and rebuild: it's inlined into the client bundle at build time, see Dockerfile) ` +
        `to silence this.`,
    );
  }
  return `https://${trimmed}`;
}

const API_BASE_URL = resolveApiBaseUrl(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000');

// ---- Auth token storage ----------------------------------------------
// The backend issues a JWT on signup/login (auth/security.py's
// create_access_token) that every authenticated call below needs on its
// Authorization header. Kept in localStorage rather than React state so
// it survives a page refresh.
const TOKEN_KEY = 'lumin_token';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

// Registered once by page.tsx on mount, so a 401 anywhere in the app can
// reach it without every one of the ~80 call sites below threading its
// own auth-expiry handling through. A 401 on a call this file itself
// marked `auth: true` means exactly one thing regardless of which route
// it came from — the token that was just sent is no longer valid
// (expired, malformed, or its user no longer exists; see
// get_current_user's own comment on the backend) — so there's nothing
// route-specific to decide here, just one thing to do: clear it and let
// the registered handler send the person back to log in. Before this
// existed, an expired token (this app's own JWTs live 7 days) made
// every authenticated action fail silently or with a misleading
// "check your connection" message forever, with nothing telling the
// person they'd simply been signed out.
let unauthorizedHandler: (() => void) | null = null;
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; auth?: boolean; form?: boolean; keepalive?: boolean } = {},
): Promise<T> {
  const { method = 'GET', body, auth = false, form = false, keepalive = false } = options;
  const headers: Record<string, string> = {};

  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let requestBody: BodyInit | undefined;
  if (body !== undefined) {
    if (body instanceof FormData) {
      // Browser sets the multipart Content-Type (with the correct
      // boundary) itself once it sees a FormData body — setting it by
      // hand here would omit that boundary and the backend couldn't
      // parse the upload at all.
      requestBody = body;
    } else if (form) {
      // Only the login route needs this — OAuth2's password flow is
      // form-encoded by spec, not JSON, regardless of what the rest of
      // the API uses.
      requestBody = new URLSearchParams(body as Record<string, string>);
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    } else {
      requestBody = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
    }
  }

  const response = await fetch(`${API_BASE_URL}${path}`, { method, headers, body: requestBody, keepalive });

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const data = await response.json();
      if (typeof data.detail === 'string') detail = data.detail;
    } catch {
      // Response body wasn't JSON — fall back to the status text.
    }
    // Only for a call this file itself attached a token to — a bare 401
    // with no token sent at all is a normal, expected outcome for some
    // routes (most notably login itself rejecting a wrong password) and
    // says nothing about any existing session being invalid.
    if (response.status === 401 && auth) {
      clearToken();
      unauthorizedHandler?.();
    }
    throw new ApiError(response.status, detail);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

// ---- Shapes returned by the backend -----------------------------------
// These mirror app/schemas/*.py's *Read models — snake_case field names,
// see the note at the top of this file for why.

// Nested on ApiUser (a saved default) and ApiOrder (a permanent
// snapshot) — see ShippingAddressMixin's own comment on the backend for
// why it's the same shape in both places. null, not omitted, when unset:
// mirrors User.shipping_address / Order.shipping_address being None
// rather than the field being absent from the response.
export interface ApiShippingAddress {
  recipient_name: string;
  phone: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string | null;
  postal_code: string | null;
  country: string;
}

export interface ApiUser {
  id: string;
  email: string;
  username: string;
  display_name: string;
  bio: string;
  avatar_url: string | null;
  // ISO date string ("YYYY-MM-DD"), null until set — see UserProfile.birthday.
  birthday: string | null;
  following_count: number;
  followers_count: number;
  autoplay_next: boolean;
  default_muted: boolean;
  private_follow_lists: boolean;
  hide_mutual_followers: boolean;
  shipping_address: ApiShippingAddress | null;
  is_active: boolean;
  ban_reason: string | null;
  banned_at: string | null;
}

export interface ApiTokenWithUser {
  access_token: string;
  token_type: string;
  user: ApiUser;
}

export interface ApiCategory {
  id: string;
  name: string;
  icon_url: string | null;
}

export interface ApiCategoryBanner {
  id: string;
  category_id: string;
  title: string;
  subtitle: string | null;
}

export interface ApiDeal {
  id: string;
  text: string;
  sub: string;
  category_id: string | null;
}

export interface ApiProductImage {
  id: string;
  url: string;
  position: number;
}

export interface ApiProduct {
  id: string;
  name: string;
  price: string; // Decimal serializes as a string — parseFloat before doing math with it
  description: string | null;
  colors: string[];
  sizes: string[];
  is_new: boolean;
  cart_count: number;
  stock_quantity: number | null;
  // 0-100, null meaning no discount — a merchant raising this is what
  // triggers the "an item you saved just went on sale" notification
  // (see lumin-backend's routers/merchant.py).
  discount_percent: number | null;
  in_stock: boolean;
  banner_id: string | null;
  merchant_id: string | null;
  images: ApiProductImage[];
}

export interface ApiInterest {
  id: string;
  label: string;
  emoji: string;
}

export interface ApiComment {
  id: string;
  video_post_id: string;
  author_id: string | null;
  // Set only on a reply — see the backend Comment model's own comment
  // on why this is one level deep rather than true nesting.
  parent_id: string | null;
  // "Deleted user" server-side when author_id is null (a past comment
  // whose account was later removed) — never null itself.
  author_display_name: string;
  author_avatar_url: string | null;
  text: string;
  likes_count: number;
  replies_count: number;
  liked_by_me: boolean;
  my_reaction: string | null;
  reaction_counts: Record<string, number>;
  is_pinned: boolean;
  reply_to_user_id: string | null;
  reply_to_name: string | null;
  edited_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApiCommentReactor {
  id: string;
  display_name: string;
  avatar_url: string | null;
  reaction: string;
}

export type ApiVideoFeed = 'shop' | 'discover';

export interface ApiTwin {
  id: string;
  video_post_id?: string;
  product_id: string;
  label: string;
  start_ms: number;
  end_ms: number;
  review_status: 'pending' | 'approved' | 'flagged';
}

export interface ApiTwinInput {
  product_id: string;
  label: string;
  start_ms: number;
  end_ms: number;
}

export interface ApiVideoPost {
  id: string;
  feed: ApiVideoFeed;
  poster_id: string;
  poster_display_name: string;
  poster_avatar_url: string | null;
  merchant_id: string | null;
  description: string;
  video_url: string | null;
  lite_video_url?: string | null;
  twins?: ApiTwin[];
  retwin_of_id?: string | null;
  tag_only?: boolean;
  retwin_kind?: 'video' | 'product' | null;
  sync_offset_ms?: number;
  product_retwins?: { id: string; poster_display_name: string; poster_avatar_url: string | null }[];
  retwin_of?: {
    id: string;
    poster_display_name: string;
    video_url: string | null;
    lite_video_url: string | null;
    thumbnail_url: string | null;
    width: number | null;
    height: number | null;
  } | null;
  views_count?: number;
  unique_viewers_count?: number;
  watch_seconds_total?: number;
  completions_count?: number;
  thumbnail_url: string | null;
  width: number | null;
  height: number | null;
  likes_count: number;
  comments_count: number;
  shares_count: number;
  saves_count: number;
  products: ApiProduct[];
  interests: ApiInterest[];
  created_at: string;
  repost_id: string | null;
  reposted_by: { id: string; display_name: string; avatar_url: string | null } | null;
}

export interface ApiCartItem {
  id: string;
  user_id: string;
  product_id: string;
  color: string | null;
  size: string | null;
  quantity: number;
  counts_as_shop_activity: boolean;
  // Nested by CartItemRead so a cart line can render its name and price
  // without a follow-up GET /products/{id} each — see that schema's own
  // comment on why it's returned here rather than just product_id.
  product: ApiProduct;
}

export type ApiOrderStatus = 'pending' | 'shipped' | 'delivered' | 'cancelled';

export interface ApiOrder {
  id: string;
  buyer_id: string | null;
  product_id: string | null;
  product_name: string;
  price: string;
  color: string | null;
  size: string | null;
  buyer_name: string;
  status: ApiOrderStatus;
  created_at: string;
  shipping_address: ApiShippingAddress | null;
  // Null on every order that's never been cancelled — see the same
  // column's own comment on the backend Order model.
  cancel_reason: string | null;
  payout_status: 'held' | 'released' | 'refunded';
  delivered_at: string | null;
}

export interface ApiMerchantAccount {
  id: string;
  user_id: string;
  business_name: string;
  category: string;
  description: string;
  bank_code: string | null;
  account_number: string | null;
  account_name: string | null;
  payout_ready: boolean;
  // Keyword insights subscription state.
  insights_active?: boolean;
}

// ---- Auth ---------------------------------------------------------------

export function apiUserToProfile(user: ApiUser): UserProfile {
  return {
    id: user.id,
    username: `@${user.username}`,
    displayName: user.display_name,
    bio: user.bio,
    avatarUrl: user.avatar_url ?? undefined,
    birthday: user.birthday ?? undefined,
    following: user.following_count,
    followers: user.followers_count,
    email: user.email,
    autoplayNext: user.autoplay_next,
    defaultMuted: user.default_muted,
    privateFollowLists: user.private_follow_lists,
    hideMutualFollowers: user.hide_mutual_followers,
    shippingAddress: user.shipping_address ? apiShippingAddressToAddress(user.shipping_address) : undefined,
    isActive: user.is_active,
    banReason: user.ban_reason ?? undefined,
    bannedAt: user.banned_at ?? undefined,
  };
}

export function apiShippingAddressToAddress(a: ApiShippingAddress): ShippingAddress {
  return {
    recipientName: a.recipient_name,
    phone: a.phone,
    line1: a.line1,
    line2: a.line2 ?? undefined,
    city: a.city,
    state: a.state ?? undefined,
    postalCode: a.postal_code ?? undefined,
    country: a.country,
  };
}

// The reverse — a form value going out in a request body, not a
// response coming in. camelCase -> snake_case, and undefined optional
// fields become explicit null rather than being omitted, matching
// ApiShippingAddress's own shape (the backend's ShippingAddress schema
// treats a present-but-null line2 the same as an absent one either way,
// but this keeps the two directions symmetric).
export function addressToApiShippingAddress(a: ShippingAddress): ApiShippingAddress {
  return {
    recipient_name: a.recipientName,
    phone: a.phone,
    line1: a.line1,
    line2: a.line2 ?? null,
    city: a.city,
    state: a.state ?? null,
    postal_code: a.postalCode ?? null,
    country: a.country,
  };
}

export function signup(payload: {
  email: string;
  password: string;
  username: string;
  display_name: string;
  bio?: string;
}): Promise<ApiTokenWithUser> {
  return request('/auth/signup', { method: 'POST', body: payload });
}

export function login(email: string, password: string): Promise<ApiTokenWithUser> {
  // OAuth2's password flow always calls the identifier field "username"
  // regardless of what you're actually logging in with — see the same
  // note on the backend's login route.
  return request('/auth/login', { method: 'POST', body: { username: email, password }, form: true });
}

// One endpoint covers both "sign up with Google" and "log in with
// Google" — see auth.py's own comment on why that's the same operation
// server-side. id_token is whatever GoogleSignInButton's callback hands
// back from Google Identity Services, forwarded here as-is; the backend
// verifies it against Google directly rather than trusting anything
// about the person from this call.
export function googleAuth(idToken: string): Promise<ApiTokenWithUser> {
  return request('/auth/google', { method: 'POST', body: { id_token: idToken } });
}

// ---- Traffic --------------------------------------------------------------
// One call, once per app load — see TrafficSource's own comment on the
// backend for why this is deliberately session-start acquisition
// tracking, not pageview/event tracking. No auth required (most of
// what this sends fires before anyone's logged in at all); never
// blocks or throws into the caller, since losing one analytics event
// is never a reason to disrupt anything else on load — see
// recordTrafficSource's own call site in page.tsx.
export const recordTrafficSource = (payload: {
  referrer?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
}): Promise<void> => request('/traffic', { method: 'POST', body: payload });

// ---- Reports ----------------------------------------------------------------
// Maps to ReportVideoSheet.tsx. target_type is fixed to 'video_post'
// there — this function stays generic (product/user too) since the
// backend's own ReportTargetType covers all three, even though only
// the video case has a real caller in this app today.

export type ApiReportTargetType = 'video_post' | 'product' | 'user';
export type ApiReportReason = 'spam' | 'counterfeit' | 'inappropriate' | 'harassment' | 'other';

export const fileReport = (payload: {
  target_type: ApiReportTargetType;
  target_id: string;
  reason: ApiReportReason;
  detail?: string;
}): Promise<void> => request('/reports', { method: 'POST', body: payload, auth: true });

// ---- Appeals ------------------------------------------------------------
// Maps to SuspensionScreen.tsx — the one screen a banned account can
// still reach (see get_current_user's own comment on the backend for
// why GET /auth/me and these two routes are the exceptions to
// get_current_active_user rejecting a banned session everywhere else).

export type ApiAppealStatus = 'pending' | 'approved' | 'denied';

export interface ApiAppeal {
  id: string;
  message: string;
  status: ApiAppealStatus;
  admin_response: string | null;
  created_at: string;
}

export const fileAppeal = (message: string): Promise<ApiAppeal> =>
  request('/users/me/appeal', { method: 'POST', body: { message }, auth: true });

export const listMyAppeals = (): Promise<ApiAppeal[]> => request('/users/me/appeals', { auth: true });

export function getMe(): Promise<ApiUser> {
  return request('/auth/me', { auth: true });
}

// Always resolves — even for an email with no account, or a
// Google-only account with no password to reset — see forgot_password's
// own comment on the backend for why that's deliberate (a different
// response for "no such account" would leak which emails are
// registered). The frontend should show the same "check your email"
// message regardless.
export function forgotPassword(email: string): Promise<void> {
  return request('/auth/forgot-password', { method: 'POST', body: { email } });
}

// token is whatever ResetPasswordScreen.tsx read out of the ?token=
// query param on the link the email sent — this is the only place that
// value goes.
export function resetPassword(token: string, newPassword: string): Promise<void> {
  return request('/auth/reset-password', { method: 'POST', body: { token, new_password: newPassword } });
}

// ---- Uploads ----------------------------------------------------------
// Backs the video/photo uploaders in MerchantPosts.tsx and
// MerchantProducts.tsx. Every uploader in the app should go through this
// rather than handing a blob: URL straight to video_url/image_urls —
// those only resolve in the tab that created them and stop working the
// moment it closes, so a blob: URL saved into the database is dead the
// next time anyone loads that post or product.
//
// Two requests under the hood — ask the backend for a presigned R2
// upload URL, then PUT the actual bytes straight to R2, never back
// through this app's own server (see lumin-backend's README "File
// uploads" section) — but uploadFile()'s own signature/return shape
// hasn't changed at all, so every caller above still just awaits one
// Promise<ApiUploadResult> exactly like before.

export interface ApiUploadResult {
  url: string;
}

interface ApiPresignedUpload {
  upload_url: string;
  view_url: string;
  file_key: string;
}

// Same limits app/storage.py's ALLOWED_IMAGE_TYPES/ALLOWED_VIDEO_TYPES
// and the old multipart endpoint's MAX_IMAGE_BYTES/MAX_VIDEO_BYTES used
// to enforce server-side. A presigned PUT URL has no way to cap upload
// size on R2's side (see that README section), so this client-side
// check is what's left of it — good enough to stop someone from
// accidentally trying to upload something huge, not a security
// boundary (a hand-built request could ignore it entirely).
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

function requestPresignedUpload(contentType: string): Promise<ApiPresignedUpload> {
  return request('/uploads/presigned-url', {
    method: 'POST',
    body: { file_type: contentType },
    auth: true,
  });
}

// `filename` is kept as a parameter purely so every existing call site
// above keeps compiling unchanged — it's never actually sent anywhere
// now, since R2's object key is a generated uuid, not the original name.
export async function uploadFile(file: File | Blob, _filename?: string): Promise<ApiUploadResult> {
  const contentType = file.type || 'application/octet-stream';
  const maxBytes = contentType.startsWith('video/') ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  if (file.size > maxBytes) {
    throw new ApiError(413, `File too large — max ${Math.round(maxBytes / (1024 * 1024))} MB`);
  }

  const { upload_url, view_url } = await requestPresignedUpload(contentType);

  // Plain fetch, not the request() helper above — R2's endpoint is a
  // completely different origin, and the presigned URL's own
  // query-string signature is what authorizes this PUT, not the JWT
  // this app sends everywhere else. No Authorization header at all.
  const putResponse = await fetch(upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: file,
  });
  if (!putResponse.ok) {
    throw new ApiError(putResponse.status, 'Upload to storage failed');
  }
  return { url: view_url };
}

// ---- Catalog (read-only, no auth needed) --------------------------------

export const listCategories = (): Promise<ApiCategory[]> => request('/categories');

export const listCategoryBanners = (categoryId: string): Promise<ApiCategoryBanner[]> =>
  request(`/categories/${categoryId}/banners`);

// Every banner across every category in one call — see the route's own
// comment for why this exists alongside the per-category one above.
export const listBanners = (): Promise<ApiCategoryBanner[]> => request('/banners');

export const listCategoryDeals = (categoryId: string): Promise<ApiDeal[]> =>
  request(`/categories/${categoryId}/deals`);

export const listDeals = (): Promise<ApiDeal[]> => request('/deals');

export const listProducts = (params?: { bannerId?: string; isNew?: boolean }): Promise<ApiProduct[]> => {
  const query = new URLSearchParams();
  if (params?.bannerId) query.set('banner_id', params.bannerId);
  if (params?.isNew !== undefined) query.set('is_new', String(params.isNew));
  const qs = query.toString();
  return request(`/products${qs ? `?${qs}` : ''}`);
};

export const getProduct = (productId: string): Promise<ApiProduct> => request(`/products/${productId}`);

export const listInterests = (): Promise<ApiInterest[]> => request('/interests');

// ---- Video posts ----------------------------------------------------------

export const listVideoPosts = (params: {
  feed: ApiVideoFeed;
  limit?: number;
  before?: string;
}): Promise<ApiVideoPost[]> => {
  const query = new URLSearchParams({ feed: params.feed });
  if (params.limit) query.set('limit', String(params.limit));
  if (params.before) query.set('before', params.before);
  return request(`/video-posts?${query.toString()}`);
};

export const getVideoPost = (postId: string): Promise<ApiVideoPost> => request(`/video-posts/${postId}`);

// Every post this person actually owns in one feed — their own uploads
// *and* their own reposts (a repost is a real row of theirs, just one
// whose content resolves through the original — see
// _resolve_video_post_for_read). Powers ProfileScreen's "Your posts"
// grid; unlike listVideoPosts above this is never paginated/shuffled,
// since it needs to be a complete, reliable list of what this account
// can manage, not a feed to swipe through.
export const listMyVideoPosts = (feed: ApiVideoFeed): Promise<ApiVideoPost[]> =>
  request(`/video-posts/mine?feed=${feed}`, { auth: true });

// Public equivalent of listMyVideoPosts, for viewing someone else's
// profile (PosterProfileScreen.tsx) — no auth required, same as any
// other public feed read.
export const listVideoPostsByPoster = (posterId: string, feed: ApiVideoFeed): Promise<ApiVideoPost[]> =>
  request(`/video-posts/by-poster/${posterId}?feed=${feed}`);

export const listComments = (postId: string): Promise<ApiComment[]> => request(`/video-posts/${postId}/comments`);

export const createVideoPost = (payload: {
  feed: ApiVideoFeed;
  description?: string;
  video_url?: string;
  thumbnail_url?: string;
  width?: number;
  height?: number;
  product_ids?: string[];
  interest_ids?: string[];
  twins?: ApiTwinInput[];
}): Promise<ApiVideoPost> => request('/video-posts', { method: 'POST', body: payload, auth: true });

export const updateVideoPost = (
  postId: string,
  payload: Partial<{
    description: string;
    video_url: string;
    thumbnail_url: string;
    width: number;
    height: number;
    product_ids: string[];
    interest_ids: string[];
    twins: ApiTwinInput[];
    sync_offset_ms: number;
  }>,
): Promise<ApiVideoPost> => request(`/video-posts/${postId}`, { method: 'PATCH', body: payload, auth: true });

export const deleteVideoPost = (postId: string): Promise<void> =>
  request(`/video-posts/${postId}`, { method: 'DELETE', auth: true });

export const addComment = (postId: string, text: string, parentId?: string): Promise<ApiComment> =>
  request(`/video-posts/${postId}/comments`, {
    method: 'POST',
    body: parentId ? { text, parent_id: parentId } : { text },
    auth: true,
  });

// Same toggle shape as likeVideoPost/unlikeVideoPost above, one level
// down — no "my liked comments" list-back route, unlike posts, since a
// comment's liked_by_me now comes back inline on every CommentRead
// (see the backend route's own comment on why that's fine for a
// thread that's already open, unlike posts loading app-wide).
export const likeComment = (commentId: string): Promise<void> =>
  request(`/video-posts/comments/${commentId}/like`, { method: 'POST', auth: true });

export const unlikeComment = (commentId: string): Promise<void> =>
  request(`/video-posts/comments/${commentId}/like`, { method: 'DELETE', auth: true });

// Author-only on the backend (edit_comment/delete_comment both 403 for
// anyone else) — CommentsPanel.tsx only shows the Edit/Delete options
// on the signed-in viewer's own comments in the first place, so this is
// a backstop, not the primary gate.
export const editComment = (commentId: string, text: string): Promise<ApiComment> =>
  request(`/video-posts/comments/${commentId}`, { method: 'PATCH', body: { text }, auth: true });

export const deleteComment = (commentId: string): Promise<void> =>
  request(`/video-posts/comments/${commentId}`, { method: 'DELETE', auth: true });

// Facebook-style reactions — one per person per comment; choosing a
// different one replaces the old. Both return the refreshed comment so
// the UI can reconcile its optimistic counts with the server's.
export const reactToComment = (commentId: string, reaction: string): Promise<ApiComment> =>
  request(`/video-posts/comments/${commentId}/reaction`, { method: 'PUT', body: { reaction }, auth: true });

export const removeCommentReaction = (commentId: string): Promise<ApiComment> =>
  request(`/video-posts/comments/${commentId}/reaction`, { method: 'DELETE', auth: true });

// Who reacted (the sheet opened by tapping the emoji summary).
export const listCommentReactors = (commentId: string): Promise<ApiCommentReactor[]> =>
  request(`/video-posts/comments/${commentId}/reactions`);

// Post owner only — pins one top-level comment to the top of the thread.
export const pinComment = (commentId: string): Promise<ApiComment> =>
  request(`/video-posts/comments/${commentId}/pin`, { method: 'POST', auth: true });

export const unpinComment = (commentId: string): Promise<ApiComment> =>
  request(`/video-posts/comments/${commentId}/pin`, { method: 'DELETE', auth: true });

export const addToWatchlist = (postId: string): Promise<void> =>
  request(`/video-posts/${postId}/watchlist`, { method: 'POST', auth: true });

export const removeFromWatchlist = (postId: string): Promise<void> =>
  request(`/video-posts/${postId}/watchlist`, { method: 'DELETE', auth: true });

export const listMyWatchlist = (): Promise<ApiVideoPost[]> => request('/video-posts/watchlist', { auth: true });

// Like/share — same toggle shape as watchlist above, but there's no
// "liked posts" screen to browse, so the list-back routes return bare
// ids rather than full posts (see the backend's own comment on
// list_my_liked_post_ids) — just enough for a membership check to seed
// each post's isLiked/isShared state on load.
// Viewing stats. startVideoView is called once a video has really been
// watched for ~3s; reportViewProgress then sends the seconds played since
// the previous report (keepalive so it survives the tab closing).
export const startVideoView = (postId: string, viewerKey: string): Promise<{ view_id: string | null }> =>
  request(`/video-posts/${postId}/view`, { method: 'POST', auth: true, body: { viewer_key: viewerKey } });

export const reportViewProgress = (viewId: string, watchSeconds: number, completed: boolean): Promise<void> =>
  request(`/video-posts/views/${viewId}/progress`, {
    method: 'POST',
    body: { watch_seconds: watchSeconds, completed },
    keepalive: true,
  });

// Shopping funnel. A tap = opening a product tagged on a video; sent
// fire-and-forget. The funnel list is owner-only (it includes revenue).
export const recordProductTap = (postId: string, productId: string): Promise<void> =>
  request(`/video-posts/${postId}/product-tap`, { method: 'POST', body: { product_id: productId } });

export interface ApiPostFunnel {
  video_post_id: string;
  product_taps: number;
  cart_adds: number;
  orders: number;
  revenue: number;
}

export const listMyPostFunnel = (): Promise<ApiPostFunnel[]> => request('/video-posts/mine/funnel', { auth: true });

export const likeVideoPost = (postId: string): Promise<void> =>
  request(`/video-posts/${postId}/like`, { method: 'POST', auth: true });

export const unlikeVideoPost = (postId: string): Promise<void> =>
  request(`/video-posts/${postId}/like`, { method: 'DELETE', auth: true });

export const listMyLikedPostIds = (): Promise<string[]> => request('/video-posts/likes', { auth: true });

export const shareVideoPost = (postId: string): Promise<void> =>
  request(`/video-posts/${postId}/share`, { method: 'POST', auth: true });

export const unshareVideoPost = (postId: string): Promise<void> =>
  request(`/video-posts/${postId}/share`, { method: 'DELETE', auth: true });

export const listMySharedPostIds = (): Promise<string[]> => request('/video-posts/shares', { auth: true });

// The "Repost" option in ShareSheet.tsx — reposts postId into the
// signed-in user's own presence in whichever feed it already lives in
// (see the backend's own comment on repost_of_id: no way to cross shop
// and discover, since there's no feed param here at all). Idempotent —
// reposting something already reposted returns the existing repost
// rather than creating a second one — so this is safe to call again
// without first checking isReposted client-side.
export const repostVideoPost = (postId: string): Promise<ApiVideoPost> =>
  request(`/video-posts/${postId}/repost`, { method: 'POST', auth: true });

export const removeRepost = (postId: string): Promise<void> =>
  request(`/video-posts/${postId}/repost`, { method: 'DELETE', auth: true });

// Same idea as listMyLikedPostIds/listMySharedPostIds above, for
// repostedPostIds in page.tsx — the ORIGINAL posts' ids, not the
// repost rows' own ids (see repostVideoPost's own comment on why
// everything targets the original).
export const listMyRepostPostIds = (): Promise<string[]> => request('/video-posts/reposts', { auth: true });

// Whether the current user already follows this poster — powers the
// Follow/Following button's initial state (VideoStage, PosterProfileScreen).
// There's no bulk version of this (e.g. "which of these ids do I follow") —
// nothing on the frontend needs more than one poster's status at a time.
export const getFollowStatus = (userId: string): Promise<boolean> =>
  request(`/users/${userId}/follow`, { auth: true });

export const followUser = (userId: string): Promise<void> =>
  request(`/users/${userId}/follow`, { method: 'POST', auth: true });

export const unfollowUser = (userId: string): Promise<void> =>
  request(`/users/${userId}/follow`, { method: 'DELETE', auth: true });

// Resolves a bare user id (all a follow/birthday Notification's own
// target_id ever carries — see Notification's comment on the backend)
// back into a name/avatar PosterProfileScreen can actually render. Same
// public-safe shape search's people section already returns, no auth
// required.
export const getUserPublicProfile = (userId: string): Promise<ApiPersonResult> => request(`/users/${userId}`);

// Who follows this account / who this account follows — tapping the
// "Followers" or "Following" label on ProfileScreen.tsx (your own
// profile) or PosterProfileScreen.tsx (someone else's) opens the
// matching list. Same public-safe PersonResult shape as search's people
// section and getUserPublicProfile above, no auth required either.
// auth: true on purpose (the token is only attached if one exists, so
// signed-out viewers still work). The backend hides these lists from
// everyone except the account itself when private_follow_lists is on, and it
// can only recognise "the account itself" if the token is sent. Without it
// the owner was treated as anonymous and got a 403 on their own lists.
export const listFollowers = (userId: string): Promise<ApiPersonResult[]> =>
  request(`/users/${userId}/followers`, { auth: true });

export const listFollowing = (userId: string): Promise<ApiPersonResult[]> =>
  request(`/users/${userId}/following`, { auth: true });

// Who's liked a given video post — tapping the like count on VideoStage
// opens this list. Same public-safe PersonResult shape as the two above.
export const listVideoPostLikers = (videoPostId: string): Promise<ApiPersonResult[]> =>
  request(`/video-posts/${videoPostId}/likes`);

// People who follow both the signed-in viewer and the given account —
// the "X mutual followers" row on PosterProfileScreen.tsx. Auth
// required (there's no "mutual" without knowing who's asking), unlike
// listFollowers/listFollowing/listVideoPostLikers above.
export const listMutualFollowers = (userId: string): Promise<ApiPersonResult[]> =>
  request(`/users/${userId}/mutual-followers`, { auth: true });

// ---- Notifications ------------------------------------------------
// Powers NotificationsScreen.tsx. Every notification the account will
// ever see — a new follower, a followed account's birthday, an item
// they saved going on sale, an order shipping, a moderation action —
// is created server-side (see lumin-backend's routers/users.py,
// routers/merchant.py, routers/admin.py, and app/notifications.py's
// birthday sync); nothing here ever constructs one, only reads and
// acknowledges them.

export interface ApiNotification {
  id: string;
  user_id: string;
  body: string;
  read: boolean;
  // 'follow'/'birthday' both point at a User id; 'product' at a Product
  // id; 'order'/'moderation' carry no target at all — see the backend
  // Notification model's own comment. apiNotificationToNotification
  // collapses follow/birthday into the frontend's single 'user' type.
  type:
    | 'product'
    | 'order'
    | 'moderation'
    | 'follow'
    | 'birthday'
    | 'post_like'
    | 'post_comment'
    | 'comment_reply'
    | 'comment_reaction'
    | 'retwin'
    | 'twin_request'
    | 'twin_reply'
    | 'twin_available'
    | 'twin_offered'
    | null;
  target_id: string | null;
  created_at: string;
}

export const listNotifications = (): Promise<ApiNotification[]> => request('/notifications', { auth: true });

export const markNotificationRead = (notificationId: string): Promise<ApiNotification> =>
  request(`/notifications/${notificationId}/read`, { method: 'POST', auth: true });

export const markAllNotificationsRead = (): Promise<void> =>
  request('/notifications/read-all', { method: 'POST', auth: true });

// Maps to ProfileScreen.tsx's Edit profile form, SettingsScreen.tsx's
// autoplay/mute toggles, and ShippingAddressScreen.tsx's save action —
// only ever sent as whichever single field (or, for shipping_address, a
// partial address) changed, but the type allows any subset of
// UserUpdate since the backend applies whatever's present and merges a
// partial address onto the existing one rather than replacing wholesale
// (see users.py's own handling).
export const updateMe = (
  payload: Partial<
    Pick<
      ApiUser,
      | 'display_name'
      | 'bio'
      | 'avatar_url'
      | 'username'
      | 'autoplay_next'
      | 'default_muted'
      | 'private_follow_lists'
      | 'hide_mutual_followers'
      | 'birthday'
    >
  > & { shipping_address?: Partial<ApiShippingAddress> },
): Promise<ApiUser> => request('/users/me', { method: 'PATCH', body: payload, auth: true });

// ---- Cart -----------------------------------------------------------------

export const listCart = (): Promise<ApiCartItem[]> => request('/cart', { auth: true });

export const addToCart = (payload: {
  product_id: string;
  color?: string;
  size?: string;
  quantity?: number;
  counts_as_shop_activity?: boolean;
  // The shop-feed video being watched (credits that video with the sale).
  source_video_post_id?: string;
}): Promise<ApiCartItem> => request('/cart', { method: 'POST', body: payload, auth: true });

export const updateCartItemQuantity = (itemId: string, quantity: number): Promise<ApiCartItem | void> =>
  request(`/cart/${itemId}`, { method: 'PATCH', body: { quantity }, auth: true });

export const removeFromCart = (itemId: string): Promise<void> =>
  request(`/cart/${itemId}`, { method: 'DELETE', auth: true });

// ---- Orders -----------------------------------------------------------------

export const buyNow = (payload: {
  product_id: string;
  color?: string;
  size?: string;
  shipping_address?: ApiShippingAddress;
}): Promise<ApiOrder> => request('/orders', { method: 'POST', body: payload, auth: true });

export const checkout = (payload: { shipping_address?: ApiShippingAddress } = {}): Promise<ApiOrder[]> =>
  request('/orders/checkout', { method: 'POST', body: payload, auth: true });

export const listMyOrders = (): Promise<ApiOrder[]> => request('/orders/me', { auth: true });

export const listSellingOrders = (): Promise<ApiOrder[]> => request('/orders/selling', { auth: true });

export const advanceOrderStatus = (orderId: string, status: ApiOrderStatus): Promise<ApiOrder> =>
  request(`/orders/${orderId}/status`, { method: 'PATCH', body: { status }, auth: true });

// Either the buyer or the selling merchant can call this — same route
// either way, see the backend's own comment on why. Refunds through
// Paystack automatically when the order was actually paid for; see
// that route's docstring for what it does and doesn't prorate.
export const cancelOrder = (orderId: string, reason?: string): Promise<ApiOrder> =>
  request(`/orders/${orderId}/cancel`, { method: 'POST', body: { reason }, auth: true });

// The buyer's "yes, this is what I ordered" tap — releases this order's
// held funds to the merchant right away instead of waiting out the rest
// of the 24-hour claim window.
export const confirmReceipt = (orderId: string): Promise<ApiOrder> =>
  request(`/orders/${orderId}/confirm-receipt`, { method: 'POST', auth: true });

// videoUrl must come from CameraRecorder.tsx, never a gallery/file
// picker — see that component's own comment on why this app has no
// upload-a-video-file path for this specific flow.
export const reportDefect = (orderId: string, videoUrl: string, reason?: string): Promise<ApiOrder> =>
  request(`/orders/${orderId}/report-defect`, {
    method: 'POST',
    body: { video_url: videoUrl, reason },
    auth: true,
  });

// ---- Payments (Paystack) ------------------------------------------------------
// Two-step, matching payments.py: initialize computes the real amount
// server-side and returns just what Paystack Inline's popup needs;
// verify is what actually turns a confirmed charge into ApiOrder rows
// (same shape checkout()/buyNow() used to return directly, back when
// there was no payment step in between).
//
// shipping_address on both initialize calls below is optional for the
// same reason it is on the backend's PaymentInitializeCreate: omit it to
// use whatever's already saved on the account (User.shipping_address),
// or send one to both use it for this order and save it as the new
// default — see resolve_shipping_address's own comment on the backend.
// Omitting it when nothing is saved yet is a 400, not a silent charge
// with nowhere to ship to.

export interface ApiPaymentInit {
  reference: string;
  amount_subunit: number;
  // amount_subunit == subtotal_subunit - discount_subunit + shipping_subunit
  // — see compute_shipping_fee/preview_discount on the backend for how
  // each piece is derived.
  subtotal_subunit: number;
  shipping_subunit: number;
  discount_subunit: number;
  // Echoes back the normalized (uppercase) code that was actually
  // applied — null if discount_code wasn't sent or resolved to nothing.
  discount_code: string | null;
  currency: string;
  email: string;
  public_key: string;
}

export const initializeCartPayment = (
  shippingAddress?: ApiShippingAddress,
  discountCode?: string,
): Promise<ApiPaymentInit> =>
  request('/payments/initialize', {
    method: 'POST',
    body: { mode: 'cart', shipping_address: shippingAddress, discount_code: discountCode },
    auth: true,
  });

export const initializeBuyNowPayment = (payload: {
  product_id: string;
  color?: string;
  size?: string;
  shipping_address?: ApiShippingAddress;
  discount_code?: string;
  source_video_post_id?: string;
}): Promise<ApiPaymentInit> =>
  request('/payments/initialize', {
    method: 'POST',
    body: { mode: 'buy_now', ...payload },
    auth: true,
  });

export const verifyPayment = (reference: string): Promise<ApiOrder[]> =>
  request('/payments/verify', { method: 'POST', body: { reference }, auth: true });

// ---- Discounts ----------------------------------------------------------------
// Read-only preview of what a code is worth, before anyone's paid
// anything — see /discounts/preview's own docstring on the backend for
// why this exists separately from the check initializeCartPayment/
// initializeBuyNowPayment already do. Same mode/product_id/quantity
// shape as the payment-initialize calls above, just without any of the
// payment-specific fields.

export interface ApiDiscountPreview {
  code: string;
  kind: 'percent' | 'fixed';
  subtotal: string;
  discount_amount: string;
  new_subtotal: string;
}

export const previewDiscount = (payload: {
  code: string;
  mode: 'cart' | 'buy_now';
  product_id?: string;
  quantity?: number;
}): Promise<ApiDiscountPreview> =>
  request('/discounts/preview', { method: 'POST', body: payload, auth: true });

// ---- Merchant ---------------------------------------------------------------

export const createMerchantAccount = (payload: {
  business_name: string;
  category: string;
  description?: string;
}): Promise<ApiMerchantAccount> => request('/merchant', { method: 'POST', body: payload, auth: true });

export const getMyMerchantAccount = (): Promise<ApiMerchantAccount> => request('/merchant/me', { auth: true });

export interface ApiBank {
  name: string;
  code: string;
}

// No auth needed — reference data, not scoped to anyone. Backs the bank
// picker in the payout-setup UI, since nobody actually knows Paystack's
// own numeric bank_code for their bank off the top of their head.
export const listBanks = (): Promise<ApiBank[]> => request('/merchant/banks');

// Two real Paystack calls happen behind this on the backend (resolve
// the account, then register it for transfers) — see routers/
// merchant.py's own comment. account_name in the response is what
// Paystack itself resolved, never something the merchant typed in.
export const addMerchantPayout = (bankCode: string, accountNumber: string): Promise<ApiMerchantAccount> =>
  request('/merchant/payout', {
    method: 'POST',
    body: { bank_code: bankCode, account_number: accountNumber },
    auth: true,
  });

// No dashboard UI edits any of these yet — kept in place for when one
// does, matching the backend's own MerchantAccountUpdate.
export const updateMerchantAccount = (payload: {
  business_name?: string;
  category?: string;
  description?: string;
}): Promise<ApiMerchantAccount> => request('/merchant/account', { method: 'PATCH', body: payload, auth: true });

// Owner-scoped, unlike the public listProducts above — the dashboard's
// Products tab and the Posts tab's product picker both read this.
export const listMyMerchantProducts = (): Promise<ApiProduct[]> => request('/merchant/products', { auth: true });

export const addMerchantProduct = (payload: {
  name: string;
  price: number;
  description?: string;
  colors?: string[];
  sizes?: string[];
  is_new?: boolean;
  banner_id?: string;
  image_urls?: string[];
  stock_quantity?: number | null;
  discount_percent?: number | null;
}): Promise<ApiProduct> => request('/merchant/products', { method: 'POST', body: payload, auth: true });

export const updateMerchantProduct = (
  productId: string,
  payload: Partial<{
    name: string;
    price: number;
    description: string;
    colors: string[];
    sizes: string[];
    is_new: boolean;
    banner_id: string;
    image_urls: string[];
    stock_quantity: number | null;
    discount_percent: number | null;
  }>,
): Promise<ApiProduct> => request(`/merchant/products/${productId}`, { method: 'PATCH', body: payload, auth: true });

export const deleteMerchantProduct = (productId: string): Promise<void> =>
  request(`/merchant/products/${productId}`, { method: 'DELETE', auth: true });

// SearchScreen.tsx. Real backend text search + pagination now, replacing
// what used to be a client-side .filter() over whatever
// products/shopPosts/discoverPosts happened to already be loaded for
// other screens entirely — see the backend route's own comment.
export interface ApiPersonResult {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  bio: string;
  following_count: number;
  followers_count: number;
  private_follow_lists: boolean;
  hide_mutual_followers: boolean;
}

export interface ApiSearchSection<T> {
  items: T[];
  total: number;
}

// A section is null when `filter` didn't ask for it, not when it
// matched zero results — see SearchResponse's own comment on the
// backend for why that distinction is kept all the way out here too.
export interface ApiSearchResponse {
  people: ApiSearchSection<ApiPersonResult> | null;
  products: ApiSearchSection<ApiProduct> | null;
  feed: ApiSearchSection<ApiVideoPost> | null;
  discover: ApiSearchSection<ApiVideoPost> | null;
}

export type SearchFilterKey = 'all' | 'people' | 'product' | 'feed' | 'discover';

export const search = (params: {
  q: string;
  filter?: SearchFilterKey;
  limit?: number;
  offset?: number;
}): Promise<ApiSearchResponse> => {
  const query = new URLSearchParams({ q: params.q });
  if (params.filter) query.set('filter', params.filter);
  if (params.limit) query.set('limit', String(params.limit));
  if (params.offset) query.set('offset', String(params.offset));
  return request(`/search?${query.toString()}`);
};


// ---- Twin search --------------------------------------------------------------

export interface ApiTwinPoolItem {
  video_post_id: string;
  start_ms: number;
  end_ms: number;
  label: string;
  product_name: string;
}

// Moments already held on a video's timeline. `mine` leaves out the given post's
// own twins (when editing it).
export const getTwinPool = (postId: string, mine = false): Promise<ApiTwinPoolItem[]> =>
  request(`/video-posts/${postId}/twin-pool?mine=${mine}`, { auth: true });

export interface ApiTwinConfig {
  min_twin_ms: number;
  max_request_clip_ms: number;
}

export const getTwinConfig = (): Promise<ApiTwinConfig> => request('/twin-config');

export type ApiTwinSearchStatus = 'matched' | 'not_found' | 'available' | 'fulfilled';

export interface ApiTwinSearchResult {
  product: ApiProduct;
  score: number;
  // twin: the seller tagged it on this moment; crowd: shoppers confirmed it there;
  // search: matched the description (and picture, when available).
  source: 'twin' | 'crowd' | 'search';
}

export interface ApiTwinSearch {
  id: string;
  query: string;
  status: ApiTwinSearchStatus;
  video_post_id: string | null;
  start_ms: number | null;
  end_ms: number | null;
  category_id: string | null;
  results: ApiTwinSearchResult[];
  // Only when results is empty: the nearest products we do have (not matches).
  closest: ApiTwinSearchResult[];
  message: string;
  created_at: string;
}

export interface ApiTwinSearchSummary {
  id: string;
  query: string;
  status: ApiTwinSearchStatus;
  video_post_id: string | null;
  start_ms: number | null;
  end_ms: number | null;
  matched_product: ApiProduct | null;
  created_at: string;
  notified_at: string | null;
}

// "What is this?" — describe it (and optionally clip the moment of a video it's
// from, with a still of that frame already uploaded) to find its twin in the catalog.
export const createTwinSearch = (payload: {
  query: string;
  category_id?: string | null;
  video_post_id?: string;
  start_ms?: number;
  end_ms?: number;
  box?: { x: number; y: number; w: number; h: number };
  box_at_ms?: number;
}): Promise<ApiTwinSearch> => request('/twin-search', { method: 'POST', body: payload, auth: true });

export const myTwinSearches = (status?: ApiTwinSearchStatus): Promise<ApiTwinSearchSummary[]> =>
  request(`/twin-search/mine${status ? `?status=${status}` : ''}`, { auth: true });

export const deleteTwinSearch = (id: string): Promise<void> =>
  request(`/twin-search/${id}`, { method: 'DELETE', auth: true });

// Tell the server which result the shopper went on to add to cart / buy: that is
// what teaches it which product is on screen at that moment of the video.
export const pickTwinSearchResult = (id: string, productId: string, action: 'cart' | 'buy'): Promise<ApiTwinSearchSummary> =>
  request(`/twin-search/${id}/pick`, { method: 'POST', body: { product_id: productId, action }, auth: true });

export interface ApiMomentProduct {
  product: ApiProduct;
  start_ms: number;
  end_ms: number;
  confirmations: number;
  source: 'twin' | 'crowd';
  // 0..1; 1 for a seller's own twin. Only trusted shopper-found links are returned.
  confidence?: number;
  link_id?: string | null;
  reviewed?: boolean;
}

export const getMomentProducts = (postId: string): Promise<ApiMomentProduct[]> =>
  request(`/video-posts/${postId}/moment-products`);

export interface ApiKeywordInsight {
  keyword: string;
  example: string;
  // null on the locked preview
  searchers: number | null;
  searches: number | null;
  unmet_searchers: number | null;
  last_searched_at: string | null;
}

export interface ApiKeywordInsights {
  locked: boolean;
  window_days: number;
  items: ApiKeywordInsight[];
}

export const getKeywordInsights = (days = 30, categoryId?: string): Promise<ApiKeywordInsights> =>
  request(`/merchant/insights/keywords?days=${days}${categoryId ? `&category_id=${categoryId}` : ''}`, { auth: true });

// ---- Wanted board -------------------------------------------------------------
// Unmet twin searches, public: what shoppers are asking for and nobody has twinned yet.

export type ApiWantedTab = 'trending' | 'new' | 'most_twinned' | 'mine' | 'fulfilled';

export interface ApiWantedItem {
  id: string;
  // The circled part of the frame, if the first shopper circled something.
  box?: { x: number; y: number; w: number; h: number } | null;
  box_at_ms?: number | null;
  query: string;
  count: number;
  status: 'open' | 'fulfilled';
  upvoted: boolean;
  notifying: boolean;
  has_clip: boolean;
  created_at: string;
  fulfilled_product: ApiProduct | null;
  // Products sellers twinned to it (what the compare list holds).
  twinned: number;
  // The moment, for the wall tile: a short clip shows as a still, a longer one loops.
  video_post_id: string | null;
  start_ms: number | null;
  end_ms: number | null;
  video_url: string | null;
  thumbnail_url: string | null;
  width: number | null;
  height: number | null;
  creator_name: string | null;
  creator_avatar_url: string | null;
  // Photos of the first few twins (official first), for the stack on the tile.
  twin_previews: string[];
}

export interface ApiWantedList {
  open_count: number;
  items: ApiWantedItem[];
}

export interface ApiWantedDetail extends ApiWantedItem {
  events: { kind: 'wanted' | 'listed'; at: string }[];
}

export const listWanted = (tab: ApiWantedTab, offset = 0): Promise<ApiWantedList> =>
  request(`/wanted?tab=${tab}&offset=${offset}`, { auth: true });

// Requests already on the wall for this moment of a video ("join before you create").
export const getWantedNearby = (
  videoPostId: string,
  startMs: number,
  endMs: number,
  q = '',
  box?: { x: number; y: number; w: number; h: number } | null,
): Promise<ApiWantedItem[]> =>
  request(
    `/wanted/nearby?video_post_id=${encodeURIComponent(videoPostId)}&start_ms=${Math.round(startMs)}&end_ms=${Math.round(endMs)}&q=${encodeURIComponent(q)}${box ? `&bx=${box.x}&by=${box.y}&bw=${box.w}&bh=${box.h}` : ''}`,
    { auth: true },
  );

export interface ApiMomentHints {
  asked: number;
  circled: number;
  words: { word: string; count: number }[];
}

// What others did on this moment: counts and shared words only, never who.
export const getMomentHints = (
  videoPostId: string,
  startMs: number,
  endMs: number,
  box?: { x: number; y: number; w: number; h: number } | null,
): Promise<ApiMomentHints> =>
  request(
    `/wanted/suggest?video_post_id=${encodeURIComponent(videoPostId)}&start_ms=${Math.round(startMs)}&end_ms=${Math.round(endMs)}${box ? `&bx=${box.x}&by=${box.y}&bw=${box.w}&bh=${box.h}` : ''}`,
    { auth: true },
  );

// "Requests you can answer": open requests on the wall that one of the seller's own products
// already fits, best fit first. Free for every seller; answer each with the Twin it sheet.
export interface ApiWantedLead {
  request: ApiWantedItem;
  product: ApiProduct;
  match: ApiTwinMatch;
}

export const getWantedLeads = (): Promise<ApiWantedLead[]> => request('/wanted/leads', { auth: true });

export const getWanted = (id: string): Promise<ApiWantedDetail> => request(`/wanted/${id}`, { auth: true });

// "Me too". If a twin already exists the server says so (matches) instead of adding to the wait.
export const upvoteWanted = (id: string): Promise<{ item: ApiWantedDetail; matches: ApiProduct[] }> =>
  request(`/wanted/${id}/upvote`, { method: 'POST', auth: true });

// null when withdrawing removed the request altogether (you were the only one).
export const removeWantedUpvote = (id: string): Promise<ApiWantedDetail | null> =>
  request(`/wanted/${id}/upvote`, { method: 'DELETE', auth: true });

export const setWantedNotify = (id: string, notify: boolean): Promise<ApiWantedDetail> =>
  request(`/wanted/${id}/notify`, { method: 'PUT', body: { notify }, auth: true });

// A seller says "I have this": shoppers still waiting are told once and shown the product.
export const offerForWanted = (id: string, productId: string): Promise<{ notified: number }> =>
  request(`/wanted/${id}/offer`, { method: 'POST', body: { product_id: productId }, auth: true });

// ---- Twins of a wanted moment: compare list, "Twin it", reports -------------------

export type ApiTwinMatch = 'strong' | 'good' | 'partial' | 'weak';

export interface ApiTwinOption {
  product: ApiProduct;
  // official: the video's own poster; confirmed: shoppers kept it (or the poster approved
  // it); offered: a seller says it fits and nothing more.
  kind: 'official' | 'confirmed' | 'offered';
  // Only true when an official twin exists and this isn't it.
  similar: boolean;
  match: ApiTwinMatch;
  kept: number;
  seller_name: string | null;
  mine: boolean;
}

export interface ApiWantedTwins {
  items: ApiTwinOption[];
  has_official: boolean;
}

export interface ApiTwinChoice {
  product: ApiProduct;
  match: ApiTwinMatch;
  twinned: boolean;
}

export type ApiTwinReportReason = 'counterfeit' | 'likeness' | 'mismatch' | 'ownership';

export const getWantedTwins = (id: string): Promise<ApiWantedTwins> => request(`/wanted/${id}/twins`, { auth: true });

// The seller's own products for the "Twin it" sheet, best match first.
export const getMyTwinChoices = (id: string): Promise<ApiTwinChoice[]> =>
  request(`/wanted/${id}/my-products`, { auth: true });

export const twinItForWanted = (id: string, productId: string): Promise<{ notified: number; option: ApiTwinOption }> =>
  request(`/wanted/${id}/twin`, { method: 'POST', body: { product_id: productId }, auth: true });

export const withdrawWantedTwin = (id: string, productId: string): Promise<void> =>
  request(`/wanted/${id}/twin/${productId}`, { method: 'DELETE', auth: true });

export const reportWantedTwin = (
  id: string,
  productId: string,
  reason: ApiTwinReportReason,
  detail?: string,
): Promise<void> =>
  request(`/wanted/${id}/twins/${productId}/report`, { method: 'POST', body: { reason, detail }, auth: true });

// ---- Creator: impact and the inbox of twins on their videos ------------------------

export interface ApiCreatorMoment {
  request_id: string;
  query: string;
  wants: number;
  twinned: number;
  video_post_id: string;
  thumbnail_url: string | null;
  start_ms: number | null;
  end_ms: number | null;
  mine: boolean;
}

export interface ApiCreatorImpact {
  wanted: number;
  twins_offered: number;
  twins_approved: number;
  can_tag: boolean;
  moments: ApiCreatorMoment[];
}

export type ApiCreatorTwinState = 'review' | 'approved' | 'hidden';

export interface ApiCreatorTwin {
  link_id: string;
  video_post_id: string;
  product: ApiProduct;
  seller_name: string | null;
  new_seller: boolean;
  for_query: string | null;
  match: ApiTwinMatch | null;
  kept: number;
  state: ApiCreatorTwinState;
  start_ms: number;
  end_ms: number;
}

export interface ApiCreatorTwins {
  review: number;
  approved: number;
  hidden: number;
  items: ApiCreatorTwin[];
}

export const getCreatorImpact = (): Promise<ApiCreatorImpact> => request('/creator/impact', { auth: true });

export const getCreatorTwins = (state: ApiCreatorTwinState): Promise<ApiCreatorTwins> =>
  request(`/creator/twins?state=${state}`, { auth: true });

// The poster's call on a twin of their own video: confirm (approve), reject (hide), or
// clear (hand it back to the evidence).
export const reviewMomentLink = (
  postId: string,
  linkId: string,
  decision: 'confirm' | 'reject' | 'clear',
): Promise<void> =>
  request(`/video-posts/${postId}/moment-products/${linkId}/review`, {
    method: 'POST',
    body: { decision },
    auth: true,
  });
