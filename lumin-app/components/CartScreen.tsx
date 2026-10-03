'use client';

import { useState } from 'react';
import { MapPin, Minus, Plus, ShoppingCart, Tag, Trash2, X } from 'lucide-react';
import type { CartItem, ShippingAddress } from '@/lib/types';
import { ApiError } from '@/lib/api';
import { PageHeader } from './PageHeader';
import { ProductThumbnail } from './Thumbnails';

interface CartScreenProps {
  items: CartItem[];
  onBack: () => void;
  onStartShopping: () => void;
  onUpdateQuantity: (id: string, quantity: number) => void;
  onRemove: (id: string) => void;
  // Resolves with the real subtotal/discount/shipping/total actually
  // charged once the server confirms it (shipping varies by merchant —
  // see compute_shipping_fee on the backend — so it's never known
  // exactly until checkout resolves); null means "redirected to fill in
  // a shipping address first, this wasn't a real checkout attempt" —
  // handleCheckout below skips the success state entirely for that case
  // rather than showing a $0 breakdown. Rejects if checkout didn't
  // succeed at all. discountCode is whatever's currently applied
  // (appliedDiscount.code below) — undefined if none.
  onCheckout: (
    discountCode?: string,
  ) => Promise<{ subtotal: number; discount: number; shipping: number; total: number } | null>;
  // Read-only check via POST /discounts/preview — never charges or
  // reserves anything, just tells this screen whether a typed code is
  // currently valid and what it's worth, before the person commits to
  // paying. Rejects (ApiError) for an invalid/expired/exhausted code;
  // handleApplyDiscount below shows that message rather than a generic
  // one, same reasoning handleCheckout already applies to a stock
  // conflict.
  onPreviewDiscount: (code: string) => Promise<{ code: string; discountAmount: number }>;
  // undefined until the account has one saved — the Pay button still
  // shows either way; page.tsx's onCheckout itself is what actually
  // requires one to exist, redirecting to ShippingAddressScreen instead
  // of starting a payment if it's missing. Showing it here too (rather
  // than only discovering that mid-click) is just better to see coming.
  shippingAddress?: ShippingAddress;
  onEditShippingAddress: () => void;
}

