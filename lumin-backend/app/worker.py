"""Dedicated worker: runs the background jobs (app/jobs.py) away from the web server.

    python -m app.worker

Deploy as a second Railway service from the same image/repo (Root Directory `lumin-backend`) with the SAME variables as
the backend and start command `python -m app.worker`; set RUN_JOBS_IN_WEB=false on the web service.
"""
import logging
import signal
import threading

from app import jobs, observability

observability.setup_logging()
observability.setup_sentry()
log = logging.getLogger("lumin")


def main() -> None:
    stop = threading.Event()
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda *_: stop.set())
    log.info("worker started")
    jobs.loop(stop)
    log.info("worker stopped")


if __name__ == "__main__":
    main()
