from app import seed
from app.auth.security import hash_password
from app.models import Category, User
from tests.conftest import make_user


def make_demo(db, email, password=seed.DEMO_PASSWORD):
    user = make_user(db, "demo")
    user.email = email
    user.hashed_password = hash_password(password)
    db.commit()
    return user


def test_finds_only_accounts_with_the_public_password(db):
    make_demo(db, "admin@example.com")
    make_demo(db, "someone@example.com", "a-real-password")  # example.com but not the demo password
    make_demo(db, "real@gmail.com")  # demo password but not the demo domain
    assert [u.email for u in seed.demo_accounts(db)] == ["admin@example.com"]


def test_check_flags_powerful_demo_accounts(db, capsys):
    make_demo(db, "admin@example.com")
    assert seed.check() == 1
    assert "PUBLIC password" in capsys.readouterr().out


def test_check_is_quiet_when_clean(db, capsys):
    make_demo(db, "real@gmail.com", "a-real-password")
    assert seed.check() == 0
    assert capsys.readouterr().out == ""


def test_remove_demo_deletes_them_and_nobody_else(db):
    make_demo(db, "admin@example.com")
    make_demo(db, "you@example.com")
    keep = make_demo(db, "real@gmail.com", "a-real-password")
    assert seed.remove_demo() == 2
    db.expire_all()
    assert [u.email for u in db.query(User).all()] == [keep.email]


def test_basics_creates_categories_once_and_no_people(db):
    seed.run_basics()
    seed.run_basics()
    names = [c.name for c in db.query(Category).all()]
    assert len(names) == 4 and len(set(names)) == 4
    assert db.query(User).count() == 0
