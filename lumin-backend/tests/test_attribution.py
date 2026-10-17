import uuid

from app.attribution import resolve_source_post
from tests.conftest import make_post, make_product, make_user


def test_tagged_product_resolves(db):
    owner, p = make_user(db, "o"), None
    p = make_product(db)
    post = make_post(db, owner, [p])
    assert resolve_source_post(db, post.id, p.id).id == post.id


def test_untagged_product_is_ignored(db):
    owner = make_user(db, "o")
    tagged, other = make_product(db), make_product(db)
    post = make_post(db, owner, [tagged])
    assert resolve_source_post(db, post.id, other.id) is None


def test_unknown_or_missing_ids_are_ignored(db):
    p = make_product(db)
    assert resolve_source_post(db, uuid.uuid4(), p.id) is None
    assert resolve_source_post(db, None, p.id) is None
    assert resolve_source_post(db, uuid.uuid4(), None) is None


def test_repost_credits_the_original(db):
    owner, reposter = make_user(db, "o"), make_user(db, "r")
    p = make_product(db)
    original = make_post(db, owner, [p])
    repost = make_post(db, reposter, repost_of=original)
    assert resolve_source_post(db, repost.id, p.id).id == original.id
