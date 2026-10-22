# Lumin backend

FastAPI + SQLAlchemy backend for the Lumin frontend — models, schemas,
auth, and routes mapped straight from `lib/types.ts` and `page.tsx`'s
handlers.

## What's here

```
app/
  main.py           FastAPI app — wires every router together
  database.py       engine + session (reads DATABASE_URL)
  models/
    base.py         Base, TimestampMixin, uuid_pk()
    user.py         User, follows
    merchant.py      MerchantAccount
    catalog.py       Category, CategoryBanner, Deal, Product, ProductImage
    video.py         VideoPost, Comment, Interest, + their join tables
    commerce.py       CartItem, Order, Payment
    notification.py   Notification
  schemas/          Pydantic request/response models, one file per group
                     above (Base/Create/Read/Update per entity)
  auth/             JWT + password hashing
    security.py      hash_password, verify_password, create/decode_access_token
    dependencies.py  get_current_user — add to any route that needs a logged-in user
  routers/          FastAPI routes
    auth.py          POST /auth/signup, /auth/login, /auth/google, GET /auth/me
    categories.py    GET /categories, /categories/{id}/banners, /deals
    deals.py         GET /deals
    products.py      GET /products, /products/{id}
    interests.py     GET /interests
    video_posts.py   GET/POST /video-posts, PATCH/DELETE /{id},
                     GET /video-posts/watchlist, /likes, /shares (all
                     three are the current user's own list — must stay
                     registered ahead of /{id} below them, see the
                     comment on that route),
                     GET/POST /{id}/comments,
                     POST/DELETE /{id}/watchlist, /like, /share
    search.py        GET /search?q=...&filter=all|people|product|feed|
                     discover&limit=&offset= — real backend text search
                     + pagination for SearchScreen.tsx, replacing what
                     used to be a client-side .filter() over whatever
                     was already loaded for other screens; see that
                     route's own comment
    cart.py          GET/POST /cart, PATCH/DELETE /cart/{id}
    orders.py        POST /orders, POST /orders/checkout, GET /orders/me,
                     GET /orders/selling, PATCH /orders/{id}/status,
                     POST /orders/{id}/cancel, /confirm-receipt,
                     /report-defect, GET /orders/{id}/return-claim,
                     POST /orders/{id}/return-claim/respond (the
                     seller's rebuttal — see "Disputes" below)
    payments.py      POST /payments/initialize, /payments/verify,
                     /payments/webhook — Paystack payments (card, bank transfer); see
                     "Payments" below
    discounts.py     POST /discounts/preview — see "Discount codes" below
    merchant.py      POST /merchant, GET /merchant/me,
                     POST /merchant/products, PATCH/DELETE /merchant/products/{id}
    uploads.py       POST /uploads — returns {"url": "..."} for a real,
                     persistent file; see "File uploads" below
    users.py         GET/POST/DELETE /users/{id}/follow — follow status,
                     follow, unfollow. PATCH /users/me — profile edits
                     (display name/bio) and the Settings screen's
                     autoplay/mute toggles; see UserUpdate's own comment
                     on the two fields it accepts that neither screen
                     sends yet. POST/GET /users/me/appeal(s) — a banned
                     account's own appeal, reachable while suspended
                     (get_current_user, not get_current_active_user —
                     see "Moderation" below). No "get user by id" route
                     exists (nothing
                     on the frontend needs one yet — poster profiles are
                     still
                     assembled client-side from post data, see
                     PosterProfileScreen.tsx's own comment)
    reports.py       POST /reports — any active user reporting a video
                     post, product, or account; see "Moderation" below
    traffic.py       POST /traffic — session-start acquisition tracking
                     (referrer/UTM), no auth required; see "Moderation"
                     below
    admin.py         Everything gated by get_current_admin — user
                     search/ban/unban, appeal + report review, product/
                     video-post removal, return-claim resolution, and
                     platform analytics. See "Moderation" below
alembic/             migration environment, wired to app.models.Base
```

Every model has a comment pointing at the frontend type/component it
maps to, and calling out anywhere the real schema had to make a
decision the TS interface didn't need to (e.g. UUID ids instead of the
mock's plain strings, `follows`/`watchlist_items` as tables instead of
stored counts). Each `*Read` schema sets
`model_config = ConfigDict(from_attributes=True)` so it builds straight
from an ORM object; each `*Create` schema only accepts what a client
should actually be trusted to send — `OrderCreate` takes a `product_id`
but not a price, since the price comes from the product server-side.

## Setup

```bash
pip install -r requirements.txt

export DATABASE_URL=postgresql+psycopg2://user:password@localhost:5432/lumin
export JWT_SECRET_KEY=$(openssl rand -hex 32)   # generate once, keep stable across restarts
export R2_ACCOUNT_ID=...   # Cloudflare dashboard → R2 → Overview (right-hand side)
export R2_ACCESS_KEY_ID=...        # R2 → Manage API tokens → Create API token
export R2_SECRET_ACCESS_KEY=...    # shown once, when that token is created — save it then
export R2_BUCKET_NAME=lumin-media  # the bucket these tokens are scoped to
export R2_PUBLIC_BASE_URL=https://pub-xxxxxxxx.r2.dev   # that bucket's public access URL (or a custom domain mapped to it) — see "File uploads" below
export PAYSTACK_SECRET_KEY=sk_test_...   # from the Paystack dashboard — never expose this one to the frontend
export PAYSTACK_PUBLIC_KEY=pk_test_...   # safe to hand back to the frontend; /payments/initialize does this
export PAYSTACK_CURRENCY=USD   # optional — defaults to USD, matching the "$" prices shown everywhere on the frontend
export GOOGLE_CLIENT_ID=...apps.googleusercontent.com   # OAuth client ID from Google Cloud Console — see "Google sign-in" below
export RESEND_API_KEY=re_...   # optional — from the Resend dashboard; without it, order confirmations and password-reset emails are silently skipped (logged, not an error) rather than blocking anything
export EMAIL_FROM="Lumin <onboarding@resend.dev>"   # optional — defaults to Resend's own sandbox sender; needs a domain verified with Resend for a real deployment
export FRONTEND_URL=http://localhost:3000   # optional — defaults to the local Next.js dev server; used to build the link inside password-reset emails

alembic revision --autogenerate -m "initial schema"
alembic upgrade head

python -m app.seed
# → inserts a representative copy of lib/data.ts (72 catalog products
#   across 12 category banners, both video feeds, sample comments, a
#   demo merchant). Idempotent — running it again is a no-op if data
#   already exists. Prints the demo login on success:
#     you@example.com / password123
#     demo-merchant@example.com / password123  (has a merchant account)

uvicorn app.main:app --reload
# → http://localhost:8000/docs for interactive Swagger UI, including a
#   working "Authorize" button once you've signed up a user
```

## Routes — reads, auth, and writes are all live now

Every write route requires a logged-in user via `Depends(get_current_user)`
— cart, checkout, comments, watchlist, and the merchant-only product/post
CRUD all check that first. A few things worth knowing:

- **`Product.cart_count` is never auto-bumped by cart writes.** The
  frontend's equivalent (`productActivity` in page.tsx) is explicitly a
  session-only, shop-feed-only heuristic that ignores the real seed
  value — not something worth reconstructing exactly. A live "in N
  carts" number is better computed with a query
  (`count(distinct user_id) from cart_items where product_id = ...`)
  than maintained as a manually-bumped counter.
- **Checkout (`POST /orders/checkout`) expands quantity into separate
  orders**, same as the frontend's `Array.from({length: quantity})` —
  a cart line with quantity 3 becomes 3 Order rows, then the cart is
  cleared, all in one transaction.
- **Shop vs. discover posts share one endpoint** (`POST /video-posts`),
  distinguished by `feed` in the payload rather than two separate
  routes — a shop post requires the poster to have a merchant account
  and gets `merchant_id` attached; a discover post never does.
- **Order status changes aren't restricted to pending→shipped→delivered
  order** the way the frontend's UI happens to enforce it (it only ever
  offers the next status as a button) — worth adding a real
  state-machine check here if a second, less well-behaved client ever
  talks to this API.
- **`VideoPostRead`/`CommentRead` carry a denormalized display name +
  avatar** (`poster_display_name`/`poster_avatar_url`,
  `author_display_name`/`author_avatar_url`) rather than making the
  frontend resolve `poster_id`/`author_id` against a separate users
  endpoint per post/comment — there is no public "get user by id" route,
  and one request per row wasn't worth adding just for a display name.
  These are computed properties on the model (see `VideoPost`/`Comment`
  in `app/models/video.py`), not real columns, so any route returning
  one of these schemas must eager-load `poster`/`author` (see the
  `joinedload` calls in `video_posts.py`) or they silently fall back to
  a lazy-load per row instead of the one JOIN already being paid for.
  `author_display_name` reads `"Deleted user"` when `author_id` is null
  (the account was removed, but the comment itself deliberately isn't
  cascaded away — see the model's own comment on that).

## File uploads

Media (video posts, product photos, avatars, thumbnails) lives on
Cloudflare R2, not this server's own disk, and the actual bytes never
pass through this backend at all — a two-step, direct-to-cloud
presigned upload, same shape as the doc this pattern came from
describes, wired up as `app/storage.py` (the R2 client + URL signing)
and `routers/uploads.py` (the one route):

1. **`POST /uploads/presigned-url`** — the client sends just its file's
   content-type (`{"file_type": "video/mp4"}`), and gets back a
   short-lived (10 minute) signed `upload_url` for one brand-new object
   key, plus the `view_url` that object will be reachable at once
   something's actually there.
2. **The client `PUT`s the raw file straight to `upload_url`** — R2
   directly, never back through this API. `lib/api.ts`'s `uploadFile()`
   does both steps but keeps the same signature/return shape
   (`Promise<{ url: string }>`) the old single-request version had, so
   every uploader in the app (`MerchantPosts.tsx`, `MerchantProducts.tsx`,
   `MyOrdersScreen.tsx`) called it without any changes.
3. Once the `PUT` succeeds, `view_url` is what actually goes into
   `video_url`/`image_urls`/`thumbnail_url` — not a client-side `blob:`
   one, which only resolves in the tab that created it and goes dead
   the moment it closes.

`image/jpeg|png|webp|gif` and `video/mp4|quicktime|webm` only —
anything else gets a 415 before a URL is ever signed. Any logged-in
user can request one (not merchant-only), since a personal discover
post needs to upload a video too, same as a merchant's shop post does.

**No server-side size limit any more.** The old multipart endpoint
capped uploads at 10 MB/200 MB by actually reading the bytes; this one
never sees the bytes, and a presigned *PUT* URL (unlike a presigned
*POST* with a policy document) has no way to cap how much a client
sends to it. `lib/api.ts`'s `uploadFile()` still rejects an oversized
file before it ever calls this route, but that's a client-side check
only — a request built by hand could ignore it. Worth hardening for a
real deployment (a Cloudflare Worker in front of the bucket, or
switching to a presigned POST policy) rather than something this app
currently enforces server-side.

Needs a real R2 bucket + API token to actually work — `R2_ACCOUNT_ID`/
`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY` come from Cloudflare's
dashboard (R2 → Manage API tokens), `R2_BUCKET_NAME` is whatever you
named the bucket, and `R2_PUBLIC_BASE_URL` is that bucket's public
access URL — either R2's own free `<bucket>.<hash>.r2.dev` subdomain
(R2 → your bucket → Settings → Public access) or a custom domain
mapped to it. Against `docker-compose.yml`'s dev-placeholder defaults,
the rest of the API works fine (same as the Paystack/Google
placeholders); only `/uploads/presigned-url` — and, by extension, every
uploader in the frontend — won't actually work until those five are
real.

This is local-disk storage, meant for local dev — `app/storage.py` is
where that lives, kept as its own module specifically so swapping it for
S3/R2/etc. later means changing that one file (and the `open()` call in
`routers/uploads.py`), not hunting through the rest of the app for
filesystem assumptions.

## Google sign-in

`POST /auth/google` is one endpoint that covers both "sign up with
Google" and "log in with Google" — the frontend's `GoogleSignInButton`
renders Google's own Identity Services button (on both
CreateAccountScreen and LoginScreen — a Google identity is the same
door into the app either way) and forwards whatever ID token that
gives it here. This backend verifies the token's signature against
Google's own public keys and checks its audience against
`GOOGLE_CLIENT_ID` — nothing about the person (email, name, picture)
is ever trusted from the request body, only from the verified token
itself. If the email already has an account, that account logs in;
otherwise one is created with no password (`hashed_password` stays
null, same as it already did for the old mocked Google path) and a
username auto-generated from the email's local part.

