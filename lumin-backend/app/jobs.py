"""A small job queue in the database, so slow work (re-encoding a video, fingerprinting it for scan) runs in a separate
worker process instead of inside the web server, where a burst of uploads would slow down everyone's requests.

  enqueue(db, kind, payload)   add a job in the caller's transaction (it exists iff the caller's change commits)
  run_one()                    take the oldest ready job and run it; returns False when there was nothing to do
  loop(stop)                   run_one forever (python -m app.worker; or a thread inside the web server)

Why a database queue and not Redis/Celery: nothing new to run or pay for, jobs survive restarts, and the volume
here (one or two jobs per upload) is far below what Postgres handles. Several workers are safe: a job is claimed
with FOR UPDATE SKIP LOCKED. A worker that dies mid-job leaves it `running`; after STALE_AFTER it is picked up again.
Failed jobs retry with a growing delay (max_attempts), then stay `failed` for an admin to see (GET /admin/jobs).

Where it runs: by default a thread inside the web server (RUN_JOBS_IN_WEB=true, so nothing needs setting up). For real
isolation add a second Railway service from the same image with start command `python -m app.worker` and set
RUN_JOBS_IN_WEB=false on the web service. See DEPLOY.md.
"""
import logging
import threading
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models import Job
from app.models.job import JOB_DONE, JOB_FAILED, JOB_QUEUED, JOB_RUNNING

log = logging.getLogger("lumin")

STALE_AFTER = timedelta(minutes=30)  # a running job older than this is assumed to belong to a dead worker
KEEP_DONE = timedelta(days=7)
IDLE_SLEEP_S = 2.0

OPTIMIZE_VIDEO = "optimize_video"
FINGERPRINT_VIDEO = "fingerprint_video"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _handlers() -> dict:
    # Imported lazily: the handlers pull in ffmpeg/opencv code the web process otherwise never needs to load.
    from app.screening import MODERATE_MEDIA, moderate_media
    from app.scan_service import fingerprint_video_post
    from app.video_optimize import optimize_video_post

    return {
        OPTIMIZE_VIDEO: lambda p: optimize_video_post(uuid.UUID(p["post_id"])),
        FINGERPRINT_VIDEO: lambda p: fingerprint_video_post(uuid.UUID(p["post_id"])),
        MODERATE_MEDIA: moderate_media,
    }


def enqueue(db: Session, kind: str, payload: dict, delay_s: float = 0) -> Job:
    """Add a job to the caller's open transaction (the caller commits). Jobs run oldest-first, so enqueue them in the
    order they must happen (a video is optimised before it is fingerprinted)."""
    job = Job(kind=kind, payload=payload, run_after=_now() + timedelta(seconds=delay_s))
    db.add(job)
    return job


def enqueue_video(db: Session, post_id: uuid.UUID, optimize: bool = True, fingerprint: bool = True) -> None:
    if optimize:
        enqueue(db, OPTIMIZE_VIDEO, {"post_id": str(post_id)})
    if fingerprint:
        enqueue(db, FINGERPRINT_VIDEO, {"post_id": str(post_id)})


def _claim(db: Session) -> Job | None:
    now = _now()
    job = (
        db.query(Job)
        .filter(
            or_(
                (Job.status == JOB_QUEUED) & (Job.run_after <= now),
                (Job.status == JOB_RUNNING) & (Job.locked_at < now - STALE_AFTER),
            )
        )
        .order_by(Job.run_after)
        .with_for_update(skip_locked=True)
        .first()
    )
    if job is None:
        db.rollback()
        return None
    job.status = JOB_RUNNING
    job.locked_at = now
    job.attempts = (job.attempts or 0) + 1
    db.commit()
    return job


def run_one(handlers: dict | None = None) -> bool:
    """Run the oldest ready job. True if one was taken (whether or not it succeeded)."""
    handlers = handlers if handlers is not None else _handlers()
    db = SessionLocal()
    try:
        job = _claim(db)
        if job is None:
            return False
        job_id, kind, payload, attempts, max_attempts = job.id, job.kind, dict(job.payload or {}), job.attempts, job.max_attempts
        error = None
        try:
            handler = handlers.get(kind)
            if handler is None:
                raise RuntimeError(f"no handler for job kind {kind!r}")
            handler(payload)
        except Exception as exc:  # the handlers swallow their own errors; this catches the rest
            log.exception("job %s (%s) failed", job_id, kind)
            error = f"{type(exc).__name__}: {exc}"[:500]
        db.expire_all()
        job = db.get(Job, job_id)
        if job is None:
            return True
        if error is None:
            job.status, job.finished_at, job.error = JOB_DONE, _now(), None
        elif attempts >= max_attempts:
            job.status, job.finished_at, job.error = JOB_FAILED, _now(), error
        else:
            job.status, job.error = JOB_QUEUED, error
            job.run_after = _now() + timedelta(seconds=30 * 2 ** (attempts - 1))
        job.locked_at = None
        db.commit()
        return True
    except Exception:
        db.rollback()
        log.exception("job runner error")
        return False
    finally:
        db.close()


def purge_old(db: Session) -> int:
    n = db.query(Job).filter(Job.status == JOB_DONE, Job.finished_at < _now() - KEEP_DONE).delete(synchronize_session=False)
    db.commit()
    return n


def loop(stop: threading.Event) -> None:
    """Run jobs until `stop` is set."""
    handlers = _handlers()
    last_purge = 0.0
    import time

    while not stop.is_set():
        worked = run_one(handlers)
        if time.monotonic() - last_purge > 3600:
            last_purge = time.monotonic()
            db = SessionLocal()
            try:
                purge_old(db)
            except Exception:
                db.rollback()
            finally:
                db.close()
        if not worked:
            try:
                from app.scan_service import upgrade_one

                worked = upgrade_one()  # idle: bring old scan fingerprints up to date, one video at a time
            except Exception:
                log.exception("scan fingerprint upgrade failed")
        if not worked:
            stop.wait(IDLE_SLEEP_S)


def start_in_web() -> threading.Event | None:
    """Called once when the web server starts. Off when a dedicated worker service exists (RUN_JOBS_IN_WEB=false)."""
    import os

    if os.environ.get("RUN_JOBS_IN_WEB", "true").lower() == "false":
        return None
    stop = threading.Event()
    threading.Thread(target=loop, args=(stop,), name="lumin-jobs", daemon=True).start()
    log.info("running background jobs inside the web server (set RUN_JOBS_IN_WEB=false when a worker service exists)")
    return stop
