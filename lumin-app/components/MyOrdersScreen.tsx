'use client';

import { useEffect, useState } from 'react';
import { Check, Package, Truck, PackageCheck, XCircle, ShieldCheck, AlertTriangle } from 'lucide-react';
import type { Order } from '@/lib/types';
import { RETURN_CLAIM_WINDOW_HOURS } from '@/lib/types';
import { uploadFile, ApiError, getMyClaims, getMyShipments, type ApiClaimMine, type ApiShipmentStatus } from '@/lib/api';
import { ClaimStatusLine } from './ClaimStatusLine';
import { DeliveryCheckSheet } from './DeliveryCheckSheet';
import { CameraRecorder } from './CameraRecorder';
import { PageHeader } from './PageHeader';

const statusStyles: Record<Order['status'], string> = {
  pending: 'bg-hot-orange/10 text-hot-orange',
  shipped: 'bg-violet/10 text-violet',
  delivered: 'bg-green-500/10 text-green-600',
  cancelled: 'bg-text-mute/10 text-text-mute',
};

const statusLabels: Record<Order['status'], string> = {
  pending: 'Placed',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

// Mirrors the linear pending → shipped → delivered progression
// MerchantOrders advances through — this just renders it as a track
// instead of a pill, so "check on progress" reads as a status a buyer can
// watch move forward rather than a single word to re-read each visit.
const steps: { key: Order['status']; label: string; icon: typeof Package }[] = [
  { key: 'pending', label: 'Placed', icon: Package },
  { key: 'shipped', label: 'Shipped', icon: Truck },
  { key: 'delivered', label: 'Delivered', icon: PackageCheck },
];

function stepIndex(status: Order['status']): number {
  return steps.findIndex((s) => s.key === status);
}

function OrderProgress({ status }: { status: Order['status'] }) {
  const current = stepIndex(status);
  return (
    <div className="mt-3 flex items-center">
      {steps.map((step, i) => {
        const done = i <= current;
        const Icon = step.icon;
        return (
          <div key={step.key} className={`flex items-center ${i === steps.length - 1 ? '' : 'flex-1'}`}>
            <div className="flex flex-col items-center gap-1">
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                  done ? 'brand-gradient text-white' : 'bg-panel text-text-mute'
                }`}
              >
                {done && i < current ? <Check size={14} /> : <Icon size={14} />}
              </span>
              <span className={`text-[11px] font-bold ${done ? 'text-text' : 'text-text-mute'}`}>
                {step.label}
              </span>
            </div>
            {i !== steps.length - 1 && (
              <span
                className={`mx-1.5 h-0.5 flex-1 rounded-full ${i < current ? 'brand-gradient' : 'bg-panel'}`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

interface MyOrdersScreenProps {
  orders: Order[];
  onBack: () => void;
  backLabel?: string;
  // Buyer-side cancellation — omitted reason is fine, this app doesn't
  // force a buyer to explain themselves the way it lets a merchant
  // record one. Only rendered while status is pending/shipped; see the
  // backend route's own comment on why delivered orders can't use this.
  onCancel: (id: string) => void;
  // Releases this order's held funds to the merchant right away instead
  // of waiting out the rest of the claim window below.
  onConfirmReceipt: (id: string) => void;
  // videoUrl always comes from uploading a CameraRecorder recording
  // (see handleRecorded below and that component's own comment) — never
  // a gallery file, since there's no code path here that could produce
  // one from anything else. Returns a Promise so this screen can show a
  // real "submitting…" state and surface a failure (e.g. the window
  // closed a second ago) without losing what was just recorded.
  onReportDefect: (id: string, videoUrl: string, reason?: string, reasons?: string[]) => Promise<void>;
  // Reload the orders (after a sealed delivery is confirmed by the driver).
  onRefreshOrders?: () => void;
}

// What the buyer can pick as wrong (codes match the backend's claim_review.FAULTS). The first group are things the seller's
// live test may already have shown working.
const FAULT_CHOICES: { code: string; label: string }[] = [
  { code: 'screen', label: 'Screen' },
  { code: 'sound', label: 'Sound' },
  { code: 'buttons', label: 'Buttons' },
  { code: 'power', label: 'Power / battery' },
  { code: 'camera', label: 'Camera' },
  { code: 'fit', label: 'Fit / size' },
  { code: 'damaged', label: 'Damaged' },
  { code: 'missing_parts', label: 'Missing parts' },
  { code: 'wrong_item', label: 'Wrong item' },
  { code: 'not_as_described', label: 'Not as described' },
  { code: 'other', label: 'Other' },
];

// Same underlying Order objects MerchantOrders manages — there's only one
// shop in this prototype, so "orders you've placed" and "orders the
// merchant needs to fulfill" are the same data, just two different
// framings of it. `buyerName` (who bought it, from the seller's point of
// view) is deliberately not shown — from this side of the same data,
// that's just "you." Cancelling here and cancelling from the merchant
// side hit the exact same backend route; this just doesn't collect a
// reason, unlike MerchantOrders' cancel flow.
export function MyOrdersScreen({
  orders,
  onBack,
  backLabel = 'Back to shop',
  onCancel,
  onConfirmReceipt,
  onReportDefect,
  onRefreshOrders,
}: MyOrdersScreenProps) {
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  // Which order's "report a problem" flow is expanded, if any — only one
  // at a time, same pattern as MerchantOrders only ever cancelling one
  // order inline at once.
  const [reportingId, setReportingId] = useState<string | null>(null);
  const [reportReason, setReportReason] = useState('');
  const [submittingDefectId, setSubmittingDefectId] = useState<string | null>(null);
  const [defectError, setDefectError] = useState<string | null>(null);
  const [faults, setFaults] = useState<string[]>([]);
  // Sealed-bag deliveries: which orders are out for delivery, and the one whose door check is open.
  const [shipments, setShipments] = useState<Record<string, ApiShipmentStatus>>({});
  const [checking, setChecking] = useState<{ id: string; productName: string } | null>(null);
  const [claims, setClaims] = useState<Record<string, ApiClaimMine>>({});
  const loadClaims = () => {
    getMyClaims()
      .then((rows) => setClaims(Object.fromEntries(rows.filter((c) => c.role === 'buyer').map((c) => [c.order_id, c]))))
      .catch(() => {});
  };
  useEffect(loadClaims, [orders]);
  useEffect(() => {
    if (!orders.some((o) => o.status === 'shipped')) return;
    getMyShipments().then(setShipments).catch(() => {});
  }, [orders]);

  const handleCancel = (id: string) => {
    setCancellingId(id);
    onCancel(id);
  };

  const handleConfirmReceipt = (id: string) => {
    setConfirmingId(id);
    onConfirmReceipt(id);
  };

  const openReport = (id: string) => {
    setReportingId(id);
    setReportReason('');
    setFaults([]);
    setDefectError(null);
  };

  const handleRecorded = async (orderId: string, file: File) => {
    setSubmittingDefectId(orderId);
    setDefectError(null);
    try {
      // Uploaded here, not inside CameraRecorder — that component's job
      // ends at "here's a recording," same separation MerchantPosts/
      // MerchantProducts already draw between capturing/picking a file
      // and actually uploading it.
      if (faults.length === 0 && !reportReason.trim()) {
        setDefectError("Choose what's wrong, or describe it, before you record.");
        return;
      }
      const { url } = await uploadFile(file);
      await onReportDefect(orderId, url, reportReason.trim() || undefined, faults);
      setReportingId(null);
    } catch (err) {
      setDefectError(err instanceof ApiError ? err.message : 'Could not submit this claim — try again.');
    } finally {
      setSubmittingDefectId(null);
    }
  };

  return (
    <div className="flex h-full flex-col bg-panel">
      <PageHeader title="My Orders" onBack={onBack} backLabel={backLabel} />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-lg px-4 py-4 lg:px-0 lg:py-6">
          {orders.length === 0 ? (
            <div className="flex flex-col items-center gap-1.5 py-16 text-center">
              <Package size={22} className="text-text-mute" />
              <p className="text-[13px] font-bold text-text">No orders yet</p>
              <p className="max-w-[220px] text-[13.5px] text-text-mute">
                Anything you buy from the shop feed shows up here.
              </p>
            </div>
          ) : (
            <>
              <p className="mb-3 text-[13.5px] font-bold text-text">
                {orders.length} order{orders.length === 1 ? '' : 's'}
              </p>
              <div className="flex flex-col gap-2.5">
                {orders.map((order) => {
                  const canCancel = order.status === 'pending' || order.status === 'shipped';
                  const deadline = order.deliveredAt
                    ? new Date(order.deliveredAt).getTime() + RETURN_CLAIM_WINDOW_HOURS * 3600 * 1000
                    : null;
                  const withinClaimWindow = deadline !== null && Date.now() < deadline;
                  const canActOnDelivery =
                    order.status === 'delivered' && order.payoutStatus === 'held' && withinClaimWindow;

                  return (
                    <div key={order.id} className="rounded-xl border border-line bg-surface p-3.5">
                      <div className="flex items-center gap-2">
                        <p className="min-w-0 flex-1 truncate text-[14px] font-bold text-text">
                          {order.productName}
                        </p>
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${statusStyles[order.status]}`}
                        >
                          {statusLabels[order.status]}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[12.5px] text-text-mute">
                        {[order.color, order.size].filter(Boolean).join(' · ') || 'One size'} · {order.placedAt}
                      </p>
                      <p className="mt-1.5 text-[13px] font-extrabold text-price">${order.price.toFixed(2)}</p>
                      {order.isSealPack && order.status !== 'cancelled' && (
                        <p className="mt-1 text-[12px] text-text-mute">
                          {order.sealSerials && order.sealSerials.length > 0
                            ? `Your bags: ${order.sealSerials.join(', ')}. They're yours as soon as they arrive: use them in Go live test.`
                            : 'Your bags are being set aside.'}
                        </p>
                      )}

                      {order.status === 'cancelled' ? (
                        <div className="mt-3 flex items-center gap-1.5 text-text-mute">
                          <XCircle size={16} />
                          <span className="text-[12.5px]">
                            {order.cancelReason ? `Cancelled — ${order.cancelReason}` : 'Cancelled and refunded'}
                          </span>
                        </div>
                      ) : (
                        <OrderProgress status={order.status} />
                      )}

                      {order.status === 'shipped' && shipments[order.id] === 'in_transit' && (
                        <button
                          type="button"
                          onClick={() => setChecking({ id: order.id, productName: order.productName })}
                          className="brand-gradient mt-3 flex w-full items-center justify-center gap-2 rounded-full py-2.5 text-[13px] font-bold text-white"
                        >
                          <ShieldCheck size={16} /> Package arrived? Check the seal and confirm
                        </button>
                      )}
                      {order.status === 'shipped' && shipments[order.id] === 'refused' && (
                        <p className="mt-3 text-[12.5px] text-text-mute">You refused this delivery. Lumin is reviewing it.</p>
                      )}

                      {/* Escrow outcome, once there is one — released/refunded
                          are both terminal for a delivered order, so neither
                          shows the confirm/report actions below. */}
                      {order.status === 'delivered' && order.payoutStatus === 'released' && (
                        <div className="mt-3 flex items-center gap-1.5 text-green-600">
                          <ShieldCheck size={16} />
                          <span className="text-[12.5px]">Payment released to the seller</span>
                        </div>
                      )}
                      {order.status === 'delivered' && order.payoutStatus === 'refunded' && (
                        <div className="mt-3 flex items-center gap-1.5 text-text-mute">
                          <XCircle size={16} />
                          <span className="text-[12.5px]">Refunded — reported as defective</span>
                        </div>
                      )}

                      {claims[order.id] && <ClaimStatusLine claim={claims[order.id]} onChanged={loadClaims} />}

                      {canActOnDelivery && reportingId !== order.id && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            onClick={() => handleConfirmReceipt(order.id)}
                            disabled={confirmingId === order.id}
                            className="rounded-full btn-neutral px-3 py-1.5 text-[12.5px] font-bold disabled:opacity-50"
                          >
                            {confirmingId === order.id ? 'Confirming…' : "It's what I ordered"}
                          </button>
                          <button
                            onClick={() => openReport(order.id)}
                            className="flex items-center gap-1 rounded-full border border-line px-3 py-1.5 text-[12.5px] font-bold text-text-mute"
                          >
                            <AlertTriangle size={14} />
                            Report a problem
                          </button>
                        </div>
                      )}
                      {canActOnDelivery && (
                        <p className="mt-1.5 text-[11.5px] text-text-mute">
                          Auto-releases to the seller if you don&apos;t respond within{' '}
                          {RETURN_CLAIM_WINDOW_HOURS} hours of delivery.
                        </p>
                      )}

                      {reportingId === order.id && (
                        <div className="mt-3">
                          <p className="mb-1.5 text-[12.5px] font-bold text-text">What&apos;s wrong? Pick everything that applies</p>
                          <div className="mb-3 flex flex-wrap gap-1.5">
                            {FAULT_CHOICES.map((f) => (
                              <button
                                key={f.code}
                                type="button"
                                aria-pressed={faults.includes(f.code)}
                                onClick={() => setFaults((cur) => (cur.includes(f.code) ? cur.filter((x) => x !== f.code) : [...cur, f.code]))}
                                className={`rounded-full border px-3 py-1.5 text-[12.5px] font-semibold ${faults.includes(f.code) ? 'border-hot-pink bg-panel text-pink-ink' : 'border-line text-text-mute'}`}
                              >
                                {f.label}
                              </button>
                            ))}
                          </div>
                          <p className="mb-2 text-[11.5px] text-text-mute">
                            Then record the product. If the seller already showed that part working in their live test video, a claim about it can&apos;t be refunded.
                          </p>
                          <CameraRecorder
                            onRecorded={(file) => handleRecorded(order.id, file)}
                            onCancel={() => setReportingId(null)}
                          />
                          <label className="mt-2.5 block">
                            <span className="mb-1 block text-[12.5px] font-bold text-text">
                              Anything to add? (optional)
                            </span>
                            <input
                              type="text"
                              value={reportReason}
                              onChange={(e) => setReportReason(e.target.value)}
                              placeholder="e.g. wrong size, arrived damaged"
                              className="w-full rounded-lg border border-line px-2.5 py-1.5 text-[13px] text-text placeholder:text-text-mute focus:border-hot-pink focus:outline-none"
                            />
                          </label>
                          {submittingDefectId === order.id && (
                            <p className="mt-2 text-[12.5px] text-text-mute">Uploading and submitting…</p>
                          )}
                          {defectError && <p className="mt-2 text-[12.5px] text-pink-ink">{defectError}</p>}
                        </div>
                      )}

                      {canCancel && (
                        <button
                          onClick={() => handleCancel(order.id)}
                          disabled={cancellingId === order.id}
                          className="mt-3 text-[12.5px] font-bold text-pink-ink disabled:opacity-50"
                        >
                          {cancellingId === order.id ? 'Cancelling…' : 'Cancel order'}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
      {checking && (
        <DeliveryCheckSheet
          order={checking}
          onClose={() => setChecking(null)}
          onDelivered={() => onRefreshOrders?.()}
        />
      )}
    </div>
  );
}
