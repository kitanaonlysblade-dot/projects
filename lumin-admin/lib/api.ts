// Thin fetch wrapper for the same lumin-backend FastAPI server the
// consumer app (lumin-app) talks to — this is a second client against
// that one backend, not a separate API. Every function here mirrors one
// route from app/routers/admin.py, reports.py, or the appeal/dispute
// additions to users.py/orders.py.
//
// Field names below are snake_case on purpose, matching exactly what
// the backend's Pydantic schemas serialize — this app skips the
// camelCase-adapter layer lumin-app has (see that project's
// lib/adapters.ts) since an internal ops tool reading snake_case
// straight off the wire in its own JSX is a fine tradeoff for one less
// layer of files to keep in sync, in a way it wouldn't be for a
// consumer-facing app.

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

// ---- Auth token storage ------------------------------------------------

const TOKEN_KEY = 'lumin_admin_token';

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

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; auth?: boolean; form?: boolean } = {},
): Promise<T> {
  const { method = 'GET', body, auth = false, form = false } = options;
  const headers: Record<string, string> = {};

  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let requestBody: BodyInit | undefined;
  if (body !== undefined) {
    if (form) {
      // Only login needs this — OAuth2's password flow is
      // form-encoded by spec, not JSON, regardless of what the rest of
      // the API uses.
      requestBody = new URLSearchParams(body as Record<string, string>);
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    } else {
      requestBody = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
    }
  }

  const response = await fetch(`${API_BASE_URL}${path}`, { method, headers, body: requestBody });

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const data = await response.json();
      if (typeof data.detail === 'string') detail = data.detail;
    } catch {
      // Response body wasn't JSON — fall back to the status text.
    }
    throw new ApiError(response.status, detail);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

// ---- Auth ---------------------------------------------------------------

export interface ApiUser {
  id: string;
  email: string;
  username: string;
  display_name: string;
  role: 'user' | 'admin';
  is_active: boolean;
  ban_reason: string | null;
  banned_at: string | null;
  is_shadow_banned: boolean;
}

export interface ApiTokenWithUser {
  access_token: string;
  token_type: string;
  user: ApiUser;
}

// Same route the consumer app logs into — there's no separate admin
// login endpoint. login() itself doesn't check `user.role`; the caller
// (app/login/page.tsx) does, right after, and refuses to store the
// token at all for a non-admin account rather than silently letting
// them in to a console where every actual data call would just 403.
export function login(email: string, password: string): Promise<ApiTokenWithUser> {
  return request('/auth/login', { method: 'POST', body: { username: email, password }, form: true });
}

export const getMe = (): Promise<ApiUser> => request('/auth/me', { auth: true });

// ---- Two-step login (authenticator app) ---------------------------------
// The password login token cannot call admin routes. /auth/mfa/verify (or /enable on first set-up) trades
// it for one that can. Backend: app/routers/mfa.py.
export interface MfaStatus {
  enabled: boolean;
  required: boolean;
  session_ok: boolean;
}

export const getMfaStatus = (): Promise<MfaStatus> => request('/auth/mfa/status', { auth: true });
export const startMfaSetup = (): Promise<{ secret: string; uri: string }> =>
  request('/auth/mfa/setup', { method: 'POST', auth: true });
export const enableMfa = (code: string): Promise<ApiTokenWithUser> =>
  request('/auth/mfa/enable', { method: 'POST', body: { code }, auth: true });
export const verifyMfa = (code: string): Promise<ApiTokenWithUser> =>
  request('/auth/mfa/verify', { method: 'POST', body: { code }, auth: true });

// ---- Users / bans ---------------------------------------------------

export const listUsers = (params: { q?: string; limit?: number; offset?: number } = {}): Promise<ApiUser[]> => {
  const query = new URLSearchParams();
  if (params.q) query.set('q', params.q);
  if (params.limit) query.set('limit', String(params.limit));
  if (params.offset) query.set('offset', String(params.offset));
  return request(`/admin/users?${query.toString()}`, { auth: true });
};

