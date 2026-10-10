# Lumin Admin

The internal ops console for the Lumin platform — moderation, disputes,
and platform-wide analytics. A separate project from the consumer app
(`lumin-app`) on purpose: different audience, different design language
(tables and queues, not a video feed), no reason to ship the consumer
app's bundle to your team. Both talk to the same `lumin-backend` API;
there is no separate backend for this app.

## Setup

```
npm install
npm run dev
```

Runs on **http://localhost:3001** (hardcoded in `package.json`'s `dev`/
`start` scripts — the backend's CORS config in `lumin-backend/app/main.py`
already allowlists this exact origin, so don't change the port without
updating that too).

Needs `lumin-backend` running and reachable — see that project's own
README. `.env.local` already points at `http://localhost:8000`, the same
default `lumin-app` uses.

## Logging in

There's no separate admin signup or a different login route — this uses
the exact same `POST /auth/login` the consumer app does. What makes
someone an admin is the `role` column on their `User` row, which **no
API route anywhere can set** — the only way to create an admin account
is a direct database write. The backend's seed script
(`lumin-backend/app/seed.py`) creates one for local dev:

```
admin@example.com / password123
```

Logging in with a non-admin account is refused client-side (see
`app/login/page.tsx`) with a clear message, rather than letting you into
a console where every real request would just come back `403` from the
backend's own `get_current_admin` check.

## What's here

```
app/
  login/          Sign-in screen — refuses a non-admin account
  dashboard/      Platform-wide analytics: orders/revenue over time,
                  top products, trending videos, traffic by source
  users/          Search accounts; ban / unban; shadow ban / un-shadow-ban
                  (hides someone's posts/comments from everyone else
                  without telling them — see lumin-backend's README,
                  "Moderation" section, for the full mechanics)
  reports/        Review queue for user-filed reports against video
                  posts, products, or accounts
  appeals/        Review queue for banned accounts' appeals —
                  approving lifts the ban immediately
  disputes/       Review queue for buyer-filed return/defect claims —
                  approving refunds through Paystack, denying releases
                  the order's held funds normally
  content/        Search products/videos (reuses the same public
                  GET /search every consumer's search bar hits) and
                  remove anything that doesn't follow guidelines
components/
  AdminShell.tsx    Sidebar nav + the client-side "is this an admin,
                    logged in" guard every page under app/ is wrapped in
  ConfirmDialog.tsx One shared "are you sure, and why" modal — ban,
                    deny, remove all reuse this rather than each having
                    their own bespoke one
  StatusBadge.tsx   One consistent look for every status word
                    (pending/approved/denied/etc.) across every queue
lib/
  api.ts   Every request this app makes — see that file's own header
           comment for why it skips the camelCase-adapter layer
           lumin-app has
```

## A few things worth knowing

**This app has no idea any of these routes exist beyond what it calls.**
It's a plain client of `lumin-backend`'s `/admin/*`, `/reports`,
`/users/me/appeal(s)`, and `/orders/{id}/return-claim*` routes — see
that project's own README ("Moderation" section) for the full picture
of what each one does and why, including two real bugs that were caught
and fixed while building the backend side of this (a payout-timing race
and a stale filing-time check) that this app doesn't need to know about,
just benefits from.

**The "sessions by source" chart on the dashboard will be empty until
the consumer app is updated to call `POST /traffic` on load.** That's
the one piece of this whole feature that needed new instrumentation
rather than a new query over data that already existed — see
`TrafficSource`'s own comment on the backend for what it does and
deliberately doesn't track.

**Every ban/removal/resolution here sends a real notification now** —
`routers/admin.py` is the first place in the entire backend that ever
calls `Notification(...)`. The consumer app's notifications screen will
start showing real moderation outcomes, not just seeded fake data, the
moment any of these actions run.

## Not done yet

Nothing in this project has actually been run — no `npm install`,
no live server, same caveat every other part of this migration has
carried. Treat "run it once, click through every page against a real
backend" as its own step before considering this done, the same as
`lumin-app` and `lumin-backend` both still need.

Smaller things deliberately left out of this first pass, not
forgotten:
- **Pagination** on Users/Reports/Content — each fetch takes a
  `limit`, but there's no "load more" in the UI yet. Fine at the data
  volumes a new platform actually has; revisit once queues get long.
- **A dedicated "list every product/post" admin endpoint.** Content
  moderation reuses the public `GET /search` instead, which is fine
  since that data is public either way — but it means Content can only
  find things a search term actually matches, not browse everything.
- **Report → action linkage.** Marking a report "actioned" doesn't
  itself remove anything or ban anyone — that's a deliberate separation
  (see `resolve_report`'s own comment on the backend), but it does mean
  going back and forth between Reports and Content/Users for now,
  rather than one combined "resolve and remove" action.
