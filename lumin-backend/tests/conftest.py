"""Test harness. Needs a real Postgres (the models use Postgres-only types:
UUID, ARRAY, native enums), pointed at by TEST_DATABASE_URL, e.g.

    docker run -d -p 5433:5432 -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=lumin_test postgres:16
    TEST_DATABASE_URL=postgresql+psycopg2://postgres:pw@localhost:5433/lumin_test pytest

The database is wiped between tests, so NEVER point this at a real one.
"""
import os
import uuid

import pytest

TEST_DB = os.environ.get("TEST_DATABASE_URL")
if not TEST_DB:
    pytest.exit("Set TEST_DATABASE_URL to a throwaway Postgres database (it is wiped between tests).", 2)

# Must be set before any `app.*` import: several modules read these at import time.
os.environ["DATABASE_URL"] = TEST_DB
for key, value in {
    "JWT_SECRET_KEY": "test-secret",
    "PAYSTACK_SECRET_KEY": "sk_test_x",
    "PAYSTACK_PUBLIC_KEY": "pk_test_x",
    "GOOGLE_CLIENT_ID": "test",
    "R2_ACCOUNT_ID": "test",
    "R2_ACCESS_KEY_ID": "test",
    "R2_SECRET_ACCESS_KEY": "test",
    "R2_BUCKET_NAME": "test",
    "R2_PUBLIC_BASE_URL": "https://cdn.test",
    # The twin layer is off by default; the suite exercises it, so it runs with it on
    # (tests/test_twin_off.py flips it off per test).
    "TWIN_ENABLED": "true",
}.items():
    os.environ.setdefault(key, value)

from decimal import Decimal  # noqa: E402

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.auth.security import create_access_token  # noqa: E402
from app.database import SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Base, Product, User, VideoPost  # noqa: E402
from app.models.video import VideoFeed  # noqa: E402
from app.rate_limit import limiter  # noqa: E402

limiter.enabled = False

ADDRESS = {
    "recipient_name": "Ada Buyer",
    "phone": "+10000000",
    "line1": "1 Test St",
    "city": "Lagos",
    "country": "Nigeria",
}


@pytest.fixture(scope="session", autouse=True)
def _schema():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    yield
    Base.metadata.drop_all(engine)


@pytest.fixture(autouse=True)
def _clean():
    yield
    with engine.begin() as conn:
        names = ", ".join(f'"{t.name}"' for t in Base.metadata.sorted_tables)
        conn.execute(text(f"TRUNCATE {names} RESTART IDENTITY CASCADE"))


@pytest.fixture()
def db():
    session = SessionLocal()
    yield session
    session.close()


@pytest.fixture()
def client():
    return TestClient(app)  # not used as a context manager: skips the startup schema hook


@pytest.fixture(autouse=True)
def _no_outbound(monkeypatch):
    import app.routers.payments as payments

    monkeypatch.setattr(payments, "send_email", lambda *a, **k: None)


def make_user(db, name="buyer") -> User:
    user = User(
        email=f"{name}-{uuid.uuid4().hex[:6]}@t.test",
        username=f"{name}{uuid.uuid4().hex[:6]}",
        display_name=name.title(),
        hashed_password="x",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def auth(user: User) -> dict:
    return {"Authorization": f"Bearer {create_access_token(str(user.id))}"}


def make_product(db, price="10.00", stock=5, merchant_id=None) -> Product:
    product = Product(name="Widget", price=Decimal(price), stock_quantity=stock, merchant_id=merchant_id)
    db.add(product)
    db.commit()
    db.refresh(product)
    return product


def make_post(db, poster: User, products=(), repost_of=None) -> VideoPost:
    post = VideoPost(
        feed=VideoFeed.shop,
        poster_id=poster.id,
        video_url="https://cdn.test/v.mp4",
        repost_of_id=repost_of.id if repost_of else None,
    )
    post.products = list(products)
    db.add(post)
    db.commit()
    db.refresh(post)
    return post


@pytest.fixture()
def buyer(db):
    user = make_user(db, "buyer")
    user.set_shipping_address(ADDRESS)
    db.commit()
    return user
