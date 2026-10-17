"""Request ids, safe headers, the error handler and the readiness check."""
import re

from fastapi.testclient import TestClient

from app.main import app


def test_every_reply_carries_a_request_id_and_safe_headers(client):
    r = client.get("/health")
    assert re.fullmatch(r"[0-9a-f]{32}", r.headers["x-request-id"])
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["x-frame-options"] == "DENY"


def test_a_sensible_incoming_request_id_is_kept_and_a_junk_one_is_replaced(client):
    assert client.get("/health", headers={"X-Request-ID": "abc-12345678"}).headers["x-request-id"] == "abc-12345678"
    junk = client.get("/health", headers={"X-Request-ID": "x\"; drop table"}).headers["x-request-id"]
    assert re.fullmatch(r"[0-9a-f]{32}", junk)


def test_ready_checks_the_database(client):
    r = client.get("/health/ready")
    assert r.status_code == 200 and r.json()["database"] == "ok"


def test_ready_reports_503_when_the_database_is_down(client, monkeypatch):
    import app.database as database

    class Broken:
        def execute(self, *a, **k):
            raise RuntimeError("down")

        def close(self):
            pass

    monkeypatch.setattr(database, "SessionLocal", lambda: Broken())
    r = client.get("/health/ready")
    assert r.status_code == 503 and r.json()["database"] == "down"


def test_an_unhandled_error_becomes_a_plain_500_with_the_request_id():
    @app.get("/__boom")
    def boom():
        raise RuntimeError("secret internal detail")

    r = TestClient(app, raise_server_exceptions=False).get("/__boom")
    assert r.status_code == 500
    body = r.json()
    assert "secret" not in r.text and body["request_id"] == r.headers["x-request-id"]