// Checkout opens Paystack's payment popup (card or bank transfer) for
// the cart's total, then turns every line into a real Order (same shape
// "Buy now" creates) once that payment is actually confirmed — see
// handleCheckout in page.tsx and payments.py's initialize/verify.
// There's only one shop in this prototype, so "you paid for this" and
// "the merchant needs to fulfill this" are the same event.
export function CartScreen({
  items,
  onBack,
  onStartShopping,
  onUpdateQuantity,
  onRemove,
  onCheckout,
  onPreviewDiscount,
  shippingAddress,
  onEditShippingAddress,
}: CartScreenProps) {
  const [justCheckedOut, setJustCheckedOut] = useState(false);
  // Set from whatever onCheckout actually resolved with — never
  // computed client-side, since shipping depends on which merchant(s)
  // are in the cart and their own settings (compute_shipping_fee on the
  // backend), not something this screen can know in advance.
  const [checkoutTotals, setCheckoutTotals] = useState<{
    subtotal: number;
    discount: number;
    shipping: number;
    total: number;
  } | null>(null);
  const [checkingOut, setCheckingOut] = useState(false);
  const [failed, setFailed] = useState(false);
  const [failMessage, setFailMessage] = useState<string | null>(null);
  const subtotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  // Same client-side early-warning pattern as ProductDrawer's bundle
  // button — the real, race-safe enforcement is still server-side
  // (reserve_stock at payment fulfillment), since stock can change
  // between this render and the moment payment actually clears. This
  // just avoids sending someone into the Paystack popup for a cart
  // that's already known to be undoable.
  const someOutOfStock = items.some((i) => !i.inStock);

  // Discount code — a separate small flow from checkout itself.
  // appliedDiscount is only ever set by a successful onPreviewDiscount
  // call (never guessed client-side), and is cleared the moment the
  // person edits the input again — an amount shown has to match a code
  // that's still exactly what's typed, not a stale one from a previous
  // edit. The actual amount charged always comes back from
  // onCheckout's own response (checkoutTotals.discount) once payment
  // resolves — this one is only ever a preview.
  const [discountInput, setDiscountInput] = useState('');
  const [appliedDiscount, setAppliedDiscount] = useState<{ code: string; discountAmount: number } | null>(
    null,
  );
  const [checkingDiscount, setCheckingDiscount] = useState(false);
  const [discountError, setDiscountError] = useState<string | null>(null);

  const handleApplyDiscount = async () => {
    const code = discountInput.trim();
    if (!code || checkingDiscount) return;
    setCheckingDiscount(true);
    setDiscountError(null);
    try {
      const result = await onPreviewDiscount(code);
      setAppliedDiscount(result);
    } catch (err) {
      setAppliedDiscount(null);
      setDiscountError(err instanceof ApiError ? err.message : "Couldn't check that code — try again.");
    } finally {
      setCheckingDiscount(false);
    }
  };

  const handleRemoveDiscount = () => {
    setAppliedDiscount(null);
    setDiscountInput('');
    setDiscountError(null);
  };

  const handleCheckout = async () => {
    if (checkingOut || someOutOfStock) return;
    setCheckingOut(true);
    setFailed(false);
    setFailMessage(null);
    try {
      const totals = await onCheckout(appliedDiscount?.code);
      if (totals) {
        setCheckoutTotals(totals);
        setJustCheckedOut(true);
        setAppliedDiscount(null);
        setDiscountInput('');
        setTimeout(() => setJustCheckedOut(false), 3200);
      }
    } catch (err) {
      // Cart is deliberately left as-is — nothing was charged, so the
      // lines should still be here to retry rather than vanishing.
      setFailed(true);
      // A stock conflict (409) — or now, just as often, a discount code
      // that stopped being valid in the gap between "Apply" and
      // actually paying (someone else used up the last redemption) —
      // comes back with a specific, useful message. Worth showing
      // verbatim rather than flattening every failure into the same
      // generic line.
      setFailMessage(err instanceof ApiError ? err.message : null);
    } finally {
      setCheckingOut(false);
    }
  };

  return (
    <div className="flex h-full flex-col bg-panel">
      <PageHeader title="Cart" onBack={onBack} backLabel="Back to shop" />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-lg px-4 py-4 lg:px-0 lg:py-6">
          {items.length === 0 ? (
            <div className="flex flex-col items-center gap-1.5 py-16 text-center">
              <ShoppingCart size={22} className="text-text-mute" />
              <p className="text-[13px] font-bold text-text">
                {justCheckedOut ? 'Order placed ✓' : 'Your cart is empty'}
              </p>
              {justCheckedOut && checkoutTotals ? (
                <p className="max-w-[240px] text-[13.5px] text-text-mute">
                  ${checkoutTotals.total.toFixed(2)} charged — ${checkoutTotals.subtotal.toFixed(2)} for your items
                  {checkoutTotals.discount > 0 && <> minus ${checkoutTotals.discount.toFixed(2)} off</>} plus $
                  {checkoutTotals.shipping.toFixed(2)} shipping. Track it under My Orders in your profile.
                </p>
              ) : (
                <p className="max-w-[220px] text-[13.5px] text-text-mute">
                  {justCheckedOut
                    ? 'You can track it under My Orders in your profile.'
                    : 'Add something from the shop feed or a category to see it here.'}
                </p>
              )}
              <button
                onClick={onStartShopping}
                className="brand-gradient mt-2 rounded-full px-5 py-2 text-[13.5px] font-bold text-white"
              >
                Start shopping
              </button>
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-2.5">
                {items.map((item) => (
                  <div key={item.id} className="flex items-center gap-3 rounded-xl border border-line bg-white p-3">
                    <span className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-box">
                      <ProductThumbnail product={{ imageUrl: item.imageUrl }} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13.5px] font-bold text-text">{item.productName}</p>
                      <p className="text-[12.5px] text-text-mute">
                        {[item.color, item.size].filter(Boolean).join(' · ') || 'One size'}
                      </p>
                      <p className="mt-0.5 text-[13.5px] font-bold text-hot-pink">${item.price.toFixed(2)}</p>
                      {!item.inStock && (
                        <p className="mt-0.5 text-[11.5px] font-bold text-hot-pink">
                          Out of stock — remove to check out
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        onClick={() => onUpdateQuantity(item.id, item.quantity - 1)}
                        aria-label="Decrease quantity"
                        className="flex h-6 w-6 items-center justify-center rounded-full border border-line text-text-mute"
                      >
                        <Minus size={13} />
                      </button>
                      <span className="w-4 text-center text-[13.5px] font-bold text-text">{item.quantity}</span>
                      <button
                        onClick={() => onUpdateQuantity(item.id, item.quantity + 1)}
                        aria-label="Increase quantity"
                        className="flex h-6 w-6 items-center justify-center rounded-full border border-line text-text-mute"
                      >
                        <Plus size={13} />
                      </button>
                    </div>
                    <button
                      onClick={() => onRemove(item.id)}
                      aria-label="Remove from cart"
                      className="shrink-0 text-text-mute hover:text-hot-pink"
                    >
                      <Trash2 size={17} />
                    </button>
                  </div>
                ))}
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-line pt-4">
                <span className="text-[13.5px] text-text-mute">Subtotal</span>
                <span className="text-[16px] font-bold text-text">${subtotal.toFixed(2)}</span>
              </div>
              {appliedDiscount && (
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-[12.5px] text-text-mute">Discount ({appliedDiscount.code})</span>
                  <span className="text-[12.5px] font-bold text-hot-pink">
                    -${appliedDiscount.discountAmount.toFixed(2)}
                  </span>
                </div>
              )}
              <div className="mt-1 flex items-center justify-between">
                <span className="text-[12.5px] text-text-mute">Shipping</span>
                <span className="text-[12.5px] text-text-mute">Calculated at checkout</span>
              </div>

              {appliedDiscount ? (
                <div className="mt-3 flex items-center gap-2.5 rounded-xl border border-line bg-white p-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-panel">
                    <Tag size={16} className="text-hot-pink" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12.5px] font-bold text-text">{appliedDiscount.code} applied</span>
                    <span className="block truncate text-[12.5px] text-text-mute">
                      -${appliedDiscount.discountAmount.toFixed(2)} off your subtotal
                    </span>
                  </span>
                  <button
                    onClick={handleRemoveDiscount}
                    aria-label="Remove discount code"
                    className="shrink-0 text-text-mute hover:text-hot-pink"
                  >
                    <X size={17} />
                  </button>
                </div>
              ) : (
                <div className="mt-3">
                  <div className="flex items-center gap-2">
                    <input
                      value={discountInput}
                      onChange={(e) => {
                        setDiscountInput(e.target.value);
                        setDiscountError(null);
                      }}
                      onKeyDown={(e) => e.key === 'Enter' && handleApplyDiscount()}
                      placeholder="Discount code"
                      className="min-w-0 flex-1 rounded-xl border border-line bg-white px-3 py-2.5 text-[13.5px] text-text placeholder:text-text-mute"
                    />
                    <button
                      onClick={handleApplyDiscount}
                      disabled={!discountInput.trim() || checkingDiscount}
                      className="shrink-0 rounded-xl border border-line px-3.5 py-2.5 text-[13.5px] font-bold text-text disabled:opacity-50"
                    >
                      {checkingDiscount ? 'Checking…' : 'Apply'}
                    </button>
                  </div>
                  {discountError && <p className="mt-1.5 text-[12.5px] text-hot-pink">{discountError}</p>}
                </div>
              )}

              <button
                onClick={onEditShippingAddress}
                className="mt-3 flex w-full items-center gap-2.5 rounded-xl border border-line bg-white p-3 text-left"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-panel">
                  <MapPin size={16} className="text-text-mute" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[12.5px] font-bold text-text">Shipping to</span>
                  <span className="block truncate text-[12.5px] text-text-mute">
                    {shippingAddress
                      ? `${shippingAddress.recipientName} · ${shippingAddress.line1}, ${shippingAddress.city}`
                      : 'Add a shipping address'}
                  </span>
                </span>
                <span className="shrink-0 text-[12.5px] font-bold text-hot-pink">
                  {shippingAddress ? 'Edit' : 'Add'}
                </span>
              </button>

              <button
                onClick={handleCheckout}
                disabled={checkingOut || someOutOfStock}
                className="brand-gradient mt-3 w-full rounded-full py-2.5 text-[13px] font-bold text-white disabled:opacity-60"
              >
                {checkingOut
                  ? 'Waiting for payment…'
                  : someOutOfStock
                    ? 'Remove out-of-stock items to check out'
                    : appliedDiscount
                      ? `Pay $${Math.max(subtotal - appliedDiscount.discountAmount, 0).toFixed(2)} + shipping`
                      : `Pay $${subtotal.toFixed(2)} + shipping`}
              </button>
              {failed && (
                <p className="mt-2 text-center text-[12.5px] text-hot-pink">
                  {failMessage ?? "Couldn't place the order — your cart is untouched, try again."}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