export const banUser = (userId: string, reason?: string): Promise<ApiUser> =>
  request(`/admin/users/${userId}/ban`, { method: 'POST', body: { reason: reason ?? null }, auth: true });

export const unbanUser = (userId: string): Promise<ApiUser> =>
  request(`/admin/users/${userId}/unban`, { method: 'POST', auth: true });

// Deliberately separate from ban/unban above, not a variant — see
// User.is_shadow_banned's own comment on the backend. No reason field:
// unlike a ban, a shadow ban is never shown to the account it's
// applied to, so there's nothing for a "reason" to be shown alongside.
export const shadowBanUser = (userId: string): Promise<ApiUser> =>
  request(`/admin/users/${userId}/shadow-ban`, { method: 'POST', auth: true });

export const unshadowBanUser = (userId: string): Promise<ApiUser> =>
  request(`/admin/users/${userId}/unshadow-ban`, { method: 'POST', auth: true });

// ---- Appeals -------------------------------------------------------------

export type AppealStatus = 'pending' | 'approved' | 'denied';

export interface ApiAppeal {
  id: string;
  user_id: string;
  message: string;
  status: AppealStatus;
  admin_response: string | null;
  created_at: string;
}

export const listAppeals = (status?: AppealStatus): Promise<ApiAppeal[]> => {
  const query = status ? `?status=${status}` : '';
  return request(`/admin/appeals${query}`, { auth: true });
};

export const resolveAppeal = (
  appealId: string,
  payload: { status: 'approved' | 'denied'; admin_response?: string },
): Promise<ApiAppeal> =>
  request(`/admin/appeals/${appealId}`, { method: 'PATCH', body: payload, auth: true });

// ---- Reports --------------------------------------------------------

export type ReportTargetType = 'video_post' | 'product' | 'user';
export type ReportReason = 'spam' | 'counterfeit' | 'inappropriate' | 'harassment' | 'copied' | 'other';
export type ReportStatus = 'pending' | 'reviewed' | 'actioned';

export interface ApiReport {
  id: string;
  target_type: ReportTargetType;
  target_id: string;
  reason: ReportReason;
  detail: string | null;
  status: ReportStatus;
  resolution_note: string | null;
  created_at: string;
}

export const listReports = (
  params: { status?: ReportStatus; limit?: number; offset?: number } = {},
): Promise<ApiReport[]> => {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  if (params.limit) query.set('limit', String(params.limit));
  if (params.offset) query.set('offset', String(params.offset));
  return request(`/admin/reports?${query.toString()}`, { auth: true });
};

export const resolveReport = (
  reportId: string,
  payload: { status: 'reviewed' | 'actioned'; resolution_note?: string },
): Promise<ApiReport> =>
  request(`/admin/reports/${reportId}`, { method: 'PATCH', body: payload, auth: true });

// ---- Return claims / disputes ----------------------------------------

export type ReturnClaimStatus = 'pending_review' | 'refunded' | 'denied';

export interface ApiReturnClaim {
  id: string;
  order_id: string;
  video_url: string;
  reason: string | null;
  reasons?: string[];
  status: ReturnClaimStatus;
  seller_response: string | null;
  resolution_note: string | null;
  resolved_at: string | null;
  created_at: string;
  auto_resolved?: boolean;
  appeal_by?: string | null;
  appeal_note?: string | null;
  appealed_at?: string | null;
  appeal_outcome?: string | null;
  // What the seller's live test did and didn't show: a suggestion for the reviewer, who decides.
  coverage?: {
    has_test: boolean;
    serial: string | null;
    seller_showed: string[];
    covered: string[];
    not_covered: string[];
    needs_review: string[];
    suggestion: 'deny' | 'refund' | 'review';
    summary: string;
    seal_intact_at_delivery: boolean | null;
    risk_flags?: string[];
    seller_video_url?: string | null;
    seller_video_s?: number | null;
  } | null;
}

