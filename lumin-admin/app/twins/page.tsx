'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Flag, Play } from 'lucide-react';
import { AdminShell } from '@/components/AdminShell';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { StatusBadge } from '@/components/StatusBadge';
import { listTwins, reviewTwin, type ApiTwinReview } from '@/lib/api';

type Tab = 'pending' | 'flagged' | 'approved';

const fmt = (ms: number) => {
  const s = ms / 1000;
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`;
};

// One twin = "this product is on screen from A to B". The reviewer watches just
// that stretch (it loops) and decides whether the product is really there.
function TwinCard({
  twin,
  onApprove,
  onFlag,
}: {
  twin: ApiTwinReview;
  onApprove: () => void;
  onFlag: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  const start = () => {
    const v = ref.current;
    if (!v) return;
    v.currentTime = twin.start_ms / 1000;
    void v.play().catch(() => {});
  };

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-white p-4 sm:flex-row">
      <div className="relative w-full shrink-0 overflow-hidden rounded-lg bg-black sm:w-44">
        {twin.video_url ? (
          <video
            ref={ref}
            src={`${twin.video_url}#t=${twin.start_ms / 1000}`}
            poster={twin.thumbnail_url ?? undefined}
            muted
            playsInline
            preload="metadata"
            controls={playing}
            onPlay={() => setPlaying(true)}
            onTimeUpdate={(e) => {
              const v = e.currentTarget;
              if (v.currentTime * 1000 >= twin.end_ms) v.currentTime = twin.start_ms / 1000;
            }}
            className="block max-h-72 w-full object-contain"
          />
        ) : (
          <div className="flex aspect-[9/16] items-center justify-center text-[12px] text-white/70">No video</div>
        )}
        {!playing && twin.video_url && (
          <button
            onClick={start}
            aria-label="Play this moment"
            className="absolute inset-0 flex items-center justify-center bg-black/25 text-white"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white/90 text-text">
              <Play size={20} />
            </span>
          </button>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="mb-1 flex items-center gap-2">
          <p className="truncate text-[14px] font-bold text-text">{twin.product_name}</p>
          <StatusBadge status={twin.review_status} />
        </div>
        <p className="text-[12.5px] text-text-mute">
          Pill says <b className="text-text">“Shop the {twin.label}”</b>
        </p>
        <p className="text-[12.5px] text-text-mute">
          Claimed on screen <b className="text-text">{fmt(twin.start_ms)}</b> – <b className="text-text">{fmt(twin.end_ms)}</b>
        </p>
        <p className="text-[12px] text-text-mute">Posted by {twin.poster_name}</p>
        <div className="mt-auto flex gap-2 pt-3">
          {twin.review_status !== 'approved' && (
            <button onClick={onApprove} className="flex items-center gap-1.5 rounded-lg bg-success px-3 py-1.5 text-[12.5px] font-bold text-white">
              <Check size={14} /> Product is visible
            </button>
          )}
          {twin.review_status !== 'flagged' && (
            <button onClick={onFlag} className="flex items-center gap-1.5 rounded-lg bg-danger px-3 py-1.5 text-[12.5px] font-bold text-white">
              <Flag size={14} /> Not visible
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function TwinsPage() {
  const [tab, setTab] = useState<Tab>('pending');
  const [items, setItems] = useState<ApiTwinReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flagging, setFlagging] = useState<ApiTwinReview | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    listTwins(tab)
      .then(setItems)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load twins'))
      .finally(() => setLoading(false));
  }, [tab]);

  useEffect(load, [load]);

  const decide = (twin: ApiTwinReview, status: 'approved' | 'flagged', reason?: string) =>
    reviewTwin(twin.id, status, reason)
      .then(() => setItems((prev) => prev.filter((t) => t.id !== twin.id)))
      .catch((e) => setError(e instanceof Error ? e.message : 'Action failed'));

  return (
    <AdminShell>
      <p className="mb-1 text-[20px] font-bold text-text">Twins</p>
      <p className="mb-5 max-w-2xl text-[13px] text-text-mute">
        Merchants pair every product on a video with the moment it appears. Posts are already live; check that each
        product really shows up in the stretch claimed. Flagging hides that product&apos;s pill and asks the merchant to redo it.
      </p>

      <div className="mb-4 flex gap-1.5">
        {(['pending', 'flagged', 'approved'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-bold capitalize ${
              tab === t ? 'bg-hot-pink text-white' : 'bg-white text-text-mute border border-line'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {error && <p className="mb-3 text-[13px] text-danger">{error}</p>}
      {loading ? (
        <p className="text-[13px] text-text-mute">Loading…</p>
      ) : items.length === 0 ? (
        <p className="rounded-xl bg-white p-6 text-center text-[13px] text-text-mute">Nothing {tab} right now.</p>
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {items.map((t) => (
            <TwinCard key={t.id} twin={t} onApprove={() => decide(t, 'approved')} onFlag={() => setFlagging(t)} />
          ))}
        </div>
      )}

      {flagging && (
        <ConfirmDialog
          title="Flag this twin?"
          body={`“${flagging.product_name}” isn't visible between ${fmt(flagging.start_ms)} and ${fmt(flagging.end_ms)}. Its pill will be hidden and the merchant will be asked to twin it again.`}
          noteLabel="Note to the merchant (optional)"
          notePlaceholder="e.g. I can't see a bag in this part of the video"
          confirmLabel="Flag it"
          danger
          onConfirm={(note) => {
            const t = flagging;
            setFlagging(null);
            void decide(t, 'flagged', note);
          }}
          onClose={() => setFlagging(null)}
        />
      )}
    </AdminShell>
  );
}
