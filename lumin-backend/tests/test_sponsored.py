import uuid
from datetime import datetime, timedelta

from app.sponsored import Candidate, rank

CAT_A, CAT_B = uuid.uuid4(), uuid.uuid4()
NOW = datetime(2026, 10, 16)


def cand(cat=CAT_A, merchant=None, in_stock=True, imp=0, age=0, product=None):
    return Candidate(uuid.uuid4(), product or uuid.uuid4(), merchant or uuid.uuid4(), cat, in_stock, imp, NOW + timedelta(days=age))


def test_only_the_same_category_is_shown():
    assert rank([cand(cat=CAT_B)], {CAT_A}, set(), set()) is None
    c = cand()
    assert rank([cand(cat=CAT_B), c], {CAT_A}, set(), set()) is c


def test_no_known_category_means_no_ad():
    assert rank([cand()], set(), set(), set()) is None


def test_the_videos_own_products_and_sellers_are_not_advertised_back():
    mine, seller = uuid.uuid4(), uuid.uuid4()
    assert rank([cand(product=mine)], {CAT_A}, {mine}, set()) is None
    assert rank([cand(merchant=seller)], {CAT_A}, set(), {seller}) is None


def test_out_of_stock_and_sellerless_products_are_never_shown():
    assert rank([cand(in_stock=False)], {CAT_A}, set(), set()) is None
    c = cand()
    c.merchant_id = None
    assert rank([c], {CAT_A}, set(), set()) is None


def test_sellers_take_turns_least_shown_first_then_oldest():
    a, b, c = cand(imp=5, age=0), cand(imp=2, age=2), cand(imp=2, age=1)
    assert rank([a, b, c], {CAT_A}, set(), set()) is c
