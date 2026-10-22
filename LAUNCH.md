# Launch checklist

Written at feature freeze. Everything below is what still has to happen on a real machine: the build sandbox could not
reach npm or PyPI, so nothing was compiled by the real toolchain or run against a database.

## What was checked without the real toolchain
- Frontend (125 files in `lumin-app`, `lumin-admin`): type-checked against stub library types. No errors in our own code.
  (React/Next/lucide types were stubs, so this catches wrong props, wrong field names and wrong types in OUR code,
  not library misuse.)
- Backend: every `.py` file compiles; no undefined names; every `from app.x import y` points at something that exists.
- Migrations: one linear chain `0001` to `0046`, one head, no missing parents. The new ones (0041-0045) are safe to run on
  a fresh database (the baseline already builds the tables) and on an existing one.
- Frontend calls vs backend routes: every `request()` in both apps matches a real route and HTTP method.
- Logic tests that run without a database: 44 pass (sponsored ranking, claim review, seals, shipments, fraud signals).
  The PDF print-sheet test needs `reportlab` installed and was not run.
- Security read of the new routes: constant-time compares for the courier key and the OTP, rate limits on scan/OTP/test
  routes, admin routes behind the admin dependency.

## Do first (in this order)
1. Deploy backend. Watch the log for `Applying migrations...` finishing at `0046_stripe_connect`.
   If a migration fails, STOP and send me the error. Do not edit the database by hand.
2. `pip install -r requirements.txt` picks up `reportlab` and `stripe`; the frontend `npm install` picks up `jsqr`.
3. Deploy `lumin-app` and `lumin-admin`. Fix whatever the first real `next build` reports (the earlier two build errors
   were one type error and one apostrophe; expect a few more at most).
4. Run `python -m pytest` in `lumin-backend` (this is the first run of the database tests).

## Settings (Railway variables)
Already required: `DATABASE_URL`, `JWT_SECRET_KEY`, `R2_*` (5 values), `STRIPE_SECRET_KEY`, `STRIPE_PUBLIC_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`,
`FRONTEND_URL`, `CORS_ORIGINS`.

New or newly relevant:

| Variable | Default | Say |
|---|---|---|
| `PAYMENT_PROVIDER` | stripe | `stripe` (Connect) or `paystack` (old). With Stripe the app refuses to boot without the three Stripe keys. |
| `PAYMENT_CURRENCY` | USD | Currency charged. |
| `SPONSORED_SALE_PERCENT` | 10 | Your cut on add-on sales. Set 20 if you want 20. |
| `SEED_SPONSORED_DEMO` | on | Adds 3 fake demo sellers + 17 products on every deploy. Set `false` before real launch, then `python -m app.seed --remove-sponsored-demo`. |
| `SEAL_REQUIRED_TO_SHIP` | false | Keep false (sealed delivery stays optional). |
| `AUTO_REFUND_CLEAR_CASES` | false | Keep false until you have seen real disputes. |
| `CLAIM_WINDOW_HOURS` / `APPEAL_WINDOW_HOURS` | 48 / 48 | |
| `SEAL_MIN_TEST_SECONDS` | 20 | Shortest accepted live test. |
| `R2_PRIVATE_BUCKET_NAME` | empty | Set it so live-test videos are not public. Needs CORS on the bucket for browser upload. |
| `COURIER` / `COURIER_API_KEY` | manual / empty | Admin > Shipments acts as the courier until a real courier is connected. |
| `ANTHROPIC_API_KEY` | empty | Optional: AI reads products for better add-on matching. |
| `SENTRY_DSN` | empty | Strongly recommended for the first weeks. |
| `RISK_*` | see `fraud_signals.py` | Warning thresholds for the reviewer; they never block anyone. |

## Stripe checks (TEST mode, before any live key)
Never run against live keys until all of these pass in test mode. None of this has been run against Stripe yet.
1. Stripe dashboard: enable **Connect** (Express), and add the webhook endpoint from `DEPLOY.md`.
2. Seller: Dashboard > Payouts > **Set up with Stripe**. Use Stripe's test onboarding data. Back in the app it should say "Payouts are set up".
3. Buyer: buy with test card `4242 4242 4242 4242`. The order appears; the payment shows in Stripe.
4. Try the failing cards (`4000 0000 0000 9995` declined; `4000 0025 0000 3155` asks for 3-D Secure). No order must be created on a failure.
5. Mark the order delivered, wait out or skip the claim window, release. In Stripe a **transfer** to the seller's account appears, for the price minus any add-on fee.
6. Cancel another order and file a defect claim on a third: each shows a **refund** in Stripe for only that order's amount.
7. Stop the browser mid-payment (close the tab after paying): the webhook should still create the order.

## Real-phone tests before inviting sellers (about 30 minutes)
Use one iPhone (Safari) and one Android (Chrome). Safari is the riskiest.
1. Admin > Seals: make a batch of 5 bags, download the PDF, print one label, scan it with a phone.
2. Seller: place a test order, tap **Go live test**, allow the camera, record 25 seconds, finish. Check the video plays in Admin.
3. Buyer: open the order, scan the bag QR at the door, enter the OTP. Order becomes delivered.
4. Buyer: file a complaint. Check the dispute shows the seller video and the suggestion (deny / refund / review).
5. Repeat step 4 on an order with NO live test: suggestion should be refund.
6. Add-ons: open a product tile, check "Complete your set" / "Frequently bought with" appears, tap "+", add the whole set,
   open the cart and check "Recommended add-on". Check the Terms and Help pages show the add-on commission line.
7. Cancel an order after the live test: the bag should be freed.

## Known gaps (accepted for launch)
- Terminal Africa (real courier) is not connected; Admin > Shipments is the manual courier.
- No bundle discount; "Add the whole set" adds items to the cart, it is not a one-payment bundle.
- A seller who wins an appeal after a refund cannot claw the money back automatically (manual compensation).
- Terms/Help wording on add-ons and sealed delivery is plain language, not lawyer-reviewed.
