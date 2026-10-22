"""What a product actually costs. A seller can list a discount on a product (Product.discount_percent, 0-100); the price
a shopper pays is the list price less that percent, rounded to the cent. ONE function decides it, used by everything that
charges money (checkout, the cart subtotal, the discount-code preview, shipping thresholds, the order snapshot) and sent
to the app as `sale_price` so what is shown is what is charged."""
from decimal import ROUND_HALF_UP, Decimal


def effective_price(price, discount_percent) -> Decimal:
    list_price = Decimal(str(price))
    try:
        pct = Decimal(str(discount_percent or 0))
    except Exception:
        pct = Decimal("0")
    pct = min(Decimal("100"), max(Decimal("0"), pct))
    if pct == 0:
        return list_price.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return (list_price * (Decimal("100") - pct) / Decimal("100")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
