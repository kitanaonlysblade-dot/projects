import pytest
from fastapi import HTTPException

from app.inventory import release_stock, reserve_stock
from tests.conftest import make_product


def test_reserve_decrements(db):
    p = make_product(db, stock=5)
    reserve_stock(db, p.id, 2)
    db.commit()
    db.refresh(p)
    assert p.stock_quantity == 3


def test_reserve_more_than_available_is_409_and_leaves_stock(db):
    p = make_product(db, stock=1)
    with pytest.raises(HTTPException) as e:
        reserve_stock(db, p.id, 2)
    assert e.value.status_code == 409
    db.rollback()
    db.refresh(p)
    assert p.stock_quantity == 1


def test_untracked_stock_is_unlimited(db):
    p = make_product(db, stock=None)
    reserve_stock(db, p.id, 999)
    db.commit()
    db.refresh(p)
    assert p.stock_quantity is None


def test_release_puts_stock_back(db):
    p = make_product(db, stock=2)
    reserve_stock(db, p.id, 2)
    release_stock(db, p.id, 2)
    db.commit()
    db.refresh(p)
    assert p.stock_quantity == 2


def test_reserve_unknown_product_404(db):
    import uuid

    with pytest.raises(HTTPException) as e:
        reserve_stock(db, uuid.uuid4(), 1)
    assert e.value.status_code == 404
