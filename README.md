# Lumin

A shoppable-video app — Next.js frontend, FastAPI backend, deployed as
two independent Railway services from this one repo.

```
lumin/
├── lumin-app/        Next.js 14 frontend — see its own README
└── lumin-backend/     FastAPI backend — see its own README
```

Kept together in one repo because these two change together constantly:
most real features here touch the backend's models/schemas/routes and
the frontend's types/API client in the same change, not independently.
The separate admin console (`lumin-admin`) is intentionally **not**
here — it's a genuinely separate product (its own login, its own design
language, its own release cadence), which is exactly the kind of
loosely-coupled case that *does* belong in its own repo.

## Local development

Each half runs independently — see `lumin-app/README.md` and
`lumin-backend/README.md` for the full setup (env vars, the demo
seed/login, etc.). Short version:

```bash
# Backend
cd lumin-backend
docker compose up   # Postgres + the API, http://localhost:8000

# Frontend, in a second terminal
cd lumin-app
npm install
npm run dev          # http://localhost:3000
```

## Deploying to Railway

One repo, two Railway services, each pointed at its own subdirectory —
this is the normal way Railway handles a monorepo, not a workaround:

1. Create the backend service ("New" → "GitHub Repo" → this repo),
   then in that service's Settings, set **Root Directory** to
   `lumin-backend`. Railway picks up `lumin-backend/Dockerfile` and
   `lumin-backend/railway.toml` from there automatically.
2. Create a second service the same way, with **Root Directory** set to
   `lumin-app`.
3. Add a Postgres plugin (its own service, not a subdirectory here).

With root directories set this way, each service only rebuilds when a
file under its *own* directory changes — editing something in
`lumin-app` doesn't trigger a backend redeploy, and vice versa, the same
isolation you'd get from separate repos.

The actual environment variables each service needs, the deploy order
(Postgres → backend → frontend, since the frontend needs the backend's
live URL as a *build* argument — see why in `lumin-app/README.md`'s
"Deploying to Railway"), and what each one does, are documented in that
service's own README rather than duplicated here.