export const listReturnClaims = (status?: ReturnClaimStatus): Promise<ApiReturnClaim[]> => {
  const query = status ? `?status=${status}` : '';
  return request(`/admin/return-claims${query}`, { auth: true });
};

export const resolveReturnClaim = (
  claimId: string,
  payload: { approve: boolean; resolution_note?: string },
): Promise<ApiReturnClaim> =>
  request(`/admin/return-claims/${claimId}`, { method: 'PATCH', body: payload, auth: true });

// ---- Content removal --------------------------------------------------
// No dedicated admin "list all products/posts" endpoint — the content
// page reuses the same public GET /search every consumer's search bar
// already hits (it's public data either way), and only the actual
// DELETE is admin-only.

export interface ApiProductResult {
  id: string;
  name: string;
  price: string;
  images: { url: string }[];
}

export interface ApiVideoPostResult {
  id: string;
  description: string;
  poster_display_name: string;
}

export interface ApiSearchResponse {
  products: { items: ApiProductResult[]; total: number } | null;
  feed: { items: ApiVideoPostResult[]; total: number } | null;
  discover: { items: ApiVideoPostResult[]; total: number } | null;
}

export const searchContent = (q: string): Promise<ApiSearchResponse> => {
  const query = new URLSearchParams({ q, filter: 'all', limit: '20' });
  return request(`/search?${query.toString()}`);
};

export const removeProduct = (productId: string, reason?: string): Promise<void> => {
  const query = reason ? `?reason=${encodeURIComponent(reason)}` : '';
  return request(`/admin/products/${productId}${query}`, { method: 'DELETE', auth: true });
};

export const removeVideoPost = (videoPostId: string, reason?: string): Promise<void> => {
  const query = reason ? `?reason=${encodeURIComponent(reason)}` : '';
  return request(`/admin/video-posts/${videoPostId}${query}`, { method: 'DELETE', auth: true });
};

// ---- Twin review ----------------------------------------------------
// Merchants pair each tagged product with when it appears in their video.
// Posts are live while twins wait here for a check.

export interface ApiTwinReview {
  id: string;
  video_post_id: string;
  video_url: string | null;
  thumbnail_url: string | null;
  poster_name: string;
  product_id: string;
  product_name: string;
  product_images?: string[];
  product_price?: number | null;
  label: string;
  start_ms: number;
  end_ms: number;
  review_status: 'pending' | 'approved' | 'flagged';
  created_at: string;
}

export const listTwins = (status: 'pending' | 'approved' | 'flagged' = 'pending', limit = 50, offset = 0): Promise<ApiTwinReview[]> =>
  request(`/admin/twins?status=${status}&limit=${limit}&offset=${offset}`, { auth: true });

export const reviewTwin = (id: string, status: 'approved' | 'flagged', reason?: string): Promise<ApiTwinReview> =>
  request(`/admin/twins/${id}`, { method: 'PATCH', body: { status, reason: reason || null }, auth: true });

export interface ApiTwinStats {
  days: number;
  series: { date: string; twins_created: number; searches: number; searches_not_found: number; searches_picked: number }[];
  totals: { twins_created: number; searches: number; searches_not_found: number; searches_picked: number };
  // Share of searches that found at least one twin / ended in a cart add or buy.
  match_rate: number | null;
  pick_rate: number | null;
  flag_rate: number | null;
  pending_review: number;
  // Shoppers waiting for a product right now.
  waiting_searches: number;
}

export const getTwinStats = (days = 30): Promise<ApiTwinStats> => request(`/admin/twin-stats?days=${days}`, { auth: true });

export interface ApiScanStats {
  days: number;
  totals: { scans: number; found: number; missed: number };
  found_rate: number | null;
  avg_clip_s: number | null;
  by_stage: { stage: string; count: number }[];
  top_videos: { video_post_id: string; scans: number; caption: string }[];
  series: { date: string; scans: number; found: number; missed: number }[];
  recent: { at: string | null; found: boolean; stage: string | null; clip_s: number | null; video_post_id: string | null }[];
}

