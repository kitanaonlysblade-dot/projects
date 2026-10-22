'use client';

import { useEffect, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import {
  ApiError,
  assignPackOrder,
  assignSealBatch,
  getRisk,
  getSealStock,
  type ApiRisk,
  listPackOrders,
  setPackSize,
  type ApiPackOrder,
  createSealBatch,
  listLiveTests,
  listSealBatches,
  voidSealBag,
  type ApiLiveTestEvidence,
  type ApiSealBatch,
} from '@/lib/api';

type Tab = 'tests' | 'batches' | 'shop' | 'risk';

export default function SealsPage() {
  const [tab, setTab] = useState<Tab>('tests');
  const [tests, setTests] = useState<ApiLiveTestEvidence[]>([]);
  const [batches, setBatches] = useState<ApiSealBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [orderFilter, setOrderFilter] = useState('');
  const [count, setCount] = useState('100');
  const [label, setLabel] = useState('');
  const [seller, setSeller] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [assignTo, setAssignTo] = useState<Record<string, string>>({});
  const [packOrders, setPackOrders] = useState<ApiPackOrder[]>([]);
  const [free, setFree] = useState<number | null>(null);
  const [risk, setRisk] = useState<ApiRisk | null>(null);
  const [packProduct, setPackProduct] = useState('');
  const [packSize, setPackSizeText] = useState('10');

  const load = () => {
    setLoading(true);
    Promise.all([listLiveTests(orderFilter.trim() || undefined), listSealBatches(), listPackOrders(), getSealStock(), getRisk()])
      .then(([t, b, po, st, rk]) => {
        setRisk(rk);
        setTests(t);
        setBatches(b);
        setPackOrders(po);
        setFree(st.free_bags);
      })
      .catch((e) => setMsg(e instanceof ApiError ? e.message : 'Could not load.'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const make = async () => {
    setMsg(null);
    try {
      const name = await createSealBatch({ count: Number(count), label: label.trim() || undefined, seller_id: seller.trim() || undefined });
      setMsg(`Downloaded ${name}. Send it to the bag manufacturer now: the codes can't be shown again.`);
      load();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : 'Could not make the batch.');
    }
  };

  const assign = async (id: string) => {
    const s = (assignTo[id] ?? '').trim();
    if (!s) return;
    try {
      const r = await assignSealBatch(id, s);
      setMsg(`Assigned ${r.assigned} bag${r.assigned === 1 ? '' : 's'} to that seller.`);
      load();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : 'Could not assign.');
    }
  };

  const markPack = async (off = false) => {
    setMsg(null);
    try {
      const r = await setPackSize(packProduct.trim(), off ? null : Number(packSize));
      setMsg(off ? `${r.name} is an ordinary product again.` : `${r.name} now sells a pack of ${r.pack_size} bags per unit.`);
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : 'Could not update the product.');
    }
  };

  const fill = async (orderId: string) => {
    try {
      const r = await assignPackOrder(orderId);
      setMsg(r.complete ? `Assigned: ${r.serials.join(', ')}` : 'Still not enough printed bags in stock. Print another batch first.');
      load();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : 'Could not assign.');
    }
  };

  const voidBag = async (serial: string) => {
    const reason = window.prompt(`Void ${serial}? Say why (kept in its history):`);
    if (!reason || reason.trim().length < 3) return;
    try {
      await voidSealBag(serial, reason.trim());
      load();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : 'Could not void.');
    }
  };

  return (
    <AdminShell>
      <p className="mb-1 text-[20px] font-bold text-text">Sealed bags</p>
      <p className="mb-5 text-[13px] text-text-mute">
        Live-test videos tied to a bag&apos;s QR code, and the print batches. A bag only moves forward: unused, sealed (preview/used),
        in transit, delivered.
      </p>
      <div className="mb-5 flex gap-2">
        {(['tests', 'batches', 'shop', 'risk'] as Tab[]).map((k) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`rounded-full border px-3.5 py-1.5 text-[12px] font-bold ${tab === k ? 'border-hot-pink bg-ink text-white' : 'border-line bg-white text-text-mute'}`}
          >
            {k === 'tests' ? 'Live tests' : k === 'batches' ? 'Print batches' : k === 'shop' ? 'Bag shop' : 'Risk signals'}
          </button>
        ))}
      </div>
      {msg && <p className="mb-4 rounded-lg bg-panel p-2.5 text-[12.5px] text-text">{msg}</p>}
      {loading && <p className="text-[13px] text-text-mute">Loading…</p>}

      {tab === 'tests' && (
        <>
          <div className="mb-4 flex gap-2">
            <input
              value={orderFilter}
              onChange={(e) => setOrderFilter(e.target.value)}
              placeholder="Filter by order id"
              className="w-80 rounded-lg border border-line px-3 py-1.5 text-[13px]"
            />
            <button onClick={load} className="rounded-lg border border-line px-3 py-1.5 text-[12px] font-bold">Search</button>
          </div>
          {!loading && tests.length === 0 && <p className="text-[13px] text-text-mute">No sealed live tests yet.</p>}
          <div className="space-y-3">
            {tests.map((t) => (
              <div key={t.id} className="rounded-xl border border-line bg-white p-4">
                <div className="mb-2 flex flex-wrap items-start justify-between gap-3">
                  <p className="text-[12px] text-text-mute">
                    Order {t.order_id} · Bag <b className="text-text">{t.serial}</b> ({t.bag_status}) · Test code {t.order_code}
                  </p>
                  {t.serial && t.bag_status !== 'void' && t.bag_status !== 'delivered' && (
                    <button onClick={() => voidBag(t.serial!)} className="rounded-lg border border-line px-2.5 py-1 text-[11.5px] font-medium text-danger">
                      Void bag
                    </button>
                  )}
                </div>
                {t.video_url && <video src={t.video_url} controls preload="metadata" className="mb-3 max-h-[360px] rounded-lg bg-black" />}
                <p className="text-[12px] text-text">
                  Sealed {t.sealed_at ? new Date(t.sealed_at).toLocaleString() : ''} · video {t.claimed_duration_s?.toFixed(0)}s
                </p>
                <p className="mt-1 text-[12px] text-text">
                  <span className="font-bold">Seller showed:</span> {t.checklist.length ? t.checklist.join(', ') : 'nothing ticked'}
                </p>
                {t.note && <p className="mt-1 text-[12px] text-text-mute">Note: {t.note}</p>}
                <p className="mt-1 break-all font-mono text-[10.5px] text-text-mute">sha256 {t.video_sha256}</p>
                <div className="mt-2 border-t border-line pt-2">
                  {t.events.map((e, i) => (
                    <p key={i} className="text-[11.5px] text-text-mute">
                      {new Date(e.created_at).toLocaleString()} · {e.from_status ?? 'new'} → {e.to_status}
                      {e.note ? ` · ${e.note}` : ''}
                    </p>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === 'batches' && (
        <>
          <div className="mb-6 rounded-xl border border-line bg-white p-4">
            <p className="mb-2 text-[13px] font-bold text-text">Make a batch of bag labels</p>
            <div className="flex flex-wrap gap-2">
              <input value={count} onChange={(e) => setCount(e.target.value)} inputMode="numeric" className="w-24 rounded-lg border border-line px-3 py-1.5 text-[13px]" aria-label="How many" />
              <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (e.g. Small bags, Nov)" className="w-60 rounded-lg border border-line px-3 py-1.5 text-[13px]" />
              <input value={seller} onChange={(e) => setSeller(e.target.value)} placeholder="Seller user id (optional)" className="w-72 rounded-lg border border-line px-3 py-1.5 text-[13px]" />
              <button onClick={make} className="rounded-lg bg-ink px-3.5 py-1.5 text-[12.5px] font-bold text-white">Make and download PDF</button>
            </div>
            <p className="mt-2 text-[11.5px] text-text-mute">
              The PDF is the only place the codes are readable (only hashes are stored). Print it at 100% scale. Labels are 45 x 40 mm.
            </p>
          </div>
          <div className="space-y-2">
            {batches.map((b) => (
              <div key={b.id} className="rounded-xl border border-line bg-white p-3.5">
                <p className="text-[13px] font-bold text-text">{b.label || 'Batch'} · {b.count} bags</p>
                <p className="text-[12px] text-text-mute">
                  {new Date(b.created_at).toLocaleString()} · {Object.entries(b.by_status).map(([k, v]) => `${v} ${k}`).join(' · ')}
                </p>
                <div className="mt-2 flex gap-2">
                  <input
                    value={assignTo[b.id] ?? ''}
                    onChange={(e) => setAssignTo((m) => ({ ...m, [b.id]: e.target.value }))}
                    placeholder="Seller user id to assign the unowned bags to"
                    className="w-80 rounded-lg border border-line px-3 py-1 text-[12px]"
                  />
                  <button onClick={() => assign(b.id)} className="rounded-lg border border-line px-3 py-1 text-[12px] font-bold">Assign</button>
                </div>
              </div>
            ))}
            {!loading && batches.length === 0 && <p className="text-[13px] text-text-mute">No batches yet.</p>}
          </div>
        </>
      )}

      {tab === 'shop' && (
        <>
          <div className="mb-6 rounded-xl border border-line bg-white p-4">
            <p className="text-[13px] font-bold text-text">Sell bags in the shop like any product</p>
            <p className="mb-2 mt-1 text-[12px] text-text-mute">
              List a product on the Lumin shop account as normal (name, price, photos). Then paste its product id here and say how many
              bags one unit comes with. Whenever someone buys it, that many printed bags are reserved to the buyer and the Lumin shop
              order shows which serials to pack. Free printed bags left: <b className="text-text">{free ?? '…'}</b>
            </p>
            <div className="flex flex-wrap gap-2">
              <input value={packProduct} onChange={(e) => setPackProduct(e.target.value)} placeholder="Product id" className="w-80 rounded-lg border border-line px-3 py-1.5 text-[13px]" />
              <input value={packSize} onChange={(e) => setPackSizeText(e.target.value)} inputMode="numeric" className="w-20 rounded-lg border border-line px-3 py-1.5 text-[13px]" aria-label="Bags per unit" />
              <button onClick={() => markPack(false)} className="rounded-lg bg-ink px-3.5 py-1.5 text-[12.5px] font-bold text-white">Make it a bag pack</button>
              <button onClick={() => markPack(true)} className="rounded-lg border border-line px-3.5 py-1.5 text-[12.5px] font-bold text-text-mute">Turn off</button>
            </div>
          </div>
          <p className="mb-2 text-[13px] font-bold text-text">Bag orders</p>
          {!loading && packOrders.length === 0 && <p className="text-[13px] text-text-mute">No bag orders yet.</p>}
          <div className="space-y-2">
            {packOrders.map((o) => (
              <div key={o.order_id} className="rounded-xl border border-line bg-white p-3.5">
                <p className="text-[13px] font-bold text-text">{o.product_name} · {o.buyer_name} · {o.status}</p>
                <p className="text-[12px] text-text-mute">Order {o.order_id} · {new Date(o.created_at).toLocaleString()}</p>
                {o.serials.length > 0 ? (
                  <p className="mt-1 break-words font-mono text-[12px] text-text">{o.serials.join('  ')}</p>
                ) : (
                  <div className="mt-1 flex items-center gap-2">
                    <p className="text-[12px] text-pink-ink">Waiting for printed bags ({o.pack_size} needed)</p>
                    <button onClick={() => fill(o.order_id)} className="rounded-lg border border-line px-2.5 py-1 text-[11.5px] font-bold">Assign now</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {tab === 'risk' && risk && (
        <div className="space-y-5">
          <p className="text-[12px] text-text-mute">Warning signs only. Nothing here blocks or punishes anyone: look, then decide.</p>
          <div>
            <p className="mb-2 text-[13px] font-bold text-text">Sellers</p>
            {risk.sellers.length === 0 && <p className="text-[13px] text-text-mute">None flagged.</p>}
            {risk.sellers.map((r) => (
              <div key={r.user_id} className="mb-2 rounded-xl border border-line bg-white p-3.5">
                <p className="text-[13px] font-bold text-text">{r.name ?? r.user_id}</p>
                <p className="text-[11.5px] text-text-mute">{r.orders} delivered · {r.claims} disputed · {r.refunded} refunded · {r.refusals} refused · id {r.user_id}</p>
                <ul className="mt-1 list-disc pl-4 text-[12px] text-pink-ink">{r.flags.map((f) => <li key={f}>{f}</li>)}</ul>
              </div>
            ))}
          </div>
          <div>
            <p className="mb-2 text-[13px] font-bold text-text">Same buyer and seller, over and over</p>
            {risk.pairs.length === 0 && <p className="text-[13px] text-text-mute">None flagged.</p>}
            {risk.pairs.map((r) => (
              <div key={r.buyer_id + r.seller_id} className="mb-2 rounded-xl border border-line bg-white p-3.5 text-[12.5px] text-text">
                {r.buyer_name ?? r.buyer_id} bought from {r.seller_name ?? r.seller_id}: {r.flags[0]}
              </div>
            ))}
          </div>
          <div>
            <p className="mb-2 text-[13px] font-bold text-text">Buyers with many claims</p>
            {risk.buyers.length === 0 && <p className="text-[13px] text-text-mute">None flagged.</p>}
            {risk.buyers.map((r) => (
              <div key={r.buyer_id} className="mb-2 rounded-xl border border-line bg-white p-3.5 text-[12.5px] text-text">
                {r.name ?? r.buyer_id}: {r.flags[0]}
              </div>
            ))}
          </div>
        </div>
      )}
    </AdminShell>
  );
}
