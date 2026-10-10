# Lumin

Next.js 14 (App Router) + TypeScript + Tailwind implementation of the Lumin
shoppable-video landing page.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:3000. (`npm install` needs network access — this
sandbox doesn't have it, so dependencies haven't been installed here.)

## Structure

```
app/            Next.js App Router entry (layout, page, global styles)
components/     NavBar, VideoStage, CategoryDrawer, ProductDrawer, ProductCard, DealBanner
lib/            types.ts (data shapes) + data.ts (mock content)
hooks/          useCarousel — drives the rotating deal banner
```

## Design tokens

The brand palette lives in `tailwind.config.ts` (`hot-pink`, `hot-orange`,
`ink`, etc.) and two composite utilities in `app/globals.css`:

- `.brand-gradient` — the pink→orange fill used on every primary CTA,
  the active nav pill, the follow button, and the deal banner
- `.video-stage-bg` — the dark radial background behind the video

Change the palette in one place (`tailwind.config.ts`) and it propagates
everywhere.

## What's mocked and needs real wiring next

- **Video** — `VideoStage` renders a placeholder box. Swap in a real
  player (`next/image`/`<video>`, or `hls.js`/`video.js` for streaming).
- **Data** — `lib/data.ts` is static mock data typed against `lib/types.ts`.
  Replace with fetches from your API/CMS; the components already consume
  typed props, so this is a drop-in swap.
- **Mobile bottom sheet** — `ProductDrawer` opens on tap. For true
  drag-to-swipe, swap in a gesture library like
  [`vaul`](https://github.com/emilkowalski/vaul).
- **Category drawer on mobile** — currently hidden below the `lg`
  breakpoint. Wire the "Categories" button in `VideoStage`'s overlay to
  open it as a slide-over.
- **Testing** — no tests yet. Recommend Vitest + React Testing Library
  for component tests, and Playwright for the sheet/interaction flows.

## Deploying to Railway

Deploy `lumin-backend` first (see that project's own README) — this
service needs its already-deployed public URL *before* it builds, not
just set on it afterward. That ordering is the one thing in this whole
process that's easy to get backwards, so it's worth being explicit about
exactly why:

Next.js inlines every `NEXT_PUBLIC_*` value into the client-side
JavaScript at **build** time (`next build`), baking it into the static
output — it's not read from the environment at request time the way a
normal server-side env var would be. So setting `NEXT_PUBLIC_API_URL` as
a plain Railway service variable, the way you would for an ordinary
runtime config value, doesn't work: the Docker build itself has no
access to a service's regular env vars, only to Docker *build
arguments*, so `next build` would run with that variable unset, silently
fall back to whatever default `lib/api.ts` has for it, and every request
the deployed app makes would go to the wrong place. The fix is
`Dockerfile`'s `ARG NEXT_PUBLIC_API_URL` / `ARG
NEXT_PUBLIC_GOOGLE_CLIENT_ID` — declaring them as build args is what
makes Railway pass its own service variables through to the build in the
first place.

In Railway, create the service ("New" → "GitHub Repo", or "Empty
Service" + `railway up` from this directory if it's not in its own repo
yet) pointed at this directory — it detects `Dockerfile` and
`railway.toml` here on its own. Then, under that service's Variables
tab:

```
NEXT_PUBLIC_API_URL=https://<your-backend-service>.up.railway.app
NEXT_PUBLIC_GOOGLE_CLIENT_ID=...apps.googleusercontent.com
```

The second is optional — leave it unset and the Google sign-in button
simply doesn't render (see `GoogleSignInButton.tsx`), everything else
works regardless. Railway redeploys (meaning: rebuilds, not just
restarts) whenever a variable on this service changes, so updating
either of these later does take effect — just not instantly the way a
true runtime variable would, since it means the whole image gets rebuilt
with the new value baked in again.

One more loop to close afterward: once this service has its own public
Railway domain, go back to the backend service's `FRONTEND_URL`
variable and set it to that domain — that's what the backend's CORS
allowlist and its password-reset emails both key off (see that
project's own README).