export interface ApiCopyReview {
  id: string;
  stage: string;
  status: 'open' | 'dismissed' | 'confirmed';
  note: string | null;
  created_at: string;
  resolved_at: string | null;
  later: { id: string; poster_id: string; poster_display_name: string; description: string; created_at: string };
  earlier: { id: string; poster_id: string; poster_display_name: string; description: string; created_at: string };
}

export const listCopyReviews = (status: 'open' | 'dismissed' | 'confirmed' = 'open'): Promise<ApiCopyReview[]> =>
  request(`/scan/flags?status=${status}`, { auth: true });

export const resolveCopyReview = (id: string, status: 'dismissed' | 'confirmed', note?: string): Promise<ApiCopyReview> =>
  request(`/scan/flags/${id}/resolve`, { method: 'POST', body: { status, note: note || null }, auth: true });

export const getScanStats = (days = 30): Promise<ApiScanStats> => request(`/admin/scan-stats?days=${days}`, { auth: true });

// ---- Analytics ------------------------------------------------------

export type AnalyticsPeriod = 'day' | 'month' | 'year';

export interface ApiAnalyticsPoint {
  period_start: string;
  order_count: number;
  // A string, not a number — Pydantic serializes Decimal fields as
  // strings to preserve precision. Callers that need to chart this
  // (see app/dashboard/page.tsx) must convert it themselves.
  revenue: string;
}

export interface ApiTopProduct {
  product_id: string;
  name: string;
  units_sold: number;
  // A string, same Decimal-serialization reason as ApiAnalyticsPoint's
  // own comment above — fine to interpolate directly into JSX here
  // since nothing charts this one, just displays it.
  revenue: string;
}

export interface ApiTrendingPost {
  video_post_id: string;
  description: string;
  poster_display_name: string;
  likes_count: number;
  comments_count: number;
  shares_count: number;
  saves_count: number;
  engagement_total: number;
}

export interface ApiTrafficPoint {
  period_start: string;
  source: string;
  session_count: number;
}

export const getAnalyticsSummary = (period: AnalyticsPeriod = 'day'): Promise<ApiAnalyticsPoint[]> =>
  request(`/admin/analytics/summary?period=${period}`, { auth: true });

export const getTopProducts = (limit = 10): Promise<ApiTopProduct[]> =>
  request(`/admin/analytics/top-products?limit=${limit}`, { auth: true });

export const getTrendingPosts = (limit = 10): Promise<ApiTrendingPost[]> =>
  request(`/admin/analytics/trending-posts?limit=${limit}`, { auth: true });

export const getTrafficAnalytics = (period: AnalyticsPeriod = 'day'): Promise<ApiTrafficPoint[]> =>
  request(`/admin/analytics/traffic?period=${period}`, { auth: true });

// ---- Background jobs (backend app/jobs.py) ----
export interface ApiJobQueue {
  counts: { queued: number; running: number; done: number; failed: number };
  oldest_queued_at: string | null;
  recent_failures: { id: string; kind: string; payload: Record<string, unknown>; attempts: number; error: string | null; finished_at: string | null }[];
}
export const getJobQueue = (): Promise<ApiJobQueue> => request('/admin/jobs', { auth: true });

// ---- Seller verification (backend app/routers/verification.py) ----
export interface ApiVerification {
  id: string;
  merchant_id: string;
  business_name: string;
  owner_email: string;
  legal_name: string;
  doc_type: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  document_url: string | null; // expires after a few minutes
  selfie_url: string | null;
  note: string | null;
}
export const listVerifications = (status: 'pending' | 'approved' | 'rejected' = 'pending'): Promise<ApiVerification[]> =>
  request(`/admin/verifications?status=${status}`, { auth: true });
