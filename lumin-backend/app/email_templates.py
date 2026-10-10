"""Plain functions returning (subject, html) — no template engine, since
there are only two of these and neither has enough conditional structure
to earn one. Inline styles throughout (not a <style> block) because
that's what actually renders consistently across email clients; most
strip or ignore a <head><style> the way a browser wouldn't.
"""

from app.models import Order, Payment

_WRAPPER_OPEN = """\
<div style="font-family: -apple-system, Helvetica, Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #1a1a1a;">
  <h1 style="font-size: 20px; margin-bottom: 4px;">Lumin</h1>
"""
_WRAPPER_CLOSE = """
  <p style="margin-top: 32px; font-size: 12px; color: #888;">
    This is an automated message — please don't reply to this email.
  </p>
</div>
"""


def order_confirmation_email(orders: list[Order], payment: Payment) -> tuple[str, str]:
    """One email per Payment, covering every Order it produced —
    matches how a real receipt reads (one purchase, however many line
    items) rather than sending a separate email per Order row the way
    _fulfill's own per-unit expansion (a quantity-3 line becomes 3 Order
    rows) would otherwise suggest. Called once, from payments.py's
    _fulfill, with the exact list it just created.
    """
    address = payment.shipping_address
    rows = "".join(
        f"""
        <tr>
          <td style="padding: 8px 0; border-bottom: 1px solid #eee;">
            {order.product_name}{f" · {order.color}" if order.color else ""}{f" · {order.size}" if order.size else ""}
          </td>
          <td style="padding: 8px 0; border-bottom: 1px solid #eee; text-align: right;">
            ${order.price:.2f}
          </td>
        </tr>"""
        for order in orders
    )
    subtotal = payment.amount - payment.shipping_fee + payment.discount_amount
    discount_row = (
        f"""
        <tr>
          <td style="padding: 4px 0; color: #16a34a;">Discount</td>
          <td style="padding: 4px 0; text-align: right; color: #16a34a;">-${payment.discount_amount:.2f}</td>
        </tr>"""
        if payment.discount_amount > 0
        else ""
    )
    address_html = (
        f"""
    <p style="font-size: 14px; line-height: 1.5;">
      {address["recipient_name"]}<br>
      {address["line1"]}{f", {address['line2']}" if address.get("line2") else ""}<br>
      {address["city"]}{f", {address['state']}" if address.get("state") else ""}
      {address.get("postal_code") or ""}<br>
      {address["country"]}
    </p>"""
        if address
        else ""
    )

    html = f"""{_WRAPPER_OPEN}
  <p style="font-size: 15px;">Thanks for your order! Here's your receipt.</p>
  <table style="width: 100%; border-collapse: collapse; font-size: 14px; margin: 16px 0;">
    {rows}
    <tr>
      <td style="padding: 8px 0 4px; font-size: 13px; color: #666;">Subtotal</td>
      <td style="padding: 8px 0 4px; text-align: right; font-size: 13px; color: #666;">${subtotal:.2f}</td>
    </tr>
    {discount_row}
    <tr>
      <td style="padding: 4px 0; font-size: 13px; color: #666;">Shipping</td>
      <td style="padding: 4px 0; text-align: right; font-size: 13px; color: #666;">${payment.shipping_fee:.2f}</td>
    </tr>
    <tr>
      <td style="padding: 8px 0 0; font-weight: bold; border-top: 1px solid #ddd;">Total</td>
      <td style="padding: 8px 0 0; text-align: right; font-weight: bold; border-top: 1px solid #ddd;">${payment.amount:.2f}</td>
    </tr>
  </table>
  <h2 style="font-size: 14px; margin-bottom: 4px;">Shipping to</h2>
  {address_html}
  <p style="font-size: 13px; color: #666;">
    Track this order any time under My Orders in your Lumin profile.
  </p>
{_WRAPPER_CLOSE}"""
    return f"Your Lumin order — ${payment.amount:.2f}", html


def password_reset_email(reset_url: str) -> tuple[str, str]:
    """reset_url already has the raw token in it (routers/auth.py's
    forgot_password builds it) — this function only cares about
    rendering it, not generating or validating it.
    """
    html = f"""{_WRAPPER_OPEN}
  <p style="font-size: 15px;">
    Someone asked to reset the password on this account. If that was you,
    set a new one here — this link expires in 30 minutes:
  </p>
  <p style="margin: 24px 0;">
    <a href="{reset_url}"
       style="background: #ec4899; color: white; padding: 10px 20px; border-radius: 999px;
              text-decoration: none; font-size: 14px; font-weight: bold;">
      Reset your password
    </a>
  </p>
  <p style="font-size: 13px; color: #666;">
    If you didn't request this, you can safely ignore this email — your
    password won't change unless you click the link above and set a new one.
  </p>
{_WRAPPER_CLOSE}"""
    return "Reset your Lumin password", html
