# Deploying Lumin (Railway) — first launch checklist

Three services from this repo, plus Postgres. Every setting is listed, with comments, in each folder's `.env.example`.

| Service | Root Directory | Built with |
|---|---|---|
| Postgres | (Railway plugin) | — |
| Backend | `lumin-backend` | Dockerfile (runs migrations on every start) |
| Website | `lumin-app` | Dockerfile |
| Admin console | `lumin-admin` | Railway's automatic Next.js build |

## 1. Accounts you need first
- **Cloudflare R2**: a bucket for uploads, its API keys, a public address for it. Add a CORS rule on the bucket allowing `PUT` (and `GET`) from your website's address.
- **A second, PRIVATE R2 bucket** (no public access, no custom domain) for sellers' ID photos, named in `R2_PRIVATE_BUCKET_NAME`; the same API token must cover it. Skip it and seller verification simply stays off.
- **Stripe** (Connect): secret key, publishable key and the webhook signing secret. In Stripe: turn on **Connect** (Express accounts, platform collects payments and transfers to sellers), then Developers > Webhooks > add `https://<backend>/payments/stripe-webhook` for `payment_intent.succeeded`, `payment_intent.payment_failed`, `account.updated`. Use **test mode** keys first. (Paystack still works with `PAYMENT_PROVIDER=paystack`.)
- **Google Cloud**: an OAuth client id for sign-in (authorised origin = your website's address).
- **Resend** (email): add and verify **your own domain**, create an API key. Without this nobody can finish signing up.
- **Sentry** (optional but recommended): a project, copy its DSN.

## 2. Backend service
1. New service from the repo, Root Directory `lumin-backend`, add the Postgres plugin.
2. Variables: copy from `lumin-backend/.env.example`. Required: `DATABASE_URL` (`${{Postgres.DATABASE_URL}}`), `JWT_SECRET_KEY` (`openssl rand -hex 32`), `FRONTEND_URL`, `GOOGLE_CLIENT_ID`, `STRIPE_SECRET_KEY`, `STRIPE_PUBLIC_KEY`, `STRIPE_WEBHOOK_SECRET`, `R2_*`. Also set `ENVIRONMENT=production`, `RESEND_API_KEY`, `EMAIL_FROM`, `SENTRY_DSN`, `CORS_ORIGINS` (the admin console's address).
3. **Do not set `SEED_DEMO_DATA`.** It loads demo accounts with public logins, including an admin.
4. Deploy. Startup applies migrations and creates the starting categories (no demo people or videos).
5. Open `https://<backend>/health/ready` — it should say the database is reachable.
6. In Railway, turn on **Backups** for the Postgres service.

## 3. Website and admin console
- Website: variables `NEXT_PUBLIC_API_URL` (backend address), `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, optionally `NEXT_PUBLIC_TWIN_ENABLED`. These are baked in at build time, so **redeploy after changing them**.
- Admin console: `NEXT_PUBLIC_API_URL`. Before the first deploy run `npm install` in `lumin-admin` once and commit `package-lock.json`.
- Platform name: set `NEXT_PUBLIC_APP_NAME` on the website service and `APP_NAME` on the backend (and worker) service, with the same value. Logo: replace the file `lumin-app/public/brand/logo.png` (a PNG; a wide logo that already contains your name is fine, and is shown alone in the Categories panel; set `NEXT_PUBLIC_LOGO_HAS_NAME=false` for a symbol-only logo). Redeploy the website after either change. App-store icons are separate (`lumin-native/assets`, see `NATIVE.md`).
- Edit `lumin-app/lib/company.ts` (your company name, address, contact email) before launch; the legal pages read from it.

## 4. Create your first admin
No screen can make an admin (on purpose). Sign up normally on the website with your real email, confirm the code, then in Railway → Postgres → Data/Query run:

```sql
UPDATE users SET role = 'admin' WHERE email = 'you@yourdomain.com';
```

Sign in at the admin console: it will show a setup key — add it to an authenticator app, type the 6-digit code. From then on every admin sign-in needs a code. Lost phone: run
`UPDATE users SET totp_enabled=false, totp_secret=NULL, totp_last_step=NULL WHERE email='…';` and enrol again.

## Category photos
The Categories list shows a real photograph beside each category. Put square JPGs (about 400×400, under 100 KB) in
`lumin-app/public/categories/`, named by kind: `fashion.jpg` (Apparel), `electronics.jpg`, `home-living.jpg`,
`accessories.jpg` (the full list of names is in that folder's `README.txt`). A category without a photo shows a drawn
icon, and a photo that fails to load falls back the same way. Commit, push and redeploy the website after adding files.
A category can also use its own picture from any address: `UPDATE categories SET icon_url = 'https://…/photo.jpg' WHERE name = 'Apparel';`
Use photos you have the right to use (your own, or a free-to-use source such as Unsplash or Pexels; check each photo's licence).

## If "scan a video" finds nothing
A miss has several causes, and most are about the uploaded video, not the recording. In the Railway database query tab:

```sql
-- 1. Is the video scannable and fingerprinted? (replace the text with part of its caption)
SELECT p.id, p.feed, p.repost_of_id IS NOT NULL AS is_repost, p.retwin_of_id IS NOT NULL AS is_retwin,
       (SELECT count(*) FROM video_post_products x WHERE x.video_post_id = p.id) AS products,
       p.moderation_hold, p.video_url, f.status, f.version, f.error, (f.video_url = p.video_url) AS fingerprint_is_current
FROM video_posts p LEFT JOIN video_fingerprints f ON f.video_post_id = p.id
WHERE p.description ILIKE '%part of the caption%' ORDER BY p.created_at DESC LIMIT 5;
-- 2. How many videos can be found at all?
SELECT status, version, count(*) FROM video_fingerprints GROUP BY 1, 2;
```
Only an original **shop** video with at least one **product tagged**, stored on your own bucket, is searchable. It must
also be fingerprinted (a `failed` status shows why in `error`), not held by moderation, and the fingerprint must be current
(`fingerprint_is_current` true). Videos uploaded before the worker was running need `python -m app.scan_service --backfill`.
Check admin → Background jobs for failed fingerprint jobs. If `R2_PUBLIC_BASE_URL` was changed after upload, the stored
video addresses no longer match it and those videos are skipped.

## 5. If this database was ever seeded with the demo data
Check the backend deploy log for a line starting `WARNING: demo accounts with the PUBLIC password`. If present:
1. Make your own admin first (step 4), then
2. In the backend service shell run `python -m app.seed --remove-demo` — it deletes every demo account (and the demo videos/products they own) and nobody else.
3. Rotate `JWT_SECRET_KEY` if the demo admin could have been used: sessions it issued stop working.

## 6. Background worker (do this before real traffic)
Video re-encoding and scan fingerprinting are queued jobs. By default they run inside the web server, which is fine for a
trial but means a burst of uploads slows every request. To move them out:
1. Add a **second service** from the same repo, Root Directory `lumin-backend`. Copy ALL the backend's variables to it
   (use Railway's shared variables or "reference variables" so they stay in sync).
2. In that service's Settings → *Config as code*, set the file path to `lumin-backend/railway.worker.toml` (starts
   `python -m app.worker`, no web health check).
3. On the **web** service set `RUN_JOBS_IN_WEB=false`, redeploy both.
4. Check `GET /admin/jobs` (admin console → Background jobs): `queued` should stay near 0 and `failed` empty. Queued jobs piling up
   with none running means no worker is running. Give the worker more memory than the web service (ffmpeg uses it).

## 7. Seller verification (optional)
With `R2_PRIVATE_BUCKET_NAME` set, sellers see a "Verify your store" card on their Payouts tab (legal name, ID photo, selfie).
You review them in the admin console → **Seller verification**; the photos are deleted the moment you approve or reject, and
approved sellers get a **Verified seller** badge on their videos. `REQUIRE_VERIFIED_SELLERS_FOR_PAYOUT=true` also makes
payouts wait until a seller is verified (turn it on only after you have cleared the backlog). Your privacy policy already
mentions this; have your lawyer check how long you may need to keep ID records where you operate.

## 8. Switch on monitoring
- Uptime monitor (e.g. UptimeRobot, free) on `https://<backend>/health/ready`, alerting your email/phone.
- Sentry: `SENTRY_DSN` + `ENVIRONMENT=production`; confirm a test error appears.

## 9. Test before inviting anyone
Sign up with a second real email (code arrives?), upload a video and a product photo (if R2 rejects the upload set `SIGN_UPLOAD_SIZE=false`), buy something with a Stripe test card (4242 4242 4242 4242, any future date, any CVC), check the order shows for buyer and seller, reset a password, open the admin console and enter a code, request "Download my data", turn on push notifications (set the `VAPID_*` keys first) and tap one.

## 10. One-off commands (backend service shell)
- `python -m app.seed --check` — warn if public demo logins exist.
- `python -m app.seed --remove-demo` — remove them.
- `python -m app.scan_service --backfill` — fingerprint videos uploaded before scan existed, AND rebuild fingerprints made by an older version (run once after deploying this release: videos stay searchable while they are rebuilt, but only the rebuilt ones get the stronger SIFT matching).
- `python -m app.counters --fix` — recount likes/comments/etc. from the real rows (run once after first deploy).


## Optional: Sign in with Apple
Needed for the iPhone app, optional for the website. Set `APPLE_CLIENT_IDS` on the backend and `NEXT_PUBLIC_APPLE_CLIENT_ID` / `NEXT_PUBLIC_APPLE_NATIVE_CLIENT_ID` on the website. Steps are in NATIVE.md section 5. Redeploy the backend (it adds one database column automatically).


## Content moderation
Needed for App Store and Play approval, and good practice anyway.

What it does: a word filter (block or flag), picture checks on uploaded videos, avatars and product photos, automatic hiding of a video reported by 3 different people, and a **Moderation** page in the admin console where you approve or remove what was flagged.

Set up:
1. Get a free key at platform.openai.com. On the backend set `MODERATION_PROVIDER=openai` and `OPENAI_API_KEY=…` (see `.env.example` for the thresholds). The Moderation page says "picture checks OFF" until this is set.
2. Make sure the background worker is running (the checks run as background jobs; see "Background worker").
3. Open the admin console → Moderation → Word list and add the words you want blocked or flagged. The list starts empty on purpose: you choose it.
4. Look at the Moderation page every day. A video hidden by the checks stays hidden until you approve or remove it, and the owner is told it is under review.

Please know:
- The picture service makes mistakes in both directions. That is why a person reviews what it flags, and why the report button stays.
- A video already live is not re-checked. Only new uploads and edits are.
- If you ever find child sexual abuse material, do not just delete it: most countries require you to report it (for example to the NCMEC in the US or the IWF in the UK). Ask your lawyer what applies to you before launch.
- Add to your Terms that objectionable content is not allowed and that you may remove it and close accounts.