export const reviewVerification = (id: string, approve: boolean, note?: string): Promise<ApiVerification> =>
  request(`/admin/verifications/${id}/review`, { method: 'POST', body: { approve, note: note ?? null }, auth: true });
export const unverifyMerchant = (merchantId: string): Promise<void> =>
  request(`/admin/merchants/${merchantId}/unverify`, { method: 'POST', auth: true });


// ---- Content moderation (backend app/screening.py, routers/admin_moderation.py) ----
export interface ApiModerationItem {
  id: string;
  target_type: 'video_post' | 'comment' | 'user' | 'product';
  target_id: string;
  owner_username: string | null;
  owner_removed_count: number;
  source: 'text' | 'media' | 'reports';
  category: string;
  score: number | null;
  detail: string | null;
  severity: 'review' | 'held';
  status: 'pending' | 'approved' | 'removed';
  resolution_note: string | null;
  created_at: string;
  preview: { kind?: string; video_url?: string | null; thumbnail_url?: string | null; images?: string[]; text?: string; by?: string | null; held?: boolean };
}
export interface ApiModerationSummary {
  pending: number;
  pending_held: number;
  approved: number;
  removed: number;
  terms: number;
  picture_checks_on: boolean;
}
export interface ApiModerationTerm {
  id: string;
  term: string;
  action: 'block' | 'flag';
}
export const getModerationSummary = (): Promise<ApiModerationSummary> => request('/admin/moderation/summary', { auth: true });
export const listModerationItems = (status: 'pending' | 'approved' | 'removed' = 'pending'): Promise<ApiModerationItem[]> =>
  request(`/admin/moderation/items?status=${status}`, { auth: true });
export const decideModerationItem = (id: string, action: 'approve' | 'remove', note?: string): Promise<ApiModerationItem> =>
  request(`/admin/moderation/items/${id}/${action}`, { method: 'POST', body: { note: note || null }, auth: true });
export const listModerationTerms = (): Promise<ApiModerationTerm[]> => request('/admin/moderation/terms', { auth: true });
export const addModerationTerm = (term: string, action: 'block' | 'flag'): Promise<ApiModerationTerm> =>
  request('/admin/moderation/terms', { method: 'POST', body: { term, action }, auth: true });
export const deleteModerationTerm = (id: string): Promise<void> => request(`/admin/moderation/terms/${id}`, { method: 'DELETE', auth: true });

// ---- Tamper-proof bags (app/routers/seals.py, /admin/seals) ----
export interface ApiSealBatch {
  id: string;
  label: string | null;
  count: number;
  created_at: string;
  by_status: Record<string, number>;
}

export interface ApiSealEvent {
  from_status: string | null;
  to_status: string;
  note: string | null;
  created_at: string;
}

export interface ApiLiveTestEvidence {
  id: string;
  order_id: string;
  seller_id: string;
  serial: string | null;
  bag_status: string | null;
  status: string;
  order_code: string;
  started_at: string;
  sealed_at: string | null;
  claimed_duration_s: number | null;
  video_sha256: string | null;
  video_url: string | null;
  checklist: string[];
  note: string | null;
  events: ApiSealEvent[];
}

export const listSealBatches = (): Promise<ApiSealBatch[]> => request('/admin/seals/batches', { auth: true });
export const assignSealBatch = (id: string, seller_id: string): Promise<{ assigned: number }> =>
  request(`/admin/seals/batches/${id}/assign`, { method: 'POST', body: { seller_id }, auth: true });
export const listLiveTests = (orderId?: string): Promise<ApiLiveTestEvidence[]> =>
  request(`/admin/seals/tests${orderId ? `?order_id=${encodeURIComponent(orderId)}` : ''}`, { auth: true });
export const voidSealBag = (serial: string, reason: string): Promise<{ serial: string; status: string }> =>
  request(`/admin/seals/bags/${encodeURIComponent(serial)}/void`, { method: 'POST', body: { reason }, auth: true });

