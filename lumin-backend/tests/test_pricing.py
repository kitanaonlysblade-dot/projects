from decimal import Decimal

from app.pricing import effective_price


def test_no_discount_is_the_list_price():
    assert effective_price(25, None) == Decimal("25.00")
    assert effective_price("25.00", 0) == Decimal("25.00")


def test_discount_takes_a_percent_off_and_rounds_to_the_cent():
    assert effective_price(40, 25) == Decimal("30.00")
    assert effective_price(19.99, 10) == Decimal("17.99")  # 17.991 -> 17.99
    assert effective_price(10, 33) == Decimal("6.70")


def test_out_of_range_discounts_are_clamped():
    assert effective_price(40, 150) == Decimal("0.00")
    assert effective_price(40, -5) == Decimal("40.00")
