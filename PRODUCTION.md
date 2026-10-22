# Production readiness checklist

Tick these in order. **Owner** is who has to do it: *You* (needs your accounts or decisions), *Dev* (code or settings I can
help with). `LAUNCH.md` covers deploying and testing what is built; this file covers everything around it.

## A. Before any real money or real users (blockers)

| # | Item | Owner | Done when |
|---|---|---|---|
| 1 | **Stripe account activated** (business details, bank account), Connect enabled, then **live** keys (`STRIPE_SECRET_KEY`, `STRIPE_PUBLIC_KEY`) and a live webhook endpoint with its `STRIPE_WEBHOOK_SECRET`. First pass every check in `LAUNCH.md` > Stripe checks in TEST mode | You | A small real purchase, a refund and a payout to a real seller all work end to end |
| 1b | Stripe **Connect platform setup**: platform profile and Terms of Service for sellers, supported seller countries confirmed with Stripe (cross-border payouts depend on where your platform account is), and your chargeback/dispute process decided (Stripe disputes arrive on the platform) | You | Written down, and a test dispute handled |
| 2 | **Database backups** on (Railway: enable backups on the Postgres service) and one **restore tried** into a scratch database | You | You have restored a backup and logged in to the restored copy |
| 3 | `SENTRY_DSN` set on web, admin and worker, plus an **uptime check** on the API `/health` and the app (e.g. UptimeRobot) | You | A deliberate test error shows in Sentry; a stopped service sends you an alert |
| 4 | Strong `JWT_SECRET_KEY` (32+ random characters), not shared with any other environment | You | Value is unique to production |
| 5 | Admin accounts have **MFA on** (`REQUIRE_ADMIN_MFA` stays `true`) and the demo admin from the seed data does **not** exist in production (`SEED_DEMO_DATA` is not `true`) | You | You cannot sign in as `you@example.com` |
| 6 | `SEED_SPONSORED_DEMO=false`, then `python -m app.seed --remove-sponsored-demo` | You | No "demo-*" sellers in Admin |
| 7 | `CORS_ORIGINS` lists only your real app and admin domains | Dev | A request from another origin is refused |
| 8 | Terms, Privacy, refund and add-on wording **reviewed by someone qualified** in the countries you sell in | You | Sign-off received; text updated in `lumin-app/lib/legalDocs.ts` |
| 9 | CI is green on `main` (`.github/workflows/ci.yml`: backend tests on Postgres, types, lint, builds) | Dev | First run passes; fix whatever it reports |
| 10 | The 30-minute real-phone test in `LAUNCH.md` done on an iPhone and an Android | You | All seven steps pass |

## B. Soft launch (first two weeks, small group)

| # | Item | Owner |
|---|---|---|
| 11 | Invite a small group of real sellers and buyers (one product category, ideally electronics) | You |
| 12 | Someone answers disputes inside the 48-hour window every day (Admin > Disputes) | You |
| 13 | Watch Sentry, the dispute list, the stalled-shipments list and payment failures daily | You |
| 14 | Keep `SEAL_REQUIRED_TO_SHIP=false` and `AUTO_REFUND_CLEAR_CASES=false` until you have real dispute data | You |
| 15 | After 50+ sealed orders compare: dispute rate and conversion for sealed vs unsealed. This decides whether to push sealed delivery harder | You |

## C. Before opening it up

| # | Item | Owner |
|---|---|---|
| 16 | Load test video upload and playback (many users at once). HLS needs bucket CORS and ffmpeg on the worker | Dev |
| 17 | Cost alerts on storage and bandwidth (Cloudflare R2, Railway). Video costs grow fast | You |
| 18 | App store submissions: developer accounts, privacy questionnaire, camera permission wording (`NATIVE.md`), account deletion link (`/delete-account` exists) | You |
| 19 | A support email and a visible way to reach it (`COMPANY.supportEmail` in `lumin-app/lib/company.ts`) | You |
| 20 | Connect a real courier (Terminal Africa) once you have an account; until then Admin > Shipments is the courier | You + Dev |
| 21 | Decide on a bundle discount for "Add the whole set" (who pays: seller or platform) | You |

## D. Standing habits
- Never point `TEST_DATABASE_URL` at a real database: tests wipe it.
- Deploy small changes often; read the Railway build log after every deploy.
- Write down every dispute decision you override, so the suggestion rules can be improved from real cases.