/** Make a batch and download its print-ready PDF. The codes are readable only in this file, so it saves straight away. */
export async function createSealBatch(body: { count: number; label?: string; seller_id?: string }): Promise<string> {
  const token = getToken();
  const response = await fetch(`${API_BASE_URL}/admin/seals/batches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    let detail = response.statusText;
    try {
      const data = await response.json();
      if (typeof data.detail === 'string') detail = data.detail;
    } catch {
      /* not JSON */
    }
    throw new ApiError(response.status, detail);
  }
  const name = /filename="([^"]+)"/.exec(response.headers.get('Content-Disposition') ?? '')?.[1] ?? 'lumin-seals.pdf';
  const url = URL.createObjectURL(await response.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return name;
}

// ---- Shipments of sealed orders: the manual courier (app/routers/shipments.py, /admin/shipments) ----
export type ShipmentStatus = 'awaiting_pickup' | 'in_transit' | 'delivered' | 'refused' | 'lost' | 'closed';
export interface ApiShipment {
  id: string;
  order_id: string;
  serial: string | null;
  status: ShipmentStatus;
  courier: string;
  driver_name: string | null;
  picked_up_at: string | null;
  arrived_at: string | null;
  seal_intact: boolean | null;
  refusal_note: string | null;
  delivered_at: string | null;
  created_at: string;
  product_name: string | null;
  refusal_photo_url?: string | null;
  stalled?: boolean;
  resolution?: string | null;
  loss_party?: string | null;
}
export const listShipments = (status?: ShipmentStatus): Promise<ApiShipment[]> =>
  request(`/admin/shipments${status ? `?status=${status}` : ''}`, { auth: true });
export const shipmentPickup = (id: string, driver_name?: string): Promise<ApiShipment> =>
  request(`/admin/shipments/${id}/pickup`, { method: 'POST', body: { driver_name }, auth: true });
export const shipmentConfirm = (id: string, otp: string): Promise<ApiShipment> =>
  request(`/admin/shipments/${id}/confirm`, { method: 'POST', body: { otp }, auth: true });

export interface ApiPackOrder {
  order_id: string;
  product_name: string;
  buyer_name: string;
  pack_size: number;
  serials: string[];
  status: string;
  created_at: string;
}
export const getSealStock = (): Promise<{ free_bags: number }> => request('/admin/seals/stock', { auth: true });
export const listPackOrders = (): Promise<ApiPackOrder[]> => request('/admin/seals/pack-orders', { auth: true });
export const assignPackOrder = (orderId: string): Promise<{ complete: boolean; serials: string[] }> =>
  request(`/admin/seals/pack-orders/${orderId}/assign`, { method: 'POST', auth: true });
export const setPackSize = (productId: string, pack_size: number | null): Promise<{ name: string; pack_size: number | null }> =>
  request(`/admin/seals/products/${productId}`, { method: 'PATCH', body: { pack_size }, auth: true });
export const resolveShipment = (
  id: string,
  body: { action: 'refund' | 'redeliver' | 'lost'; loss_party?: 'courier' | 'seller' | 'platform'; note?: string },
): Promise<ApiShipment> => request(`/admin/shipments/${id}/resolve`, { method: 'POST', body, auth: true });

export interface ApiRisk {
  sellers: { user_id: string; name: string | null; orders: number; claims: number; refunded: number; refusals: number; flags: string[] }[];
  pairs: { buyer_id: string; seller_id: string; buyer_name: string | null; seller_name: string | null; orders: number; flags: string[] }[];
  buyers: { buyer_id: string; name: string | null; claims: number; flags: string[] }[];
}
export const getRisk = (): Promise<ApiRisk> => request('/admin/seals/risk', { auth: true });

export const ruleOnAppeal = (claimId: string, payload: { overturn: boolean; note?: string }): Promise<ApiReturnClaim> =>
  request(`/admin/return-claims/${claimId}/appeal`, { method: 'POST', body: payload, auth: true });
