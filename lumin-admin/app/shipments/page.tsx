'use client';

import { useEffect, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { ApiError, listShipments, resolveShipment, shipmentConfirm, shipmentPickup, type ApiShipment, type ShipmentStatus } from '@/lib/api';

const TABS: { key: ShipmentStatus | 'all'; label: string }[] = [
  { key: 'awaiting_pickup', label: 'Waiting for a driver' },
  { key: 'in_transit', label: 'In transit' },
  { key: 'refused', label: 'Refused at the door' },
  { key: 'lost', label: 'Lost' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'all', label: 'All' },
];

export default function ShipmentsPage() {
  const [tab, setTab] = useState<ShipmentStatus | 'all'>('awaiting_pickup');
  const [rows, setRows] = useState<ApiShipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [driver, setDriver] = useState<Record<string, string>>({});
  const [otp, setOtp] = useState<Record<string, string>>({});
  const [party, setParty] = useState<Record<string, 'courier' | 'seller' | 'platform'>>({});

  const load = () => {
    setLoading(true);
    listShipments(tab === 'all' ? undefined : tab)
      .then(setRows)
      .catch((e) => setMsg(e instanceof ApiError ? e.message : 'Could not load.'))
      .finally(() => setLoading(false));
  };
  useEffect(load, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null);
    try {
      await fn();
      setMsg(ok);
      load();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : 'That failed.');
    }
  };

  return (
    <AdminShell>
      <p className="mb-1 text-[20px] font-bold text-text">Shipments</p>
      <p className="mb-5 text-[13px] text-text-mute">
        Sealed orders on their way. Until a real courier is connected (COURIER setting), this page is the courier: mark a pickup when a
        driver collects the bag, and enter the code the buyer reads to the driver to complete the delivery.
      </p>
      <div className="mb-5 flex flex-wrap gap-2">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`rounded-full border px-3.5 py-1.5 text-[12px] font-bold ${tab === key ? 'border-hot-pink bg-ink text-white' : 'border-line bg-white text-text-mute'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {msg && <p className="mb-4 rounded-lg bg-panel p-2.5 text-[12.5px] text-text">{msg}</p>}
      {loading && <p className="text-[13px] text-text-mute">Loading…</p>}
      {!loading && rows.length === 0 && <p className="text-[13px] text-text-mute">Nothing here.</p>}
      <div className="space-y-3">
        {rows.map((s) => (
          <div key={s.id} className="rounded-xl border border-line bg-white p-4">
            <p className="text-[13px] font-bold text-text">
              {s.product_name ?? 'Order'} · Bag {s.serial}
            </p>
            <p className="text-[12px] text-text-mute">
              Order {s.order_id} · {s.status.replace('_', ' ')} · {s.courier}
              {s.driver_name ? ` · driver ${s.driver_name}` : ''} · created {new Date(s.created_at).toLocaleString()}
              {s.resolution ? ` · settled: ${s.resolution}${s.loss_party ? ` (cost: ${s.loss_party})` : ''}` : ''}
            </p>
            {s.stalled && <p className="mt-1 text-[12px] font-bold text-pink-ink">Stalled: {s.status === 'awaiting_pickup' ? 'no driver for over a day' : 'on the road for over 3 days with no check-in'}</p>}
            {s.status === 'refused' && (
              <div className="mt-2 rounded-lg bg-panel p-2.5 text-[12px] text-text">
                <p>
                  The buyer refused it at the door (seal not intact). {s.refusal_note ? `They wrote: ${s.refusal_note}` : ''} Nothing has been paid out.
                </p>
                {s.refusal_photo_url && (
                  <a href={s.refusal_photo_url} target="_blank" rel="noreferrer" className="mt-1 inline-block font-medium text-pink-ink underline">Photo from the buyer</a>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <select value={party[s.id] ?? 'courier'} onChange={(e) => setParty((m) => ({ ...m, [s.id]: e.target.value as 'courier' | 'seller' | 'platform' }))} className="rounded-lg border border-line px-2 py-1 text-[12px]">
                    <option value="courier">Cost: courier</option>
                    <option value="seller">Cost: seller</option>
                    <option value="platform">Cost: Lumin</option>
                  </select>
                  <button onClick={() => act(() => resolveShipment(s.id, { action: 'refund', loss_party: party[s.id] ?? 'courier' }), 'Buyer refunded, the order cancelled and the bag voided.')} className="rounded-lg bg-ink px-3 py-1.5 text-[12px] font-bold text-white">Refund the buyer</button>
                  <button onClick={() => act(() => resolveShipment(s.id, { action: 'redeliver' }), 'Sent back out: the buyer will check the bag again.')} className="rounded-lg border border-line px-3 py-1.5 text-[12px] font-bold">The bag was fine: deliver again</button>
                </div>
              </div>
            )}
            {s.status === 'awaiting_pickup' && (
              <div className="mt-2 flex gap-2">
                <input value={driver[s.id] ?? ''} onChange={(e) => setDriver((m) => ({ ...m, [s.id]: e.target.value }))} placeholder="Driver name (optional)" className="w-56 rounded-lg border border-line px-3 py-1.5 text-[12.5px]" />
                <button onClick={() => act(() => shipmentPickup(s.id, (driver[s.id] ?? '').trim() || undefined), 'Marked as collected: the bag is now in transit.')} className="rounded-lg bg-ink px-3 py-1.5 text-[12px] font-bold text-white">
                  Driver collected it
                </button>
              </div>
            )}
            {s.status === 'in_transit' && (
              <div className="mt-2 flex gap-2">
                <input value={otp[s.id] ?? ''} onChange={(e) => setOtp((m) => ({ ...m, [s.id]: e.target.value }))} inputMode="numeric" placeholder="Code from the buyer" className="w-44 rounded-lg border border-line px-3 py-1.5 text-[12.5px]" />
                <button onClick={() => act(() => shipmentConfirm(s.id, (otp[s.id] ?? '').trim()), 'Delivered. The bag is closed for good and the claim window has started.')} className="rounded-lg bg-ink px-3 py-1.5 text-[12px] font-bold text-white">
                  Confirm delivery
                </button>
                <button onClick={() => { if (window.confirm('Mark this package as lost and refund the buyer?')) act(() => resolveShipment(s.id, { action: 'lost', loss_party: party[s.id] ?? 'courier' }), 'Marked lost: the buyer is refunded and the bag voided.'); }} className="rounded-lg border border-line px-3 py-1.5 text-[12px] font-medium text-danger">Lost</button>
                {s.arrived_at && <span className="self-center text-[11.5px] text-text-mute">Buyer scanned the bag {new Date(s.arrived_at).toLocaleTimeString()}</span>}
              </div>
            )}
          </div>
        ))}
      </div>
    </AdminShell>
  );
}
