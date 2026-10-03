#!/bin/sh
set -e

# 🛠️ FIX: the Dockerfile sets this script as ENTRYPOINT with no CMD, so
# `docker compose run --rm api <anything>` doesn't replace this script —
# it just appends <anything> as this script's own $1/$2/... and the
# script ignored them completely, always running its fixed wait/migrate/
# seed/serve sequence regardless. That silently broke the exact recovery
# command this script tells someone to run a few lines down (`docker
# compose run --rm api alembic revision --autogenerate ...`): it looked
# like it ran, but what actually executed was this script's normal
# startup — which, with alembic/versions still empty, just hit the same
# guard below and exited 1 again, never generating anything. Forwarding
# any passed args here (idiomatic for an ENTRYPOINT-only image) makes
# that command — and any other one-off `docker compose run --rm api ...`
# — do exactly what it says instead of being silently swallowed.
if [ "$#" -gt 0 ]; then
  exec "$@"
fi

echo "Waiting for the database..."
# psycopg2's own DSN parser doesn't understand SQLAlchemy's
# 'postgresql+<driver>://' dialect-suffix syntax (that '+psycopg2',
# '+psycopg', etc. is purely a SQLAlchemy convention telling it which
# driver to load) — strip it back to plain 'postgresql://' before handing
# the URL to psycopg2 directly, same as this app's real DB engine never
# needs to since create_engine() in database.py understands the
# '+<driver>' form natively. Stripped generically (any driver name, not
# just '+psycopg2') so this keeps working whichever one DATABASE_URL
# actually specifies — a URL with a driver this script doesn't
# specifically know how to strip is exactly what silently hung here
# before: every attempt failed to parse, every failure was swallowed by
# the bare `except`, and the loop below retried forever with nothing ever
# printed to explain why.
attempt=0
while true; do
  error=$(python -c "
import os
import re
import psycopg2
dsn = re.sub(r'^postgresql\+\w+://', 'postgresql://', os.environ['DATABASE_URL'])
psycopg2.connect(dsn)
" 2>&1) && break
  attempt=$((attempt + 1))
  if [ "$attempt" -eq 10 ] || [ $((attempt % 30)) -eq 0 ]; then
    echo "Still waiting for the database after ${attempt}s. Last error:"
    echo "$error"
  fi
  sleep 1
done
echo "Database is up."

# 🛠️ FIX: this used to autogenerate a migration HERE, at container
# startup, whenever alembic/versions was empty — which in this repo is
# ALWAYS, since no migration has ever actually been committed. That
# turns a routine rebuild into a destructive event: a fresh image (no
# bind mount, unlike dev) starts with an empty alembic/versions every
# time, so it autogenerates a BRAND NEW "initial schema" migration with
# a new, unrelated revision id on every single deploy — while the
# database's own alembic_version table (which persists in the volume)
# still points at LAST deploy's now-nonexistent revision. Alembic can't
# reconcile the two: `alembic upgrade head` fails with "Can't locate
# revision identified by '<old-id>'", set -e kills the container, and
# the only "fix" available at that point is wiping the DB volume —
# which in production means deleting every real user, order, payment,
# and product permanently. Autogenerate is a DEVELOPMENT-time command a
# person runs locally, reviews, and commits as a real file — never
# something that should run unattended against a real database. This
# now ONLY ever applies migrations that are already committed to the
# repo; it fails loudly and immediately if there are none, rather than
# silently generating one against production data.
if [ -z "$(ls -A alembic/versions 2>/dev/null)" ]; then
  echo "ERROR: alembic/versions is empty — no committed migrations found." >&2
  echo "Generate and commit an initial migration first (one-time, from your own machine):" >&2
  echo "  docker compose run --rm api alembic revision --autogenerate -m \"initial schema\"" >&2
  echo "  git add alembic/versions/*.py && git commit" >&2
  echo "Refusing to autogenerate one here — that's exactly what silently breaks every rebuild." >&2
  exit 1
fi

echo "Applying migrations..."
alembic upgrade head

echo "Seeding demo data (no-op if it's already there)..."
python -m app.seed

echo "Starting the API server..."
# PORT: Railway (and most container hosts) assign the port to listen on
# at deploy time rather than letting the app hardcode one — they route
# traffic to whatever's in $PORT, so binding to a fixed 8000 instead
# would leave the service unreachable even though it's running
# correctly. Falls back to 8000 for local docker-compose, which sets no
# such variable.
#
# RELOAD: --reload watches the filesystem for edits, which is exactly
# what docker-compose.yml's bind-mounted source wants for local dev —
# and exactly what a production container, built once from a fixed
# image with no bind mount, never needs; it only adds file-watching
# overhead with nothing for it to ever actually catch. Off unless
# docker-compose.yml (or whoever's running this) explicitly opts in.
RELOAD_FLAG=""
if [ "${RELOAD:-false}" = "true" ]; then
  RELOAD_FLAG="--reload"
fi
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}" $RELOAD_FLAG
