'use client';

import { useState } from 'react';
import { Package, Truck, CheckCircle2, XCircle } from 'lucide-react';
import type { Order } from '@/lib/types';

const statusStyles: Record<Order['status'], string> = {
  pending: 'bg-hot-orange/10 text-hot-orange',
  shipped: 'bg-violet/10 text-violet',
  delivered: 'bg-green-500/10 text-green-600',
  cancelled: 'bg-text-mute/10 text-text-mute',
};

const statusLabels: Record<Order['status'], string> = {
  pending: 'Pending',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

// Deliberately linear — pending → shipped → delivered, no skipping and no
// going back. Cancellation (below) is the one way out of that line, not a
// step in it: it can happen from pending or shipped, but never turns back
// into one of the forward steps, and delivered can't reach it at all — see
// the backend route's own comment on why that's a return, not a
// cancellation.
function nextStatus(status: Order['status']): Order['status'] | null {
  if (status === 'pending') return 'shipped';
  if (status === 'shipped') return 'delivered';
  return null;
}

const nextActionLabel: Record<Order['status'], string> = {
  pending: 'Mark as shipped',
  shipped: 'Mark as delivered',
  delivered: '',
  cancelled: '',
};

interface MerchantOrdersProps {
  orders: Order[];
  onAdvanceStatus: (id: string, status: Order['status']) => void;
  // Refunds through Paystack automatically when the order was actually
  // paid for — see the backend route's own docstring for exactly what
  // that does and doesn't cover (it's a partial refund of just this
  // order's price, not the whole payment).
  onCancel: (id: string, reason?: string) => void;
}

// Fed entirely by real Buy Now taps on the shop feed's ProductCard — there
// is no seed/mock data here, so an empty list means exactly what it says:
// nobody's bought anything yet, not "the demo data hasn't loaded."
export function MerchantOrders({ orders, onAdvanceStatus, onCancel }: MerchantOrdersProps) {
  // Which order's inline cancel-reason prompt is open, if any — only one
  // at a time, same as MerchantProducts only ever editing one product.
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const startCancel = (id: string) => {
    setCancellingId(id);
    setReason('');
  };

  const confirmCancel = (id: string) => {
    onCancel(id, reason.trim() || undefined);
    setCancellingId(null);
    setReason('');
  };

  if (orders.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-1.5 py-16 text-center">
        <Package size={22} className="text-text-mute" />
        <p className="text-[13px] font-bold text-text">No orders yet</p>
        <p className="max-w-[240px] text-[13.5px] text-text-mute">
          Orders show up here the moment someone taps &quot;Buy now&quot; on one of your posts.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 px-4 py-5 lg:px-8 lg:py-8">
      <p className="mb-4 text-[13px] font-bold text-text">
        {orders.length} order{orders.length === 1 ? '' : 's'}
      </p>
      <div className="flex flex-col gap-2.5">
        {orders.map((order) => {
          const next = nextStatus(order.status);
          const canCancel = order.status === 'pending' || order.status === 'shipped';
          return (
            <div
              key={order.id}
              className="flex flex-col gap-2 rounded-xl border border-line bg-white p-3.5 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-[13.5px] font-bold text-text">{order.productName}</p>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${statusStyles[order.status]}`}>
                    {statusLabels[order.status]}
                  </span>
                </div>
                <p className="mt-0.5 text-[12.5px] text-text-mute">
                  {order.buyerName} · {[order.color, order.size].filter(Boolean).join(' · ') || 'One size'} · {order.placedAt}
                </p>
                {order.status === 'cancelled' && order.cancelReason && (
                  <p className="mt-1 text-[12.5px] text-text-mute">Reason: {order.cancelReason}</p>
                )}

                {cancellingId === order.id && (
                  <div className="mt-2.5 flex flex-col gap-1.5 sm:max-w-xs">
                    <input
                      type="text"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="Reason (optional) — e.g. out of stock"
                      className="rounded-lg border border-line px-2.5 py-1.5 text-[13px] text-text placeholder:text-text-mute focus:border-hot-pink focus:outline-none"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => setCancellingId(null)}
                        className="flex-1 rounded-full border border-line py-1.5 text-[12.5px] font-bold text-text"
                      >
                        Keep order
                      </button>
                      <button
                        onClick={() => confirmCancel(order.id)}
                        className="flex-1 rounded-full bg-hot-pink py-1.5 text-[12.5px] font-bold text-white"
                      >
                        Confirm cancel & refund
                      </button>
                    </div>
                  </div>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <p className="text-[13px] font-bold text-hot-pink">${order.price.toFixed(2)}</p>
                {next && cancellingId !== order.id && (
                  <button
                    onClick={() => onAdvanceStatus(order.id, next)}
                    className="flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-[12.5px] font-bold text-text"
                  >
                    {next === 'shipped' ? <Truck size={15} /> : <CheckCircle2 size={15} />}
                    {nextActionLabel[order.status]}
                  </button>
                )}
                {canCancel && cancellingId !== order.id && (
                  <button
                    onClick={() => startCancel(order.id)}
                    className="flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-[12.5px] font-bold text-text-mute"
                  >
                    <XCircle size={15} />
                    Cancel
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