You'll need an OAuth 2.0 Client ID (type "Web application") from
[Google Cloud Console](https://console.cloud.google.com/apis/credentials),
with your frontend's origin(s) (e.g. `http://localhost:3000`) added
under "Authorized JavaScript origins." That client ID is
`GOOGLE_CLIENT_ID` here and `NEXT_PUBLIC_GOOGLE_CLIENT_ID` on the
frontend — same value in both places; it's meant to be public (it
identifies your app to Google, it doesn't authenticate as it).

## Payments

Real payments via Paystack (card, bank transfer), replacing the old free `POST /orders` /
`POST /orders/checkout` flow. Nothing charges a card or initiates a bank transfer without going
through this:

1. Frontend calls `POST /payments/initialize` with `{mode: "cart"}` or
   `{mode: "buy_now", product_id, color, size}`. The amount is computed
   here from the person's actual cart or the actual product price —
   never accepted from the client — and stored on a new `Payment` row
   (`pending`) under a reference this backend generates. Response is
   just what Paystack Inline needs client-side: `reference`,
   `amount_subunit`, `currency`, `email`, `public_key`.
2. The frontend opens Paystack Inline's popup with those values
   directly — there's no server round-trip to Paystack's own
   `/transaction/initialize` endpoint, since Inline doesn't need one.
3. On the popup's success callback, frontend calls
   `POST /payments/verify {reference}`. This calls Paystack's real
   `/transaction/verify/{reference}` endpoint, checks status and amount
   paid against the `Payment` row, and only then creates `Order` rows
   (same snapshot-per-quantity logic `orders.py`'s checkout already
   used) and clears the cart for a cart-mode payment.
4. `POST /payments/webhook` is Paystack's own server-to-server
   confirmation for the same event, in case step 3 never happens (the
   tab closes right after paying). Register this URL
   (`https://your-api/payments/webhook`) in the Paystack dashboard;
   verified by the `x-paystack-signature` header, not authenticated the
   normal way. Fulfillment is idempotent either way — whichever of
   verify/webhook arrives first creates the orders, the other just
   returns what's already there.

`PAYSTACK_SECRET_KEY` / `PAYSTACK_PUBLIC_KEY` are test-mode keys from
the Paystack dashboard while developing — swap for live keys (and a
live webhook URL) before this takes real money.

**Frontend status:** `lib/api.ts` has a typed function for every route
above. Auth, both feeds, comments, watchlist, cart, checkout, the
merchant dashboard (products + posts, including uploads), follow/
unfollow, profile editing, likes/shares, and the settings toggles are
all wired to the real API now — nothing in those flows reads or writes
`lib/data.ts` mock state anymore, and nothing is left in `useState`
with no persistence behind it. What's left, per the frontend's own
remaining-work notes: actually running the whole thing once
end-to-end (no `npm run build`, no live server, no database has
touched this yet as of writing).

## Cancellations & refunds

`POST /orders/{id}/cancel` (optional `{"reason": "..."}` body) — either
the buyer or the selling merchant can call it, since both "I changed my
mind" and "I can't fulfill this" are real reasons an order needs to
stop, and there's no reason to make them two endpoints doing the same
work. Only allowed while an order is `pending` or `shipped`; once
`delivered`, this app treats "I don't want this anymore" as a return,
which it doesn't model — that request gets a 400.

If the order was genuinely paid for (`payment_id` set, and that
`Payment` succeeded), this calls Paystack's real `/refund` endpoint —
`app/paystack.py`, shared with `payments.py`'s own `/transaction/verify`
call rather than duplicating the httpx boilerplate a second time. The
refund is **partial**, for exactly this order's own `price`, never the
whole `Payment.amount`: one `Payment` can fund several `Order` rows (a
cart checkout), and cancelling one shouldn't refund the others' share
along with it. `Payment.status` only flips to the new `refunded` value
once *every* order it funds has been cancelled — cancelling one line
out of three leaves the payment `success`, since it's still
legitimately funding the other two.

Stock only goes back (`app/inventory.py`'s `release_stock`, the
row-locked reverse of `reserve_stock`) for an order that hadn't shipped
yet — once it has, the physical item already left, so there's nothing
to actually put back regardless of what the database says next.

**Known, deliberate simplification:** the refund doesn't prorate
`shipping_fee` or `discount_amount` back for a single cancelled line
out of a multi-item order. Doing that fairly needs real per-line cost
accounting this app doesn't have yet — noted here rather than silently
shipped as if it were exact.

## Escrow, payouts, and defect claims

A charge lands 100% in the platform's own Paystack balance at payment
time — same as before this existed. What's new is that a merchant
doesn't get paid out of it automatically. `Order.payout_status`
(`held` → `released` or `refunded`) tracks that separately from
`Order.status` (the shipping lifecycle), because "has this shipped"
and "has the merchant actually been paid for it" are genuinely
different questions once money sits in escrow between them.

Two modules, kept deliberately apart:

- **`app/escrow.py`** — the mechanics. Holds, releases (via Paystack's
  real Transfers API — `create_transfer`, not split payments/
  subaccounts, since a split pays out at charge time and this needs to
  hold first), and refunds. Doesn't know or care *why* a release or
  refund is happening.
- **`app/return_policy.py`** — the filter. One function,
  `validate_return_claim`, deciding whether a buyer's defect claim is
  even allowed to be filed. Today's rule: delivered, within
  `CLAIM_WINDOW` (48 hours; `CLAIM_WINDOW_HOURS`) of `delivered_at`, video present. Changing
  any of that — the window, what evidence counts — means editing only
  this file; nothing else needs to change.

**Merchant payout setup** — `GET /merchant/banks` (no auth — reference
data, not scoped to anyone) lists every bank Paystack can transfer to,
for a picker UI rather than asking a merchant to already know
Paystack's numeric `bank_code` for their own bank. `POST /merchant/payout`
(`bank_code`,
`account_number`). Two real Paystack calls, in order: `resolve_account`
confirms the account actually exists and returns the real name on file
for it (never trusting a name the merchant might type in), then
`create_transfer_recipient` registers it for future transfers.
`MerchantAccount.payout_ready` (a computed property, same pattern as
`Product.in_stock`) is what a "did they set this up yet" check should
read — `release_to_merchant` refuses to pay out to a merchant who
hasn't.

**Three ways an order's funds actually move once delivered:**

1. **`POST /orders/{id}/confirm-receipt`** — buyer taps "this is what I
   ordered," funds release immediately.
2. **`POST /orders/{id}/report-defect`** (`video_url`, optional
   `reason`) — a valid claim (passes `validate_return_claim`, which now
   also rejects filing against an order whose funds have already been
   released — most commonly because the buyer already tapped
   "confirm-receipt") creates a `ReturnClaim` row (one per order — the
   unique constraint on `order_id` makes a second claim impossible at
   the database level, not just the API's) in `pending_review`, and
   stops there — **no refund happens in this request.** The selling
   merchant can add one rebuttal message
   (`POST /orders/{id}/return-claim/respond`) while it's still pending;
   either party can check its status
   (`GET /orders/{id}/return-claim`). The claim only ever moves to
   `refunded` or `denied` once an admin resolves it —
   `PATCH /admin/return-claims/{id}` in `routers/admin.py`, the only
   place `refund_for_defect` gets called from now. See "Moderation"
   below.
   **The "must be recorded live, not picked from a gallery" requirement
   is a frontend-only guarantee** (an in-browser camera recorder with
   no file-picker fallback) — worth being explicit that no backend
   check can verify a video's actual provenance once it's just a URL.
3. **Nobody does anything** — `app/escrow.py`'s `sweep_auto_releases`
   releases an order once `CLAIM_WINDOW` has passed with nothing filed
   — or with a claim that's since been `denied` (a claim still sitting
   `pending_review` blocks this, even past the window, so a merchant
   can't get paid out from under a claim admin hasn't looked at yet).
   Called opportunistically from inside `GET /orders/me` and
   `GET /orders/selling` on whatever orders that request already
   loaded — **not a scheduled job**, since this app has no background
   task runner. "Checked the next time someone happens to look at their
   orders" is what's actually achievable right now; a real deployment
   should replace this with a real cron hitting a dedicated endpoint.

**Known, deliberate limitation:** Paystack Transfers are NGN-only on a
standard integration, while this app charges in USD by default (see
`PAYSTACK_CURRENCY` in `payments.py`). A real deployment paying
merchants out in NGN against USD-denominated charges needs a currency
conversion step that doesn't exist here — noted in `app/paystack.py`
rather than silently assumed away.

## Moderation

Everything in this section is gated by `get_current_admin`
(`app/auth/dependencies.py`) except where noted — and there is
deliberately no API route anywhere that can grant that role. The only
way an account becomes an admin is a direct database write
(`UPDATE users SET role = 'admin' ...`); keeping that off the app's own
reachable surface entirely is intentional, not an oversight.

**Roles & bans.** `User.role` (`user`/`admin`) and `User.is_active` are
the whole access model. `is_active` is what `get_current_active_user`
checks — every protected route in the app depends on that rather than
the plain `get_current_user`, *except* `GET /auth/me` and the two
appeal routes below, which deliberately still accept a banned account.
That split exists for one reason: a banned person needs to be able to
log in far enough to see why and file an appeal, not be locked out
entirely. `POST /admin/users/{id}/ban` (optional `reason`) and
`.../unban` are the only things that flip it; banning an admin account
is refused outright, since unbanning them would then need another
admin to already exist and know to do it.

**Shadow bans** are a deliberately separate mechanism from the above,
not a variant of it — `User.is_shadow_banned`, flipped by
`POST /admin/users/{id}/shadow-ban` / `.../unshadow-ban`. A shadow-banned
account is never told, has `is_active` untouched (nothing in the auth
chain checks this column — `get_current_active_user` doesn't reject
it), and gets no notification when it's applied — unlike literally
every other admin action in this file, which all call `_notify`. The
account can keep logging in, posting, commenting, buying, all of it,
with no error anywhere. What actually changes is read-side, all of it
in `app/visibility.py` now (moved there from `routers/video_posts.py`
once `routers/search.py` needed the identical logic — correctness-
sensitive filtering like this shouldn't drift between two copies the
way this codebase's smaller per-router helpers, like `_snapshot_order`,
deliberately do stay duplicated):

- `hide_shadow_banned()` — `list_video_posts`/`list_comments` and
  search's feed/discover sections. Filters a query of a model with a
  direct relationship to `User` (`VideoPost.poster`, `Comment.author`).
- `hide_shadow_banned_products()` — search's product section. One hop
  further than the above (`Product.merchant_id` -> `MerchantAccount.
  user_id`), with the same nullable-safety for a product with no
  merchant at all.
  Search's people section intentionally has no filter of its own — a
  shadow ban starves an account's *content* of reach, it doesn't make
  the account itself unfindable, so searching a shadow-banned user's
  name still surfaces their profile.
- `is_hidden_from()` — the single-row equivalent, for `GET
  /video-posts/{id}`. A shadow-banned poster's post now 404s for
  anyone but themselves or an admin there too, same as it's absent from
  `list_video_posts` — including via this app's own `ShareSheet`-
  generated `?post=<id>` links, which resolve through this exact route.

All four share one rule: an admin sees everything unfiltered (so
moderation itself isn't blind to what it's supposed to be reviewing),
the shadow-banned account always sees its own rows, and everyone else —
logged in or not — sees nothing. Nowhere in this app is a shadow ban
partial anymore; every public read surface that could show a shadow-
banned account's content now agrees.

**Appeals.** `POST /users/me/appeal` and `GET /users/me/appeals`
(`routers/users.py`) are the banned account's own — filing is refused
if the account isn't actually banned, or if a previous appeal from the
same account is still `pending` (not a database constraint; only
`pending` blocks a new one, so a *denied* appeal doesn't stop someone
filing again later). `GET /admin/appeals` and
`PATCH /admin/appeals/{id}` are the review side. Approving an appeal
doesn't just update the appeal row — it's the actual unban, clearing
`is_active`/`ban_reason`/`banned_at` on the account in the same
request.

**Reports.** `POST /reports` (`routers/reports.py`) — any active user
reporting a video post, product, or account, with a fixed `reason`
enum (spam/counterfeit/inappropriate/harassment/other) plus optional
free-text `detail`. Doesn't validate that `target_id` actually exists
for `target_type` — whoever reviews it will see soon enough if it
doesn't. `GET /admin/reports` and `PATCH /admin/reports/{id}` are the
review side; resolving one doesn't itself remove anything or notify
anyone — an `actioned` resolution normally means a separate
ban/removal call happened alongside it, and each of those already
notifies on its own.

**Content removal.** `DELETE /admin/products/{id}` and
`.../video-posts/{id}` are admin-scoped equivalents of the merchant's
own `DELETE /merchant/products/{id}` and the poster's own
`DELETE /video-posts/{id}`, just without the "must own this" check.
Both are real deletes, not a soft "hidden" flag — safe even against a
product with real order history, since `Order.product_id` already uses
`ON DELETE SET NULL` with `product_name`/`price` snapshotted onto the
order itself (see that column's own comment). Both notify the owner
with an optional `?reason=` query param folded into the message.

**Disputes.** See "Escrow, payouts, and defect claims" above for how a
claim gets filed and rebutted — `GET /admin/return-claims` and
`PATCH /admin/return-claims/{id}` (`{"approve": true/false,
"resolution_note": "..."}`) are where one actually gets resolved.
Approving calls `refund_for_defect` (the same function that used to
run automatically the instant a claim was filed, before this existed);
denying leaves the order's `payout_status` untouched, which is exactly
what lets `sweep_auto_releases` pick it back up for a normal release
later. Both outcomes notify the buyer and the selling merchant.

**Every notification above is real** — `admin.py` is the first place
in this entire app that ever calls `Notification(...)`. Everything
`NotificationsScreen.tsx` has shown until now was seeded fake data.

**Analytics** — `GET /admin/analytics/summary` (`?period=day|month|
year`, order volume + revenue over time), `.../top-products` (ranked
by units sold, not revenue — a cheap high-volume item and an expensive
low-volume one aren't ranked by whichever costs more), and
`.../trending-posts` (ranked by total engagement — the same four real
counters `MerchantAnalytics.tsx` already charts per merchant, summed
and ranked platform-wide instead). All three are plain aggregations
over data that already exists; nothing new is tracked to power them.

**Traffic** is the one exception — `POST /traffic`
(`routers/traffic.py`, `TrafficSource` in `models/traffic.py`) is new
instrumentation, not a new query. Called once per app load from the
frontend, capturing `referrer`/UTM params. Deliberately *not*
pageview/event tracking — no screen-by-screen history, just enough to
answer "where do sessions/signups come from," which
`GET /admin/analytics/traffic` (`?period=day|month|year`) then groups
by day/month/year. No auth required to post one (most fire before
anyone's logged in at all — that's the point), and it's the one part
of this feature where the frontend still needs its own piece of work
(actually calling `POST /traffic` on load) before this data starts
showing up.

## Inventory

`Product.stock_quantity` is nullable — `None` (the default, and every
product's state before this column existed) means untracked/unlimited;
a real integer means tracked and enforced. `Product.in_stock` is a
plain property (`stock_quantity is None or stock_quantity > 0`), picked
up by `ProductRead` the same way `User.following_count` is.

All the actual enforcement lives in one place: `app/inventory.py`'s
`reserve_stock()`. It locks the product row (`SELECT ... FOR UPDATE`)
before checking/decrementing, which is what actually prevents two
people buying the last unit at the same time — not the read-then-
compare that follows it. Every path that creates an `Order` calls it:
the legacy `orders.py` buy-now/checkout routes, and `payments.py`'s
`_fulfill()`.

Two-tier checking on the real (Paystack) purchase flow specifically:

- `/payments/initialize` does an early, **read-only** check — no lock,
  no decrement, just a fast 409 if the cart/product is already known to
  be short. Deliberately not a reservation: initializing a payment
  doesn't mean the person will actually complete it, and reserving
  stock for an abandoned Paystack popup would slowly leak it away.
- `_fulfill()` (called from both `/payments/verify` and the webhook)
  does the real `reserve_stock()` call, right when a charge is
  confirmed — this is the one that's actually race-safe.

The awkward case: stock runs out **between** those two steps — someone
else buys the last unit while this person's Paystack popup is open.
Paystack has already captured the charge at that point, so `_fulfill`
can't just fail quietly:

1. The whole fulfillment rolls back atomically — a cart with 3 items
   where only the 3rd is short doesn't end up 2/3 fulfilled.
2. `Payment.status` gets a new value, `fulfillment_failed`, distinct
   from `failed` (which means the charge itself didn't go through) —
   this one means Paystack has the money and Lumin has nothing to ship.
3. `/payments/verify` re-raises, so the paying customer sees a clear
   409 in real time. The webhook swallows the same exception and still
   returns 200 to Paystack — retrying delivery wouldn't fix a real
   stock shortfall, so there's no reason to make Paystack keep trying.

No automatic refund happens here — same "manual Paystack dashboard
action" limitation noted elsewhere for cancellations. A
`fulfillment_failed` payment is currently something a merchant/admin
has to notice and handle by hand.

## Discount codes

`DiscountCode` (`app/models/discount.py`) is platform-wide, not
per-merchant — same reasoning as `DeliveryCompany`: a cart can span
several merchants, and one code needs to make sense against the whole
checkout subtotal, not one seller's line items. Two kinds: `percent`
(with an optional `max_discount_amount` cap) or `fixed`. Optional
`min_subtotal`, `expires_at`, an overall `max_redemptions`, and a
`max_redemptions_per_user` (defaults to 1 — the usual "once per
account" welcome-code shape) are all independently optional.

Same two-tier split as inventory above, for the same reason:

- `preview_discount()` (`app/discounts.py`) is the read-only check —
  used by `POST /discounts/preview` (instant "-$5.00" feedback while
  someone's still editing their cart) and by `/payments/initialize`
  (which locks in the amount Paystack actually gets charged). Checks
  everything including the redemption caps, but only as a read — it's
  not what actually spends a redemption.
- `redeem_discount()` is the real, row-locked spend — called only from
  `_fulfill()`, at the same moment `reserve_stock()` runs, once a
  charge is confirmed. Re-validates from scratch against a locked row,
  because a code could be deactivated or exhausted by someone else in
  the gap between initializing and Paystack actually confirming.

If `redeem_discount()` fails that late (someone else used up the last
redemption while this popup was open), it's caught by the exact same
`except HTTPException` block in `_fulfill()` that handles a stock
shortfall — same rollback, same `fulfillment_failed` outcome, same
"needs a manual look" limitation. No separate error path was needed for
this; it already existed.

No creation endpoint yet — same limitation as `DeliveryCompany` (see
its own comment): codes only exist via `seed.py` until there's an admin
surface to manage them from (missing-pieces list item #12). Two are
seeded for demoing: `WELCOME10` (10% off, capped at $15, once per
account) and `SAVE5` ($5 off orders of $30+, 500 total redemptions,
no per-account limit).

## Rate limiting & CSRF

`/auth/signup`, `/auth/login`, `/auth/google`, `/payments/initialize`,
and `/payments/verify` are rate-limited per IP (`app/rate_limit.py`,
enforced via `slowapi`) — 5/minute on signup and login (the two an
attacker could actually script a password guess against), 10/minute on
the rest (looser, since Google's own token or an existing session
already vouches for the caller there — the cap is just against
hammering the endpoint, not brute force). `/payments/webhook` is
deliberately left unlimited: that's Paystack's own servers calling in,
and throttling it risks dropping a real payment confirmation. In-memory
by default — see rate_limit.py's own comment on what changes if this
ever runs multiple worker processes.

CSRF protection isn't included, and deliberately so rather than an
oversight: CSRF exploits rely on a browser automatically attaching
ambient credentials (cookies) to a cross-site request. This API doesn't
use cookies for auth — the JWT lives in the frontend's own storage and
is attached explicitly via the `Authorization` header on every call, a
malicious page on another origin has no way to read that value or
attach that header itself, and CORS above is already scoped to just the
real frontend origin(s) rather than `*`. A CSRF token would be
protecting against an attack this architecture isn't exposed to.

What *would* be worth adding, if this grows past a single-process demo:
token revocation. A JWT issued today is valid for 7 days
(`ACCESS_TOKEN_EXPIRE_MINUTES` in `auth/security.py`) with nothing that
can invalidate it early — there's no logout-that-actually-revokes, and
no "sign out of all devices." That needs either a server-side token
blocklist or moving to short-lived access tokens plus a refresh-token
flow — a bigger design decision than a quick add, so it's flagged here
rather than built speculatively.

## Next steps

Likes and shares now persist per-user the same way watchlist/follow do
— `post_likes`/`post_shares` join tables (models/video.py), toggled via
`POST`/`DELETE /video-posts/{id}/like` and `.../share`, with
`GET /video-posts/likes` and `.../shares` returning bare id lists (no
"liked posts" screen exists to browse, so the frontend only ever needs
these for a membership check) rather than full `VideoPostRead` objects
like `.../watchlist` returns. `likes_count`/`shares_count` are bumped
in the same request that adds/removes the join row, not derived by
counting on every read — same tradeoff as every other denormalized
counter in this file.

One deliberate inconsistency worth knowing about: real platforms don't
usually let you "unshare," but the frontend's engagement rail already
treated Share as a symmetric toggle right alongside Like (same
optimistic state, same filled-in styling) before either was real —
this preserves that interaction rather than quietly redesigning UX
while just trying to persist it. Worth revisiting as its own decision
later if that behavior stops making sense.

Settings screen's autoplay-next/mute-by-default toggles also now
persist — as two more columns on `User` (`autoplay_next`,
`default_muted`), read/written through the same `PATCH /users/me` that
profile editing already used, rather than a separate route or
localStorage. That was a genuine choice (the frontend's own
remaining-work notes called this "only worth doing if you want them to
follow the account across devices"), made in that direction to stay
consistent with everything else in this project having moved off
local-only state — not because localStorage would've been wrong.

The admin/moderation system (see "Moderation" above) was the last big
piece: roles, bans with an appeal path, reports, admin-scoped content
removal, disputes actually going through review instead of
auto-refunding, and platform-wide analytics. Backend-only for
now — the plan going in was a genuinely separate frontend (its own
login, its own design language — tables and queues, not a video feed),
not a hidden section bolted onto the consumer app, so `lumin-admin` is
its own project rather than something that shows up in this repo.
CORS (`app/main.py`) already allows `http://localhost:3001` for it.

## Transactional email & password reset

`app/email.py` sends through Resend's HTTP API (one POST, same shape as
every Paystack call in `app/paystack.py`) — `RESEND_API_KEY` is
**optional**, unlike the other provider keys: with it unset, email sends
are silently skipped (a logged warning, not an exception), since every
caller already treats email as best-effort and the app has no other
reason to depend on it existing. Two emails exist today, both in
`app/email_templates.py`:

- **Order confirmation** — sent from `payments.py`'s `_fulfill`, once,
  right after a payment is marked successful. Covers every `Order` row
  that payment produced in one email (a quantity-3 cart line becomes 3
  `Order` rows but one receipt, not three), with the same subtotal /
  discount / shipping / total breakdown `PaymentInitializeRead` already
  showed the frontend before the charge happened.
- **Password reset** — the actual missing flow, not just an email
  template. `PasswordResetToken` stores a **hash** of a random token
  (never the raw value — same reasoning as `hashed_password` on `User`)
  with a 30-minute expiry. `POST /auth/forgot-password` always returns
  204 whether or not the email belongs to an account, and whether or
  not sending actually succeeds — responding differently would let the
  route be used to check which emails are registered, which is exactly
  what an unauthenticated-by-design endpoint like this has to avoid.
  `POST /auth/reset-password` takes the raw token back and the new
  password, hashes the token the same way to look it up, and rejects a
  missing/used/expired one with one generic message (not three
  different ones that would tell an attacker which case they hit).

Both email sends are wrapped in try/except and only logged on failure,
never raised — by the time either fires, the thing it's confirming (a
successful charge, a token that's already committed to the database)
has already happened. A flaky email provider is a reason to leave a log
line, not a reason to fail an order that already charged a real card or
turn a password-reset request into a 500 that would itself leak account
existence via a different response shape than the normal path.

The frontend side of this (a "Forgot password?" link on `LoginScreen`,
a real Next.js route at `/reset-password` rather than one more `view`
in `page.tsx`'s internal state — this is the one screen in the whole
app that has to work when someone lands on it fresh from an email link,
with no prior app state at all) is built and wired to these same two
routes.

**Not done:** no email verification on signup, no "resend confirmation"
flow, and no other transactional email exists yet (a shipping-update
notification, for instance, would be a natural next one once
`Notification` rows are actually being created anywhere — see the
"missing pieces" list this work is being tracked against for what
else that touches).

## Deploying to Railway

Three Railway services, in this order:

1. **Postgres** — "New" → "Database" → "Add PostgreSQL". Railway
   provisions it and sets `DATABASE_URL` on itself automatically; the
   next step references that.
2. **This API** — "New" → "GitHub Repo" (or "Empty Service" +
   `railway up` from this directory if it's not in its own repo yet),
   pointed at this directory. Railway detects `Dockerfile` and
   `railway.toml` here on its own — no build command to configure by
   hand. Under that service's Variables tab, add:

   ```
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   JWT_SECRET_KEY=<openssl rand -hex 32>
   R2_ACCOUNT_ID=...
   R2_ACCESS_KEY_ID=...
   R2_SECRET_ACCESS_KEY=...
   R2_BUCKET_NAME=lumin-media
   R2_PUBLIC_BASE_URL=https://pub-xxxxxxxx.r2.dev
   PAYSTACK_SECRET_KEY=sk_live_...
   PAYSTACK_PUBLIC_KEY=pk_live_...
   GOOGLE_CLIENT_ID=...apps.googleusercontent.com
   FRONTEND_URL=https://<your-frontend-service>.up.railway.app
   ```

   `${{Postgres.DATABASE_URL}}` is Railway's own variable-reference
   syntax — typing that literal string into the API service's
   `DATABASE_URL` wires it to whatever the Postgres service's own value
   actually is, including across that value changing later, rather than
   you having to copy a connection string over by hand. `RESEND_API_KEY`
   / `EMAIL_FROM` / `PAYSTACK_CURRENCY` are optional, same as local setup
   above. Generate a real `JWT_SECRET_KEY` for this — the local dev
   default some setups float around is not it, and this is what signs
   every login token this deployment issues.

   `FRONTEND_URL` matters for two things once it's a real deployed URL
   rather than localhost: the link inside password-reset emails, and —
   see `app/main.py` — it's folded automatically into this API's CORS
   allowlist, so the deployed frontend's requests aren't silently
   rejected as a disallowed origin. If the separate admin console
   (`lumin-admin`) ever gets deployed too, its origin won't be covered
   by `FRONTEND_URL` alone; add a `CORS_ORIGINS` variable instead, a
   comma-separated list covering both origins, which overrides rather
   than adds to the `FRONTEND_URL`-derived default.

   First deploy runs `entrypoint.sh`: waits for Postgres to accept
   connections, generates the initial Alembic migration since
   `alembic/versions` starts out empty, applies it, seeds demo data (see
   "Setup" above for what that adds and the login it prints — fine to
   leave running on every deploy, it's a no-op once the data's already
   there), then starts `uvicorn`. That first boot takes noticeably
   longer than a normal restart; `healthcheckTimeout = 300` in
   `railway.toml` gives it room rather than Railway concluding it's
   unhealthy and restarting it mid-migration.

3. **The frontend** — see `lumin-app`'s own README for its half of this
   (it needs this API service's public URL as a *build* argument, not
   just a deployed-afterward env var — easy to get backwards, covered
   there).

Once both services are up, open the API service's Settings tab and
generate a public domain if Railway hasn't already, then put that URL
into the frontend service's `NEXT_PUBLIC_API_URL` build variable before
building it.

## Tests and migrations

**Tests** (need a throwaway Postgres; it is wiped between tests):

    pip install -r requirements-dev.txt
    TEST_DATABASE_URL=postgresql+psycopg2://postgres:pw@localhost:5433/lumin_test pytest

`tests/test_migrations.py` fails if the models and the migrations drift apart.

**Migrations** are Alembic, applied by `entrypoint.sh` on every start. `0001_baseline`
creates anything missing; `0002`/`0003` are idempotent so they are safe on a database that
already had these changes from the old `ensure_schema.py` (now removed). For every future
schema change: edit the model, run `alembic revision --autogenerate -m "what changed"`,
review the file, commit it. Back up the production database before the first deploy.

## Twin search

Replaces twin requests and retwins. A shopper describes what they saw (optionally with a clipped moment of a
video, or just typed into discovery search) and gets catalog products that match, buyable like
any other product, or "couldn't find a twin match — we'll notify you".

```
POST   /twin-search                    {query, category_id?, video_post_id?, start_ms?, end_ms?}
GET    /twin-search/mine               the caller's searches (?status=not_found for the ones still waiting)
DELETE /twin-search/{id}               stop waiting
POST   /twin-search/{id}/pick          {product_id, action: cart|buy} — the shopper went on to buy a result
GET    /video-posts/{id}/moment-products   seller twins + shopper-suggested links that earned trust (the "Shazam for video" index)
GET    /video-posts/{id}/moment-candidates the poster's inbox: suggested links not trusted yet
POST   /video-posts/{id}/moment-products/{link}/review   {decision: confirm|reject|clear} — original poster only
GET    /merchant/insights/keywords     what shoppers search for and can't find (paid; locked preview otherwise)
POST   /admin/merchants/{id}/insights  {days} — admin turns a merchant's insights on until the subscription flow exists
```

* **Matching** (`app/twin_match.py`, pure Python): word overlap of the description against product name, colour,
  category and description. Listing quality (photos, a real description) only *reorders* products that already match,
  so better listings rank higher but can't become false matches. Matching is text-only and runs entirely on
  our own servers. **No clip, frame or photo is sent to any outside model or service** (the old `twin_vision.py`,
  `POST /twin-search/describe` and frame upload were removed; `twin_searches.frame_url` is a legacy unused column).
  Text-only matching can confuse e.g. "blue cotton shirt" with a "Blue Cotton Mug"; the category filter and the
  "closest we have" list are the guard, and the moment index below is how it improves.
* **Closest we have**: when nothing matches, the response also carries `closest` — up to `TWIN_SEARCH_CLOSEST_MAX`
  products scoring at least `TWIN_SEARCH_CLOSEST_MIN_SCORE`, clearly second-best. They never count as a match, never
  notify, and picking one neither teaches the moment index nor ends the shopper's wait.
* **Waitlist**: a not-found search stays open. Listing or editing a product (`routers/merchant.py`) checks waiting
  searches and sends each matching shopper one `twin_available` notification.
* **Moment index** (`app/moment_index.py`, tunables `TWIN_MOMENT_*` in `app/twin_config.py`): an add-to-cart is not
  proof a product is in a video, so one pick never makes a link. A pick becomes a vote only if the shopper clipped a
  short moment (≤ 10 s), their own words fit the product at ≥ 0.75 (stricter than showing a result), it wasn't a
  "closest we have" consolation, and they are neither the product's seller nor the video's poster. One vote per
  shopper per link (≤ 5 products per video). A link is **trusted** only when ≥ 2 different shoppers each bought it and
  *kept* it (order delivered, 24 h claim window passed, no return claim, bought within 7 days of the pick) and it holds
  ≥ 60 % of the support among rival products picked for the same moment (a cart-only shopper counts 0.25 there, never
  towards the 2 buyers). The link's time range is the median of the clips; a search uses it only if their clip covers
  ≥ 50 % of the shorter of the two; evidence expires after a year. Trust is recomputed on each read, so a cancelled
  order or a return withdraws it at once. The video's original poster can confirm a link early (confidence 0.95) or
  reject it for good. Migration 0010 deletes links built under the old any-cart-add rule (they have no per-shopper
  evidence to verify). Expect it to be slow to fill: that is deliberate.
* **Keyword insights**: searches are normalised into an order-insensitive keyword and aggregated by distinct
  shoppers. Only counts are shown to merchants, never who searched. `merchant_accounts.insights_until` gates it; the
  Paystack subscription that sets it is not built yet.
* Existing twin tagging by sellers is unchanged. The `twin_requests` / retwin tables and columns are left in place
  (unused); migration 0008 detaches existing video retwins so they stay up as ordinary posts.

## Wanted board (the wall)

Unmet twin searches, public (`app/wanted_service.py`, `routers/wanted.py`). There is no request table: a request is
the group of `twin_searches` rows sharing a `query_key` that weren't matched when made.

```
GET    /wanted?tab=trending|new|most_twinned|mine|fulfilled   public (mine needs login); each request carries its moment
                                            (video_url, start/end, size, creator name/avatar) and `twinned` = products twinned to it, `twin_previews` = photos of the first few
GET    /wanted/{id}                         one request: its clip, creator name, anonymous activity
POST   /wanted/{id}/upvote                  "me too" = the same search by this shopper (idempotent)
DELETE /wanted/{id}/upvote                  withdraw
PUT    /wanted/{id}/notify {notify}         the bell (turning it on for a request you're not in joins it)
POST   /wanted/{id}/offer {product_id}      a seller says "I have this": waiting shoppers told once (10/day)
```

* A request is only listed once `TWIN_WANTED_MIN_USERS` (2) different shoppers want it, so one person's free text
  isn't published the moment they type it. Set 1 to list instantly. Counts and activity never show who.
* Joining when a twin already exists returns it (`matches`) instead of adding to the wait.
* Open = someone is still waiting; fulfilled = everyone has been told (a listing matched, or a seller offered).
* Not built: reporting/hiding abusive request text (reports don't cover requests yet), location ("near you"), and
  a creator opt-out from being named on a request made from their video.
* A request stays on the wall (trending/new/most_twinned) while someone is waiting OR a seller has twinned something
  to it; only requests with neither move to `fulfilled`.

### Twins of a moment: compare list, "Twin it", reports (`app/wanted_twins.py`, migration 0012)

```
GET    /wanted/{id}/twins                   compare list: official first, then by match; `similar` only when an official twin exists
GET    /wanted/{id}/my-products             a seller's own products for the "Twin it" sheet, best match first
POST   /wanted/{id}/twin {product_id}       "Twin it" (10/day). /offer is the same call, kept for older apps
DELETE /wanted/{id}/twin/{product_id}       the seller takes their twin back
POST   /wanted/{id}/twins/{product_id}/report {reason, detail}   counterfeit | likeness | mismatch | ownership
GET    /wanted/leads                        "requests you can answer": open requests one of the seller's own products already fits (free)
GET    /creator/impact                      shoppers who asked about the creator's videos, twins offered/approved, top moments
GET    /creator/twins?state=review|approved|hidden   the creator's inbox (approve/hide use POST /video-posts/{id}/moment-products/{link}/review)
```

* Each twin is `official` (the video's poster put it there), `confirmed` (shoppers bought and kept it, or the poster
  approved it) or `offered` (a seller says it fits, nothing more). An offer is a claim, never evidence: it creates
  an unreviewed moment link the poster can approve or hide, and does not feed the moment index by itself.
* A poster's own "Twin it" is approved on the spot. A poster hiding a product for a moment stops it being offered
  there again (409).
* Match labels (strong/good/partial/weak) come from the same word scoring as search (`TWIN_MATCH_STRONG`,
  `TWIN_MATCH_PARTIAL`). Sellers may offer a weak match: it is labelled so, and the existing 10/day limit and reports
  bound abuse. Tighten by refusing weak offers in `wanted_service.offer` if spam shows up.
* **The poster is told** (`twin_offered` notification, target = the video) when a seller offers a twin for a moment
  of their video: at most one unread per video at a time, so a busy video doesn't flood; they look, then the next offer
  is news again. A poster's own twin never notifies them. Migration `0016_twin_offered_notification`.
* **Requests you can answer** (`GET /wanted/leads`, `wanted_twins.leads`): from the open requests on the wall (top 40
  trending), each seller's best-fitting own product by the same word scoring; weak fits (< `TWIN_MATCH_PARTIAL`) and
  requests the seller already twinned are left out, best fit first, up to 20. Shown in the merchant Demand tab; each
  one answers with the usual Twin it. Free for every seller.
* Reports go into the admin Reports queue as `product` reports whose detail starts `twin:<reason> request:<id>`.
  `TWIN_REPORT_HIDE_AT` (3) different reporters hide the twin from compare lists until an admin has looked; one
  report never hides anything.
* Not built: verified creator/brand badges, "Sponsored" labels, sales or earnings figures, a creator auto-approve
  setting, and a seller-profile twins tab.

## Deleting an account

`GET /users/me/deletion-check` says whether it can be done and why not (the app asks first), and
`POST /users/me/delete {confirm: "DELETE", password}` does it (5 per hour; password only when the account has one, so a
Google-only account confirms with the word alone). The old token stops working at once (the user row is gone).

* **Deleted:** profile, login, avatar, followers/following, likes, comments, watchlist, cart, notifications, saved
  address, the person's videos (and, for sellers, the store and its products), and their uploaded files in storage
  (removed after the commit, best effort: a storage hiccup can't undo the deletion).
* **Kept, detached:** order and payment records (buyer cleared, name becomes "Deleted user", delivery address scrubbed),
  reports and moderation records. `payments.user_id` is now nullable / `ON DELETE SET NULL` (migration
  `0017_payment_user_set_null`) so accounting records survive.
* **Refused (409, with plain-language reasons):** an order not yet delivered, a delivered one still in the claim window
  (payout held), an open return claim, a payment still being confirmed (last 24h), or the same on a seller's store. Admin
  accounts can't delete themselves here.
* Someone else's *video retwin* of a deleted video carries on as a post of its own (same as when an owner deletes a video).

## Switching twins off

The twin *discovery* layer — scan / twin search, the Wanted board, the creator twins inbox and impact page, twin
notifications, the waitlist, seller leads and keyword insights — is behind one switch and is **off by default**:

* Backend: set `TWIN_ENABLED=true` to turn it on. Off, those routes return 404 and listing/editing a product notifies
  nobody (`app/twin_gate.py`, `twin_config.enabled()`; read on every request, no redeploy of code needed).
* App: set `NEXT_PUBLIC_TWIN_ENABLED=true` at build time (`lib/features.ts`). Off, the Scan and Wanted buttons, the
  drawer's "Seen something else?" row, the timeline pins, the creator impact entry and the merchant Demand tab are hidden.
* Not part of the switch, so they keep working: sellers tagging products on their own videos (the product pills and the
  twin editor), `GET /twin-config` (that editor reads it), and the admin console.
* Nothing is deleted. Tables, migrations and code stay; turn both settings on to bring it all back.
* Turn the two settings on or off together: an app with it on against a backend with it off just shows empty screens.

## Tuning twins without a deploy

Every number behind twins and twin search lives in `app/twin_config.py` and can be overridden with an
environment variable: `TWIN_MIN_TWIN_MS`, `TWIN_MAX_REQUEST_CLIP_MS`, `TWIN_TRUST_AFTER_APPROVED`,
`TWIN_SEARCH_MIN_SCORE`, `TWIN_SEARCH_MAX_RESULTS`, `TWIN_SEARCH_CLOSEST_MIN_SCORE`, `TWIN_SEARCH_CLOSEST_MAX`, `TWIN_MOMENT_MIN_BUYERS` (and the other `TWIN_MOMENT_*`), `TWIN_SEARCH_WAIT_DAYS`,
`TWIN_INSIGHTS_PREVIEW_KEYWORDS`, `TWIN_WANTED_MIN_USERS`. The apps read the few they need from `GET /twin-config`. Watch **Twin health**
in the admin console before tightening anything.

### Requests are grouped by moment (`request_key`)

`TwinSearch.request_key` is the Wanted request an ask belongs to. For a clip of a video it
joins an existing unmet request on the same video when the clips mostly coincide
(IoU >= `WANTED_MERGE_MIN_IOU`) or overlap and share a word; otherwise it is the ask's own
keyword. `query_key` is unchanged (merchant keyword insights use it). Migration
`0013_request_key` adds the column and backfills it. `GET /wanted/nearby?video_post_id&start_ms&end_ms`
lists the requests already on a moment (listed ones, or the viewer's own) for the
"Want it too" panel in the Twin search sheet. Not run here: needs the Postgres test harness.

### Circle it

A clipped search can carry `box` (left, top, width, height as 0..1 fractions of the frame; migration
`0014_search_box`). Only the four numbers are stored; the ring and spotlight are drawn in the browser.
Two asks about one moment that both circled something are the same request only when their circles overlap
(`WANTED_BOX_MIN_IOU`), so "the jacket" and "the bag" stay separate. `/wanted/nearby` takes optional
`bx,by,bw,bh`. Not run here: needs the Postgres test harness.

`GET /wanted/suggest` (same query as nearby, plus optional circle) returns how many others asked about
a moment, how many circled the same thing, and words at least `WANTED_MIN_USERS` different shoppers used.
Counts and words only, never who. Feeds the tap-to-pick chips and the "others circled this too" line.

A circle also stores `box_at_ms`, the frame (ms into the video, inside the clip) it was drawn on
(migration `0015_box_frame`). Short moments (<= 6s) are shown as up to 3 frames instead of video;
the circled frame is always one of them.
## Scan (find a video's products from a screen recording)

- `app/scan_fp.py` is the matcher (sound, frame, per-cell and local-feature fingerprints; answers "not found" rather than guessing). `ffmpeg` must be on the server PATH.
- Every shop video with products is fingerprinted in the background after upload. Backfill existing posts: `python -m app.scan_service --backfill`.
- Endpoints: `POST /scan/match`, `GET /scan/video/{id}`, `GET /scan/mine`, admin `GET /scan/flags` and `POST /scan/flags/{id}/resolve`. A later upload that matches another poster's earlier video opens a review flag; nothing is removed automatically.
- `POST /scan/link` scans a pasted link: a Lumin link goes straight to the video; a direct video-file link is downloaded safely (public addresses only, 60 MB / 25 s caps: `SCAN_MAX_LINK_MB`, `SCAN_LINK_TIMEOUT_S`) and matched; TikTok/Instagram/YouTube-style pages are declined with a message asking for a screen recording.
- `POST /scan/match?live=true` is used by "Scan live" (desktop browsers): the page shares a tab/window and sends the last few seconds every 4 s; misses are not logged, the first hit is.
- Env vars: `SCAN_MAX_CLIP_MB`, `SCAN_MAX_CLIP_SECONDS`, `SCAN_MIN_CLIP_SECONDS`, `SCAN_ORB_FULL_SEARCH_MAX`, `SCAN_SIFT_FULL_SEARCH_MAX`.
- **Look-alike reviews (same room, different presenter or product).** Four guards, all of which can only make an answer stricter (they never turn "not found" into a match):
  1. *Which matches get checked.* Besides template-like videos, a match found by the 4x4 cells alone while at least `CELL_SUSPECT` (25%) of the picture keeps disagreeing is also checked against the real pictures (an overlay or another review from the same room both look like that to the fingerprints).
  2. *Order and pace over time.* For a MOVING original (frames differ by more than `PIX_MOVING` from one second to the next) the pixel check no longer uses "whichever original frame fits best". It reads the original 24 times a second around where the fingerprints say the recording belongs (`offset`), compares each recording frame there, and requires all frames to agree on one offset (spread under `PIX_FINE_SPREAD`): the same moments, in the same order, at the same pace. Still screens (charts, slides) keep the old behaviour, since there the moment does not matter.
  3. *The moving subject counts more.* In that check a disagreeing block on a part of the picture that moves in the original (hands, the product) counts `PIX_DYN_WEIGHT` times; the set behind the presenter is the same in every review from that room.
  4. *The voiceover.* `app/scan_speech.py`: faster-whisper ("tiny", CPU, int8; installed and baked into the image by the Dockerfile, `requirements-speech.txt`) transcribes the recording and the original around the matched moment; if fewer than `SPEECH_OK` (30%) of the recording's word PAIRS appear in the original, the match is dropped. No speech, no recogniser, or any error: it says nothing. `SCAN_SPEECH=0` switches it off, `SCAN_SPEECH_MODEL` picks another model size. Costs a few seconds of CPU.
  5. *Picture embeddings (optional, OFF by default).* `app/scan_embed.py`: set `SCAN_EMBED_MODEL` to an ONNX image model (DINOv2-small, a CLIP image tower...) and a recording whose frames are not close enough to the original's (`SCAN_EMBED_MIN`, default 0.5) is dropped. The right threshold depends on the model: calibrate it on real pairs before turning it on.
  Tested on synthetic look-alike reviews only (same set, different moving subject: rejected; true recording, also from the middle of the video: accepted; wrong place in time: rejected). The speech and picture-model steps were tested with stand-ins, not with the real models. Measure on real review footage before relying on them; the thresholds are starting points. The pixel check now also needs the fingerprint's `offset`, so it is passed through `match_query` -> `_confirmed_by_pixels` -> `confirm_recording(orig, recording, offset)`.
- **Template-like videos** (the picture hardly changes: a trading screen, a chat, a slide, a talking head in front of a fixed backdrop). The whole-frame fingerprint of such a video equals that of every other video made from the same template, so a look-alike with a different pair, price or name used to match. A video counts as template-like when at least 40% of its frames look like one typical picture (ordinary videos stay under about 20%), even if a few other screens come and go. A match to one of these (found by looks, not by a unique sound) is now confirmed against the real pictures (`scan_fp.pixel_check`): the recording is lined up with the original and almost every block of fine detail must agree, and the words and numbers on screen are read (OCR, Tesseract, installed in the Dockerfile) as a guard: a recording whose pictures agree but whose text mostly does not is rejected (on a ticking screen the exact moment is unknown, so the text is not held to a high bar). If the pictures disagree only because of an overlay, text that agrees almost perfectly can still confirm the match. Without Tesseract installed only the pictures are compared. It needs the recording itself, so a bare on-device fingerprint answers "not sure" and the app then sends the recording automatically. Costs one download of the original (a few MB) and roughly 10–15 s of CPU, only for these videos. A recording of an app's feed carries buttons, a caption and bars around the video, so the top 10%, bottom 32% and right 20% of the recording are not compared (`PIX_EDGE`). Limits: a look-alike that differs only in those edge areas is not told apart, and an overlay across the middle of the picture makes the check fail, which answers "not found" rather than guess.
- Fingerprint `grid3` (current) adds RootSIFT key-frame features, each marked as sitting on a changing or a still part of the picture (a match must also agree on the changing parts, so two videos that share a template, like trading-chart recordings with different pairs, are not confused) (about 1 MB per 30 s of video). Rows stored as `grid1` stay searchable (ORB only) until `--backfill` rebuilds them. A recording is matched on its video area only (`viewport_box` cuts the status bar, tab bar and browser bar), with SIFT + RANSAC on up to 14 key frames that must agree on video, moment, zoom and tilt, and a spread check so a shared caption or watermark can't match two different videos. Libraries up to 150 key frames are compared in full; larger ones use a shortlist (one matrix product), about 4 s per scan at 5,000 key frames and 8 s at 12,000 (`SCAN_SIFT_FULL_SEARCH_MAX`). Above that limit only candidates found by other checks are verified.
- The index is held in memory per web worker; fine for roughly 1–2k videos, beyond that it needs an ANN index.
- Web pages: `/scan` (upload a recording) and `/v/<id>` (public product page for a video).

## Counts (likes, comments, shares, saves, views, "bought & in carts")

- Every counter changes atomically in SQL and only when the row behind it really changed (`app/counters.py`): double taps and simultaneous requests count once each.
- `Product.cart_count` = units in carts + units bought and not cancelled; it refreshes automatically whenever a cart line or order is saved.
- Recount everything from the real rows: `GET /admin/counters/check` (report only), `POST /admin/counters/reconcile` (fix), or `python -m app.counters [--fix]`. Run `--fix` once after deploying: it replaces old drift and the invented demo numbers.

### Preview-picture matching of TikTok / YouTube links, and sharing to Lumin (Android)
- `POST /scan/link` with a TikTok/YouTube link fetches only the app's public oEmbed preview picture (never the video) and
  looks for one clearly closest uploaded video (`scan_fp.identify_still`). It is strict and finds roughly two thirds of
  ordinary thumbnails on synthetic data; a miss says "couldn't tell from the preview picture" and points to screen recording.
  Instagram and other apps have no public oEmbed we use, so they still get the screen-record message.
- Android: Chrome > menu > "Install app" adds Lumin to the system share sheet (`app/manifest.ts` share_target, `public/sw.js`).
  Shared videos/links open `/share`, which scans and jumps to `/v/<id>` on a match. iPhone Safari does not support share targets.

### Blocking
`POST/DELETE /users/{id}/block`, `GET /users/me/blocks`. A block hides both ways: videos, comments, products, profile and
people-search (app/blocking.py, applied inside app/visibility.py so every feed that already filters shadow-banned accounts
filters blocks too). It also ends any follow between the two accounts. Admins are exempt. Migration `0019_user_blocks`.
Not covered yet: orders/messages between two blocked accounts, and notifications already sent.

### Logging, errors and health
- One log line per request with a request id (also the `X-Request-ID` reply header); `LOG_LEVEL` sets the detail.
- Set `SENTRY_DSN` (and optionally `ENVIRONMENT=production`) to get error reports; unset = nothing is sent.
- `ENVIRONMENT=production` also hides `/docs`, `/redoc` and `/openapi.json`.
- `/health` is the host's restart check (no database). `/health/ready` also checks the database (503 when it is down): point an uptime monitor at it.

### Security notes
- Signup requires a password (8-128 characters); Google sign-in uses `/auth/google`.
- A password reset signs out every older session (`users.sessions_valid_after`, migration `0020`).
- Uploads: `POST /uploads/presigned-url` takes `file_size`; sizes over `MAX_IMAGE_MB` (10) / `MAX_VIDEO_MB` (200) get 413, and the
  signed URL only accepts exactly that many bytes. If uploads fail after deploying, set `SIGN_UPLOAD_SIZE=false`
  (the size check at request time stays on).
- The server trusts Railway's `X-Forwarded-For` (`FORWARDED_ALLOW_IPS`, default `*`) so rate limits are per caller, not per proxy.
- Still not done: email verification at signup, per-token revocation/refresh tokens, two-factor for admin accounts.

### Email verification (signup code)
Signup emails a 6-digit code (valid 15 minutes, 5 wrong guesses, resend every 60 s); the account only opens once
`POST /auth/verify-email` accepts it. Login with an unconfirmed account answers 403 `email_not_verified` and mails a fresh code.
Google sign-in and a completed password reset also count as proof of the address. Accounts that existed before are marked
verified by migration `0021`.
- Needs email sending to work: set `RESEND_API_KEY` and `EMAIL_FROM` on a domain you have verified in Resend. Resend's
  shared `onboarding@resend.dev` sender only delivers to your own address, so real users would never get a code.
- `REQUIRE_EMAIL_VERIFICATION=false` switches the step off (signup logs in straight away) - use it until email is set up.
- With no `RESEND_API_KEY` and `ENVIRONMENT` not `production`, the code is written to the server log (local development only).

## Admin protection (two-step login + lockout)

- **Admin routes need a two-step session.** Signing in with a password gives a token that cannot call `/admin/*` or
  other admin-only routes (403 `mfa_setup_required` / `mfa_required`). The admin console then asks for a 6-digit code
  from an authenticator app (first time: shows a setup key, confirm with the first code). Codes work once
  (replay-protected); 5 wrong codes lock the account for 15 minutes.
- **Password lockout (all accounts):** 8 wrong passwords in a row lock the account for 15 minutes (429). A correct
  login or password reset clears it. Trade-off: someone can lock another person out for 15 minutes.
- **Secrets** are stored encrypted (key derived from `JWT_SECRET_KEY`: changing that key breaks existing admin
  authenticator set-ups, so rotate it only deliberately).
- **Locked out of the console?** Set `REQUIRE_ADMIN_MFA=false` to allow admins without a code *only until they have
  enrolled*. An admin who already enabled two-step still needs their code. To reset someone who lost their phone, in the
  database: `UPDATE users SET totp_enabled=false, totp_secret=NULL, totp_last_step=NULL WHERE email='…';`
- Run `alembic upgrade head` (migration 0022 adds the columns; entrypoint does this on deploy).
- Tests: `tests/test_admin_mfa.py` (they need Postgres; CI runs them).

## Download my data

`POST /users/me/export` (Settings > Account > Download my data) returns one JSON file of what we hold about the caller
(`app/data_export.py`). It asks for the password when the account has one, is rate-limited to 3/hour, and is never cached.
It excludes secrets (password hash, two-step secret), other people's details (buyers' names/addresses on a seller's
sales, who blocked or reported them) and internal fingerprints; uploaded files appear as links. To include a new table, add
it to `OWN_TABLES` (a test checks every entry names a real column).

## Push notifications

Every in-app notification is also pushed to the person's subscribed devices (Web Push; `app/push.py`). It is **off until you
set keys** on the backend service:

1. Generate a key pair once: `npx web-push generate-vapid-keys` (prints a public and a private key).
2. Set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (e.g. `mailto:support@yourdomain.com`). Keep the pair
   forever: changing it silently drops everyone's subscriptions.
3. Redeploy (migration 0023 adds `push_subscriptions`; `pywebpush` is in requirements). The Settings toggle appears by itself
   once `GET /push/config` says enabled.

Notes: works in Chrome/Edge/Firefox and Android; on iPhone only after the site is added to the Home Screen (iOS 16.4+).
Sending happens after the database commit on a background thread, so a push problem can never fail a request or lose a
notification; dead devices (404/410) are removed automatically. Birthday reminders are not pushed. Native apps would add
FCM/APNs beside `_send_one`. Tests: `tests/test_push.py`.

## Deploying safely

See `../DEPLOY.md` for the full first-launch checklist and `.env.example` for every setting. Important: the demo data
(`app/seed.py`) has **public logins including an admin** and is therefore only loaded when `SEED_DEMO_DATA=true`
(docker-compose sets it; a real deployment never should). A real deployment only gets the starting categories
(`python -m app.seed --basics`, automatic). Every start prints a loud warning if public demo logins exist, and
`python -m app.seed --remove-demo` deletes them. Tests: `tests/test_seed_guard.py`.

## Scan on the device (POST /scan/match-features)
The same lookup as `/scan/match`, but the phone or browser computes the fingerprint itself and sends only that: a JSON body with the sound hashes (int32, base64), the times of the analysed frames (4 per second), and per orientation (`"0"` normal, `"1"` mirrored) the 64-bit frame hashes, the 4x4 cell hashes and their detail flags (all base64 bytes). Built by `lumin-app/lib/fingerprint` (a TypeScript port of `audio_hashes`, `phash`, `cell_hashes` in `app/scan_fp.py`) and read by `scan_fp.query_from_wire`, which validates everything (the input is untrusted: sizes, counts and base64 are checked, anything off is a 400). `WIRE_ALGO` must match on both sides; an old app gets "please update".

It runs the cascade without its third stage (ORB local features need the pixels), so a miss comes back with `deeper_check: true` and the app then uploads the recording automatically for the full cascade. Same limits, same rate limiting (60/minute), same hidden-poster and moderation-hold rules as `/scan/match`.

Tests: `tests/test_scan_features.py` (needs a database for the endpoint tests and ffmpeg for the video ones), `lumin-app/tests/fingerprint.test.ts` (agreement with Python, regenerate fixtures with `scripts/make_fingerprint_fixtures.py`), and `scripts/ondevice_e2e/check_in_browser.py` (real Chromium, synthetic videos).

## Scan follow-ups: verified original + payout pause

- **Verified original** (`VideoPost.verified_original`, shown as a badge in the feed and on scan results): the video has a good
  fingerprint of its current file and no copy review against it. Open review on either side removes it; a confirmed copy
  loses it, the genuine earlier original keeps it; dismissal restores it. It means "Lumin has seen no earlier copy", not that
  the product is genuine. Kept current by `scan_service.refresh_verified` (after fingerprinting, when a flag is resolved, and
  reset when a video is replaced). Migration 0024 backfills it; run `python -m app.scan_service --backfill` so older videos get fingerprinted.
- **Payout pause**: while a copy review is open on the seller's OWN video (the later upload), payouts for orders that came
  from that video wait (`scan_service.payout_hold_ids`, checked in `escrow.release_to_merchant`). The original poster is never
  held, and a seller who only tagged a product on a creator's flagged video is not held. Buyer money is untouched. Orders show
  `payout_on_hold`; closing the review (dismiss or confirm) releases eligible orders automatically. Tests: `tests/test_scan_followups.py`.

## Background jobs and the worker

Slow work (re-encoding an uploaded video, fingerprinting it for scan) is queued in the `jobs` table in the same
transaction that creates the post (`app/jobs.py`), then run by a worker: `python -m app.worker` as its own service, or,
by default, a thread inside the web server (`RUN_JOBS_IN_WEB`). Several workers are safe (`FOR UPDATE SKIP LOCKED`); a job
whose worker died is retried after 30 minutes; failures retry 3 times with growing delays, then stay `failed`.
`GET /admin/jobs` shows the queue. Note the scan *lookup* (someone uploading a recording to identify) still runs in the
request, because the person is waiting for the answer. Tests: `tests/test_jobs.py`.

## Seller verification

Manual review (`app/routers/verification.py`): a seller sends legal name + ID photo + selfie; an admin approves or rejects in the
console. Photos go to a PRIVATE bucket (`R2_PRIVATE_BUCKET_NAME`; feature is off without it, nothing is ever stored publicly), are
magic-byte checked, shown to the admin through links that expire in 5 minutes, and **deleted at review time** (only the decision is
kept). Approval sets `MerchantAccount.verified_at` and the "Verified seller" badge (`VideoPost.merchant_verified`).
`REQUIRE_VERIFIED_SELLERS_FOR_PAYOUT=true` holds unverified sellers' payouts. Account deletion removes pending photos; the data
export includes the decision but never the photo keys. Tests: `tests/test_seller_verification.py`.

## Native app push

`POST /push/device` registers a phone's Firebase token (`PushDevice`, migration 0027); `app/push.py` sends to it through Firebase
Cloud Messaging (HTTP v1) when `FIREBASE_SERVICE_ACCOUNT_JSON` is set, alongside browser push. Dead tokens are removed on
the first refused send. See `../NATIVE.md`. Tests: `tests/test_push.py`.

## Saved videos with the platform's mark (`app/watermark.py`)
"Save video" with the watermark switch on calls `POST /video-posts/{id}/watermarked-download`. The server (ffmpeg + Pillow) burns the "LUMIN" mark and the poster's name into every frame, appends a 2-second branded end card, keeps the sound, and returns the public address of an MP4 stored under `watermarked/` in the bucket (reused by later downloads). A normal video takes a few seconds, not the length of the video. Runs in the web service (no worker needed); `WATERMARK_CONCURRENCY` (default 2) limits simultaneous encodes, and a request over the limit gets 429. Videos over 300 seconds (5 minutes), or not stored in our bucket, get `url: null` and the app saves the plain file. Needs ffmpeg and a font (`fonts-dejavu-core`, both in the Dockerfile). The marked copies are only a cache and can be regenerated, so add a lifecycle rule to the bucket that deletes objects with the `watermarked/` prefix after, say, 30 days (Cloudflare R2 → bucket → Settings → Object lifecycle rules); they are not deleted when a video is deleted.

## Sponsored twins (scan result screen)

A seller can promote one of their products as a "Sponsored twin" (merchant dashboard -> Products -> menu -> *Promote as a twin*; API `PUT /merchant/sponsored-twins/{product_id}`). The scan result screen asks `GET /sponsored-twins/for-video/{id}` (now a list) and shows a COMPLETE KIT, not a capped list: one product for every kind that completes what is in the video (trousers AND shoes AND a jacket AND a bag...; never two of one kind), in a steady order, and within each kind the product rotates (least-shown first, ties shuffled) so when many sellers promote that kind every one gets a turn. They sit under the video's own products, as an "Ad"-labelled product card (`components/SponsoredTwinCard.tsx`) on BOTH the scan result screen and the shop feed's product sheet: the picture, name and price are visible straight away, with Buy now and Add to cart on the card (a size/colour choice is made on the card like any other product).  `app/sponsored.py` picks it, and it COMPLEMENTS the video rather than competing with it: a t-shirt video gets trousers, shoes or a jacket; a hair clipper gets hair cream or beard care (or a top); earbuds get a charger. It is never the same kind of product as one in the video, in stock, and neither one of the video's products nor from one of its sellers. The kind of a product is read from its name (then description) with a keyword table, and `COMPLEMENTS` lists which kinds go together; both are plain data at the top of the file, so add words or pairings there (English only for now). Among the matching ones the least-shown goes first so sellers take turns. The kit also has to feel like one outfit: a product's price must sit within 0.4x to 2.5x of the video's own prices (`BAND_LOW`/`BAND_HIGH` in `app/sponsored.py`), so no 900 jacket next to a 20 tee; unknown price = not filtered. It is also matched on STYLE, with NO seller questions: `profile_of` reads every product (the video's and the sponsor's) from what is already entered: name, description, colour list, price and the category/section it sits in (the section fills the gap when the name is vague). The optional `style`/`color`/`audience` fields on `PUT /merchant/sponsored-twins/{id}` still exist for old data but the form no longer asks. Same style, neutral or matching colour and same audience score higher; clashes (formal next to sportswear, menswear next to womenswear) are left out; equally close matches take turns. And it LEARNS: every pair of sponsored product and video product counts shown / taps / add-to-carts / buys (`sponsored_pairs`, migration `0038`; the app sends `post_id` and an action with `/click`), and pairs shoppers act on score higher (`learned_score`, smoothed so a new pair is not trusted early). The style tables and weights are plain data/functions at the top of `app/sponsored.py`. CHOICES: each complementary kind shows a lead product plus up to one equally good alternative (`PER_KIND = 2`, at most `MAX_TILES = 10` in the strip; every kind's lead is placed before any second choice, a weaker match never takes the second slot). The strip is grouped by kind with a chip row ("Shoes · 2") that slides to a group, and *Add the whole look* adds only the lead of each kind. The API returns `lead` per card. THE CARD (`lumin-app/components/SponsoredTwinCard.tsx`) is built for no friction: big story-style pictures with a kind label (Shoes, Jacket...), a round + on every tile that adds it to the cart in ONE tap (when nothing needs choosing; a product with several sizes opens and points at its sizes instead of guessing), an *Add the whole look* button that adds everything that needs no choice and then points at the first item that needs a size, a running *N in cart* total, and for the picked one a big picture with the price on it, colour dots, sizes, *Add to cart · $price* as the main button and *Buy now* beside it. Every add and buy is credited to the card (pay per sale). The API now also returns each card's `kind`. Not built: a bundle checkout in one payment (items go to the cart; Buy now is one product), and a bundle discount. SEE IT WITHOUT REAL SELLERS: the web service's start script (`entrypoint.sh`) now runs `python -m app.seed --sponsored-demo` on every deploy (a no-op once present, and it never fails the deploy). It adds three demo sellers with 17 promoted products (trousers, sneakers, a jacket, a tote, a belt, a watch, sunglasses, a beanie, hair cream, beard kit, face cream, cologne, cables, charger, phone case; each with a coloured picture and a real description) and a hair-clipper shop video. A tee video then shows trousers, sneakers, jacket, tote, watch and cologne; the clipper shows hair cream, beard kit, cologne and face cream. These accounts have a random password nobody knows, so there is no public login. It is ON by default for now: when you have seen enough, set `SEED_SPONSORED_DEMO=false` on the web service and run `python -m app.seed --remove-sponsored-demo` (`railway ssh`) to delete what it added. The strip is a horizontal story-style row of big pictures (tap one to see it in the card below with Buy now / Add to cart). AI READING (optional): set `ANTHROPIC_API_KEY` (and optionally `PRODUCT_AI_MODEL`, default `claude-haiku-4-5-20251001`) on the service that runs jobs (the worker, or the web service when jobs run inside it). A background job (`profile_product`, `app/product_ai.py`) then reads each product ONCE (name, description, section, colours, price and its first photo) and saves its kind, style, audience and colours in `product_profiles` (migration `0040`), in the matcher's own words; anything the model says outside those lists is dropped. It is queued when a seller promotes a product, and for any product (the video's or a sponsor's) that has no profile yet or was edited since, the next time a kit is built. The AI's answer wins; the keyword rules fill whatever it left out, and are used entirely when there is no key or the call fails. Cost: one small call per product, not per view. Not tested against the live API from here. PAY PER SALE: sellers pay nothing to be shown; when a shopper buys through a sponsored card the platform keeps `SPONSORED_SALE_PERCENT` (default 10) of that sale. The app remembers which card the shopper used for a product (`lib/sponsoredAttribution.ts`, 30 minutes) and sends `sponsored_twin_id` with the cart-add / buy-now call; the server only believes it when that twin really is for the product (`resolve_twin`). The cart line, payment and order carry it (migration `0039`); the order snapshots the percent and the fee (`orders.sponsored_fee_percent`, `sponsored_fee`) and `escrow.release_to_merchant` pays the seller the price MINUS the fee. Cancelled and refunded orders never pay out, so they cost nothing. The seller sees sales, value and fee per promoted product (`GET /merchant/sponsored-twins`). Last-touch: the most recent card used for that product wins. Not built: invoicing, a minimum or monthly cap, or an admin screen for the percent (it is the env var). The percent is shown in the promote form. The migration and the pair counting were written without a database to run them against, so try them on a copy of your data first. Kind unknown or nothing pairs: no ad. Never shown on "not found". No bidding or billing yet: offers (the collapsed row), opens (`/reveal`) and taps through to the product (`/click`) are counted per product (`sponsored_twins` table, migrations `0030`, `0031`) and shown to the seller. The ranking is unit-tested (`tests/test_sponsored.py`); the routes and migration were written without a database to run them against, so try them once on a copy of your data before relying on them.

## Scanning a video that plays in only part of the screen

A desktop recording shows a page, a header and a comments column around a video in the middle, so the whole-frame fingerprints are mostly page and match nothing (reproduced: a video centred in a 1280x720 recording was NOT found). Now:
- **Automatic.** `scan_fp.find_video_rect` finds the largest SOLID rectangle of change over the clip (a video changes everywhere inside its frame and nowhere outside it; a scrolling comments strip is smaller or ragged, scattered motion is not solid). `scan_service.match_clip` tries the whole recording first, exactly as before, and only when that finds nothing and a rectangle exists does it look again at just that rectangle (`extract_query(path, crop=rect)`). Never done when the video fills the screen, nothing moves, or the motion is too small/ragged. The same video in the same page was found; a different video in the same page is still not found (tests/test_scan_rect.py).
- **Manual (live scan, desktop browsers).** "Video in the middle of a big screen? Pick the video area" shows a picture of the shared screen; the person drags a box, and only that part is recorded and sent (drawn onto a canvas that is recorded with the share's sound; `lib/liveScan.ts`, `components/AreaPicker.tsx`). Any problem falls back to the whole screen.
Limits: a STILL video (no motion) has no detectable rectangle, so only the manual box helps there; a recording where something larger than the video moves (a big animated page) can pick the wrong rectangle, in which case the whole-screen answer is still tried first. A fingerprint computed on the device is still of the whole screen; when it is not sure the app sends the recording, which gets the rectangle treatment. Only tested on synthetic desktop recordings so far.

## Videos recorded on a desktop

A video that a phone would struggle to play (a screen recording saved as WebM, HEVC from a Mac, 4K or 60 fps footage,
10-bit colour, a very high bitrate, or sound in an unusual codec) is converted once, in the background after upload, to
H.264 + AAC in an MP4 with the index at the front, at most 1080p and 30 fps (`app/video_compat.py`, run from
`app/video_optimize.py`). A video already in that shape is left alone. An `.mp4` is replaced under the same URL; a `.mov`
or `.webm` becomes a new `.mp4` and the post is pointed at it. Needs `ffmpeg` on the worker, as the lite copy already does.

Older uploads: `python -m app.video_optimize --backfill-all` checks every video and converts the ones that need it.

## Scan results in the admin console

**Scan results** (admin console, left menu) shows how "scan a video" is doing: scans in the last 7/30/90 days, the share that found a
video, the average recording length, which check found each one (sound, picture, details...), the most scanned videos, a
per-day table and the latest 30 scans. It reads the `video_scans` table through `GET /admin/scan-stats?days=30`. No person is
shown, only what was scanned. A live scan only records its hit, so "not found" counts recordings and files, not every
few-second live check.

## The same video uploaded more than once

Anybody may post and tag products on a similar video - this is a shop, not a copyright service - so **nothing is flagged automatically**. Two identical copies in the search index would make every scan of that video "ambiguous" (a miss), so whole-video copies (starts together, about the same length; same poster or different) are grouped: the copy's fingerprint row gets `dup_of_id` = the earliest post (migration `0032`). A scan always finds the **first upload** and shows only ITS twinned products. Copies are not searched; if the original is deleted, replaced or no longer searchable, its copies become searchable again. Posts uploaded before this change are linked when they are next re-fingerprinted.

A **review opens only when someone reports it**: the video report sheet has "Copied from my video" (`ReportReason.copied`, migration `0033`). If the reported video is a known copy of an earlier upload by a DIFFERENT person, a `VideoMatchFlag` (stage `reported`) opens: the later video loses the verified badge and the payout of orders from it waits. Reports on the first upload, on your own repeat, on a video with no known original, or with any other reason open nothing extra. Buyers and viewers never see the review. Admins decide in **Copy reports** (admin console): *Dismiss* (fine) or *Confirm copy* (then remove it from Content); closing it releases the held payouts. The new tests in `tests/test_scan_api.py` were written without a database to run them; run them once.

**Hidden-twin notification.** When an admin flags a twin as a poor match, the poster's notification is type `twin_flagged` (migration `0034`) with the video as its target. Tapping it opens the seller dashboard -> Posts with that video in the editor, already on the twin step, so the product can be mapped again.

**Twin review (admin).** Each row shows the video moment (looping) next to the tagged product's photos and price so the reviewer compares them by eye. The admin console also works on phone and tablet: below the large breakpoint the left menu becomes a drawer opened from the top bar, and wide tables scroll sideways.

**Loading screens.** The app opens on a splash (logo + the "Twin" loader: two orbs that circle, merge into one glow and split again; `components/TwinLoader.tsx`, CSS in `globals.css`). It is part of the first server-rendered paint and fades out once the first feed request finishes (`markAppReady`), after at least 0.9 s. On a slow link it adds a line ("Taking longer than usual…"; "You're offline…"). While the app is running, `components/NetworkStatus.tsx` shows a small pill at the top when you are offline, when a request has waited more than 4 s (slow connection), or just after the network returns. Requests report themselves through `lib/netState.ts` (scan uploads are not counted, they are legitimately long). The old plain "Loading…" lines now use the same mark. Respects "reduce motion".

**Dark mode.** Settings -> Appearance: Light, Dark or Match my phone (default), remembered on the device; it works on the website and in the native app (which loads the website). Colours are theme variables (`--c-surface/panel/box/line/text/mute` in `app/globals.css`, exposed as `bg-surface`, `bg-panel`, `text-text`, ... in `tailwind.config.ts`); the `dark` class on `<html>` is set by an inline script in `app/layout.tsx` before the first paint (no white flash) and kept in step by `lib/theme.ts`. Chips and buttons that sit ON TOP OF VIDEO (the round icon buttons in the player, the Shop pill) carry `theme-light`, so they stay light-with-dark-icons in either theme. When adding a new screen use `bg-surface` (not `bg-white`) for cards and sheets. The admin console is light only. Not changed: the native app's own launch splash (`lumin-native/capacitor.config.ts`, white) - a dark launch splash needs a native resource per platform.

**Opening-screen logo.** The loading screen at app start uses its own pictures, separate from the app logo: `lumin-app/public/brand/splash.png` (light theme) and `lumin-app/public/brand/splash-dark.png` (dark theme). Replace those two files with yours (square PNG with a transparent background, at least 512x512, same file names), then redeploy the website. Both currently hold a copy of the app logo. If one is missing the screen falls back to the other, then to `logo.png`. The app logo itself is still `public/brand/logo.png`.

**Videos uploaded twice before copies were grouped.** Byte-identical fingerprints are never searched twice (only the earliest counts), so those videos scan again immediately after deploying. Migration `0035` closes the review flags the old automatic check had opened (so their verified badges come back), and marks every existing fingerprint "not yet checked"; the worker then re-checks them one at a time when idle (`relink_one`), linking copies and refreshing each badge. To do it right away instead: `python -m app.scan_service --relink`. Cost: each re-check searches the library once, fine for hundreds of videos, slow for tens of thousands (it only runs once per video).

**Scan sheet animation.** While a scan is looking (and during a live scan) the sheet shows the Twin mark with rings spreading outward, with the status line under it (`ScanPulse` in `components/TwinLoader.tsx`), instead of grey placeholder bars.

**Desktop action column.** On desktop the like / comment / save / share buttons sit just to the right of the video frame (bottom-aligned with it, in the page's own colours, so they no longer cover the video) whenever there are at least 76 px free on each side of the frame. With a side sheet open, a narrow window, or a very wide video there is no room, and they stay inside the video as before (`railOutside` in `components/VideoStage.tsx`). Phone and tablet are unchanged.

**Sheets hold the video (phone/tablet).** While any sheet is open over a video (comments, the product sheet, categories, search-for-a-twin, the full caption, more / report / share, the avatar viewer) the video does not move on when it ends: it loops (or, with Lumin Lite on, just stops). It moves on after the sheet is closed. Desktop is unchanged.

**Moving watermark (TikTok-style).** In a saved video the mark rests top-left for 7 s, fades out (0.4 s), reappears (fading in over 0.4 s) at bottom-right, rests, then does the same back, repeating every 14 s, on every frame of the video; the end card follows as before. Timings: `MOVE_*` in `app/watermark.py`. Checked on a real clip (frames around the 7 s move: fading out, empty, fading in at the other corner). Copies made earlier are not reused (cache key v5): the next download rebuilds them.

**Watchlist.** A saved video reopens in the feed it was saved from: shop videos in the shop player, Discover videos in Discover. Swiping moves through the other saved videos of that same feed, and Back returns to the watchlist. The list has All / Shop / Discover tabs with counts, and each tile is tagged Shop or Discover. `VideoPost.feed` carries the feed (`isShopPost` in `lib/types.ts` falls back to "has products" for a post made on the device and not yet reloaded).

The opening-screen logos are read when the page is built/served and written into the first HTML (as data), so they appear with the first paint, before the animation, instead of loading afterwards; keep both files small (under ~50 KB each).

**Scan by link** only accepts shop videos (with products). A link to a Discover video answers "That link is a Discover video. Scan only finds products in shop videos"; a link to a repost or a retwin scans the original.

**Loading and network (update).** Videos show a small spinning ring while they wait for data (after 350 ms, never while paused). The opening screen has no wording any more, only the logo and loader. The network pill now appears only for a severe outage: offline, a request stuck for 20 s, or 3 failed-to-connect requests in a row; ordinary slowness shows nothing. "Back online" shows briefly after such an outage. Constants: `SEVERE_MS`, `SEVERE_FAILURES` in `lumin-app/lib/netState.ts`.

**Scan reliability (update).** Scans that failed once and worked on a retry: (1) each web worker now builds the scan library in the background at startup (`_warm_scan_index` in `app/main.py`), so the first scans after a deploy are not slow enough to time out; (2) the on-device fingerprint no longer hangs on the first frame in browsers that fire no "seeked" for a seek to the same time (`seek()` in `lumin-app/lib/fingerprint/clip.ts`); (3) a dropped connection is retried up to 3 times (`withRetry` in `lib/api.ts`); (4) if the fingerprint says "not found" and the follow-up upload of the recording can't get through, the "not found" answer is shown with the deeper-check button, not an error. The generic error now says "Couldn't reach the server" for network failures.

**Products need a picture.** A new product cannot be saved without at least one picture (the form keeps Save off and says why; `POST /merchant/products` answers 422 with no image, and `PATCH` cannot empty the gallery).

**Dark logo.** The logo in the top bar and the category sheet has a dark-theme picture, `lumin-app/public/brand/logo-dark.png` (a copy of the light one for now: replace it with your own; delete it to use logo.png on dark too).

**Continue where you left off, and recently watched videos kept on the device.** Swiping back to a video resumes it from where it was left (session only, last 60 videos; `rememberPosition` in `lumin-app/lib/playbackTime.ts`). The last 6 videos a person really watched (3 s or more, none over 40 MB) are saved in the background a few seconds after swiping off them, one at a time (`lumin-app/lib/videoCache.ts`, Cache API), and play from there next time, including with no network. It keeps whichever copy was played, so with Lumin Lite on it is the smaller Lite copy. It needs the video host (the R2 bucket / its public domain) to send `Access-Control-Allow-Origin` for your site on GET; without that header nothing is saved and playback is unchanged. Not done on iPhone/iPad: keeping a video reads the whole file into memory, and WebKit kills (and auto-reloads) a tab that uses too much, so videos there always play from the network. Cleared on logout. Constants: `MAX_VIDEOS`, `MAX_BYTES`, `SAVE_DELAY_MS`.

**Faster start on every swipe (update).** The next video used to get no head start on phones (it was only mounted when the swipe began, and browsers treat a hidden preload as metadata only). Now, 1.5 s after the current video starts, the next one is downloaded in full into the device store (`prefetchVideo` in `lumin-app/lib/videoCache.ts`, called from `components/VideoPrefetch.tsx`) and plays from there when swiped to; if the video host does not allow that (CORS), it falls back to the old hidden-element preload. A video being dragged in is also warmed up silently (muted play then pause, `VideoStage.tsx`). Not done on Lumin Lite or slow / data-saver connections (they would defeat their purpose). Cost: the next video is downloaded even if the person never swipes to it.

**Lumin Lite and data (update).** Nothing is downloaded twice any more: the earlier "save a watched video again afterwards" step is gone. A video is fetched once, ahead of the swipe, plays from the device store and stays there (last 6). Lumin Lite now also fetches ahead, but only the small Lite copy of the next video (and nothing when the browser's Data Saver is on, or when a video has no Lite copy). If Lite still uses a lot of data, check that Lite copies exist: they are made by the background optimiser (`app/video_optimize.py`), so a video with no `lite_video_url` plays at full size even on Lite. Run `python -m app.video_optimize --backfill` for older videos.

**Lite starts faster (update).** The next TWO shop videos are fetched ahead one after another (Lite: after 0.25 s, the small copy; full size: after 1.5 s); the device store keeps the last 8. New Lite copies are capped at 700 kbit/s with a key frame every 48 frames (`LITE_MAXRATE`, `app/video_optimize.py`), so they are small and start quickly; existing Lite copies are unchanged until re-made.

## Adaptive streaming (HLS)
Every video is also published as a stream: the same video cut into 2-second pieces at up to four qualities (240p, 360p, 540p, 720p; never above the original), plus a master playlist (`app/video_optimize.py`, step 3). The player starts on the smallest quality so the first picture shows at once, then climbs as the connection allows, and drops back if it slows, as Facebook and TikTok do. Lumin Lite plays `lite.m3u8` (the two smallest qualities only). The mp4 files stay as the fallback: a video without a stream, or a browser that can't play one, uses them as before.

- **Storage:** `hls/<id>/` in the video bucket (pieces and playlists, long cache header), address in `video_posts.hls_url` (migration 0036). Deleted with the video / the account, and replaced when the video is replaced. Measured on a real 20-second clip: 12.2 MB across all four qualities in 46 files, about 9 MB per 15 seconds, on top of the mp4 and the Lite copy. Plan for roughly three times the storage per video compared with the mp4 alone (busy footage is the high end; a talking head or static scene comes out much smaller, see *Encoding* below).
- **Made by:** the same background job as the Lite copy (needs ffmpeg: the worker). **Older videos:** `python -m app.video_optimize --backfill-hls`.
- **App:** `lumin-app/lib/hls.ts`. Safari and iPhone play HLS themselves; other browsers load `hls.js` (new dependency in `package.json`, loaded only when a video needs it). The next two videos are warmed up (playlists plus first two pieces, at the quality this connection has been sustaining, about 200 KB each, so about 400 KB per swipe), cheap enough to do on Lumin Lite too; nothing is fetched (not even the player library) when the browser's Data Saver is on.
- **Encoding:** each quality is quality-based (x264 CRF 28/26/24/23 from 240p to 720p) with the old fixed bit rate kept only as a ceiling (`HLS_LADDER` in `app/video_optimize.py`), so easy videos shrink and busy ones can't exceed the cap. The cap is what the master playlist advertises as `BANDWIDTH`.
- **Start quality:** the player remembers the last bandwidth it measured (`lumin_hls_bw` in sessionStorage) and starts the next video near that quality instead of always at 240p; a cold session still starts on the smallest. `hls.js` is downloaded as soon as the feed shows (`preloadHls`), not when the first video asks for it. Clips of 45 s or less keep the whole video buffered, so a loop or replay doesn't re-download the start.
- **Native players (Safari, iPhone):** they play the playlist themselves, so the start-quality, buffer and cap settings above do not apply there, only the two-quality Lite playlist does. Test on real iPhones and Android browsers that report native HLS support.
- **Measuring it:** `lib/hls.ts` batches playback measurements to `POST /hls-metrics` (table `hls_metrics`, migration 0037): `ttff` (time to first frame, for both streaming, `is_hls=true`, and plain mp4, `is_hls=false`, so they can be compared), `stall` (ms paused to rebuffer), `level_reached` (highest quality rung per playback) and `fallback` (streaming gave up, mp4 took over), with `navigator.connection.effectiveType` where the browser exposes it. Example: `SELECT is_hls, lite, percentile_cont(0.5) WITHIN GROUP (ORDER BY value_ms) FROM hls_metrics WHERE kind='ttff' GROUP BY 1,2;`
- **Bucket setting required:** the video host (R2 bucket / its public domain) must send `Access-Control-Allow-Origin` for your site on GET, including for `.m3u8` and `.ts` files, because the player reads them from script. Without it, hls.js can't play and the app falls back to the mp4 automatically (Safari/iPhone are not affected).
- **Not kept offline:** a streamed video isn't saved on the device for offline replay (only videos without a stream still use the device store).


## Price colour

Prices use the `--c-price` token (`lumin-app/app/globals.css`): black on the light theme and white on the dark one, extra bold, like a marketplace, instead of the brand pink. The brand pink stays on buttons, the active states and the discount amount. Used by the product card, product page, tiles, carousel, cart, orders and the scan result.

## Sale price (the struck-through price)

A seller's *Discount %* on a product is now real: `app/pricing.py`'s `effective_price(price, discount_percent)` is the ONE place that decides what a unit costs (list price less the percent, rounded to the cent). It is exposed as `sale_price` on `ProductRead` and used everywhere money is charged: the buy-now and cart payment subtotals, the order snapshot (`orders.price`, which also drives payouts, refunds and the sponsored-sale fee), the discount-code preview and the per-merchant shipping subtotals. Before this, the listed discount was saved but NOT applied at checkout. The app shows it through `lib/price.ts` (`unitPrice`, `onSale`, `savePercent`, `sumCents`) and `components/PriceTag.tsx`: the price extra bold (black on light, white on dark) with the list price struck through in red and the percent off (`--c-sale`). Cart lines and all totals use the sale price, so what is shown is what is charged. Orders already placed keep the price they were placed at. Untested against a database or Paystack from here: place a test order for a discounted product and check that the amount charged equals the sale price. Tests: `tests/test_pricing.py`.

## Tamper-proof bags and the live test (step 1)

A seller films ONE uncut live test of an order's product (Merchant > Orders > **Go live test**), seals it in a Lumin tamper-proof
bag and scans the bag's QR code in the same recording. The scan ends the test and ties the bag, the order and the video together.

- **QR labels:** Admin > Sealed bags > Print batches > *Make and download PDF*. Each bag gets a 100-bit random code. Only its sha256 is
  stored, so the PDF is the one place the codes can be read: send it to the bag manufacturer straight away (A4, print at 100%,
  45 x 40 mm labels with the QR, the serial and the code in words as a backup). Assign a batch to the seller it was sold to
  (the seller id at creation, or *Assign* later): only that seller can seal with those bags. `SEAL_ALLOW_UNASSIGNED=true` lets any
  seller use an unowned bag (testing only).
- **Status, one way only:** `unused` -> `preview_used` (sealed in a live test) -> `in_transit` -> `delivered`; `void` is the exit for a
  lost or damaged bag. The row is locked while the status changes, so two scans of one bag cannot both win, and every change is
  written to `seal_events`. A delivered or void bag can never be used again. (`in_transit` and `delivered` are set by the courier
  and buyer steps, which are the next phase; the rules for them are already in `app/seals.py`.)
- **Evidence:** the server starts the clock when the test opens, the app burns the order's code and the time into every frame,
  the video must be at least `SEAL_MIN_TEST_SECONDS` (20) long and no longer than the time the server saw pass, and the server
  hashes the stored file itself (sha256). Videos go to the private bucket when `R2_PRIVATE_BUCKET_NAME` is set. What the seller
  ticked as shown (screen, sound, ...) is kept with the test for the dispute review.
- **Shipping rule:** `SEAL_REQUIRED_TO_SHIP=true` refuses "Mark as shipped" until the order has a sealed live test. Off by default.
- Migration `0041_seal_bags`. New dependency: `reportlab` (the print sheet). The app adds `jsqr` (reads the QR in the browser).

## Delivery of sealed orders, the delivery code and the 48-hour dispute window (step 2)

- **Shipment:** sealing a bag creates a `shipments` row (`awaiting_pickup`) and asks the courier for a driver (`app/courier.py`).
  The courier is swappable: `COURIER=manual` (default) means an admin drives it from Admin > Shipments ("Driver collected it", then
  "Confirm delivery" with the code). A real courier (Terminal Africa, ...) is a class in `app/courier.py` plus calls to
  `POST /courier/pickups/accept` and `POST /courier/deliveries/confirm` with the header `X-Courier-Key` = `COURIER_API_KEY`
  (the endpoints refuse everything while that is unset). Its own OTP/webhook can replace ours later without touching the rest.
- **Pickup:** bag `preview_used` -> `in_transit`, order -> `shipped`, buyer and seller are notified.
- **At the door:** the buyer taps *Package arrived?* on My Orders, says whether the seal is intact and scans the bag's QR (or types
  the code under it). Opened: the delivery is refused, nothing is paid, it shows in Admin > Shipments. Intact: a 6-digit code is
  shown (valid 30 minutes, 5 wrong tries, at most 5 codes per shipment, only a hash stored) that the buyer reads to the driver.
- **Delivered:** a right code moves the bag to `delivered` for ever (it can never be sealed or scanned into anything again), the
  order to `delivered` and starts the claim window. A seller cannot mark a sealed order shipped or delivered by hand any more.
- **Dispute window:** `CLAIM_WINDOW_HOURS` (default 48). The buyer picks what is wrong (screen, sound, buttons, power, camera, fit,
  damaged, missing parts, wrong item, not as described, other) and records the product. Admin > Disputes shows each claim with a
  suggestion from the seller's live test: a fault the seller ticked as shown working = "covered, no refund"; a fault never shown (or
  no live test) = "buyer likely wins"; damage and the like = "a person compares the videos". It is only a suggestion; a person decides.
- Migration `0042_shipments_claim_reasons`.

## Selling the bags in the shop (step 3)

The bags are sold like any other product by a normal merchant account (the "Lumin shop"):
1. Create that user and its merchant account and list a product ("Pack of 10 tamper-proof bags"). Stock/price as usual.
2. Admin > Sealed bags > **Bag shop**: paste the product id and the number of bags one unit comes with (`products.seal_pack_size`).
3. Print batches (Print batches tab) and send the PDF to the manufacturer. The printed, unowned bags are the stock.
4. When someone buys the product, that many free bags are reserved to the buyer as the order is created
   (`app/seal_packs.py`); the shop's order shows exactly which serials to pack and ship, and My Orders shows them to the buyer.
   Bags belong to the buyer from that moment, so one stolen in the post cannot be sealed by anyone else. If the printed stock has
   run out the order waits; print more and press *Assign now* (or just open the shop's orders list: it fills pending packs).
5. A cancelled pack gives its unused bags back to the stock. A pack order needs no live test and is exempt from
   `SEAL_REQUIRED_TO_SHIP`. The money is the platform's own, so there is no seller payout for these orders.
- Migration `0043_seal_packs`.

## Settling refused and lost deliveries, reminders, risk signals, serial proof (step 4)

- **Refused at the door:** Admin > Shipments > *Refused* shows the buyer's note and photo. *Refund the buyer* refunds the order's price,
  cancels the order, voids the bag and records who bears the cost (courier / seller / Lumin; bookkeeping only). *Deliver again* puts it
  back in transit for a fresh check. Needs the order's funds still held (the normal case: nothing is paid until the claim window ends).
- **Lost in transit:** the *Lost* button on an in-transit shipment does the same refund and voids the bag.
- **Cancelling a sealed order:** while it waits for a driver the bag is voided and the shipment closed; once a driver has it, cancelling is
  refused (the buyer refuses at the door, or an admin settles it).
- **Reminders:** every 10 minutes the job loop sends one notice each for a bag nobody collected in 24 hours (to the seller) and a package
  with no door check-in after 72 hours (to the buyer). Both also show as "Stalled" in Admin > Shipments.
- **Risk signals** (Admin > Sealed bags > Risk signals, and on each dispute): a seller with a high dispute rate (`RISK_DISPUTE_RATE` 0.3
  over at least `RISK_MIN_ORDERS` 3 delivered orders), disputes that went against them, refused deliveries (`RISK_REFUSALS` 2); a buyer
  and seller trading `RISK_REPEAT_PAIR_ORDERS` (3) times in 30 days; a buyer with `RISK_BUYER_CLAIMS` (3) claims. Warnings only, never automatic.
- **Serial / IMEI proof:** set `SEAL_SERIAL_PROOF_OVER` to a price; orders at or above it can't be sealed unless the seller ticked
  "Serial / IMEI" (shown on camera). 0 = off (default).
- Migration `0044_shipment_resolution`.

## Clear cases decided without a person, and appeals (step 5)

- **Three lanes** (app/claim_review.py), based on the seller's live test:
  1. *Clear buyer win* (a fault the test never showed, or no live test): with `AUTO_REFUND_CLEAR_CASES=true` (default **off**) the claim is
     refunded the moment it is filed, unless any warning in `app/fraud_signals.py` applies to the seller, the buyer or the pair.
  2. *Covered by the live test*: never denied automatically. Admin > Disputes shows the seller's video next to the claim and a one-click
     "I watched it: confirm covered, deny" button.
  3. Everything else (damage, wrong item, missing parts, any warning): a person decides, as before.
- **Appeals:** the losing side (the buyer after a denial, the seller after a refund) can appeal once, within `APPEAL_WINDOW_HOURS` (48) of the
  decision (My Orders for buyers, the Orders tab for sellers). Admin > Disputes > Appeals: keep the decision, or overturn it. A buyer's
  winning appeal refunds them if the funds are still held (otherwise it tells you to settle by hand). A seller's winning appeal cannot take
  back an existing refund: it is recorded as "overturned (manual)" and Lumin compensates the seller by hand.
- Migration `0045_claim_auto_appeal`.

## Stripe Connect payments (PAYMENT_PROVIDER=stripe, the default)

Escrow shape (unchanged from the Paystack version): the buyer's charge lands in the PLATFORM's Stripe balance; app/escrow.py
holds it through delivery and the claim window; release then makes a Stripe **Transfer** to the seller's **Express** account
(price minus any sponsored-sale fee); Stripe pays the seller out to their own bank. Refunds go back to the buyer's card from the
same charge, one order's share at a time.

- `app/stripe_gateway.py`: PaymentIntent, refund, Express accounts, onboarding links, transfers, webhook signature check.
- `app/gateway.py`: one door used by payments, escrow and order cancellation; `PAYMENT_PROVIDER` picks Stripe or Paystack at call time.
- Checkout: `POST /payments/initialize` creates the PaymentIntent; the PaymentIntent id becomes `Payment.reference`; the response carries
  `provider` and `client_secret`. The browser shows Stripe's card form (lumin-app/lib/stripe.ts) and then calls `POST /payments/verify`,
  which asks Stripe (never trusts the browser). `POST /payments/stripe-webhook` (signed with `STRIPE_WEBHOOK_SECRET`) does the same
  when the browser never came back. Both paths fulfil once. `automatic_payment_methods` is limited to methods that need no redirect.
- Sellers: `POST /merchant/stripe/onboard` (creates the account on first use, returns Stripe's hosted onboarding page),
  `GET /merchant/stripe/status`, `POST /merchant/stripe/dashboard`. `MerchantAccount.stripe_account_id` and `stripe_ready`
  (migration 0046). Bank details never touch this app, so `/merchant/payout` and `/merchant/banks` answer 404 under Stripe.
  A seller who is not ready is simply not paid yet: the money stays held and the next release attempt pays it.
- Safety: transfers carry an idempotency key per order and are tied to the original charge (`source_transaction`), refunds carry one per
  order, the webhook refuses unsigned or wrongly signed calls, and the app will not boot under Stripe without the three Stripe keys.
- Not built / to decide with Stripe: zero-decimal currencies (the code assumes cents), which seller countries your platform account can
  pay out to, Stripe disputes (chargebacks) raised against the platform, and transfer reversal when a seller wins an appeal after a refund.
- Not run against Stripe from the build sandbox (no network). tests/test_stripe_unit.py (fake Stripe, no database) and
  tests/test_stripe_payments.py (database) cover the logic; try everything in Stripe TEST mode first.
