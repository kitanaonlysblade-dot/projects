'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Bell, BellOff, ChevronRight, ChevronUp, Share2 } from 'lucide-react';
import {
  ApiError,
  getToken,
  getWanted,
  getWantedTwins,
  removeWantedUpvote,
  setWantedNotify,
  upvoteWanted,
  withdrawWantedTwin,
  type ApiTwinOption,
  type ApiWantedDetail,
  type ApiWantedTwins,
} from '@/lib/api';
import { apiProductToProduct } from '@/lib/adapters';
import { clockLabel, compactCount, frameTimes, tileKind, tileRatio } from '@/lib/wanted';
import type { Product } from '@/lib/types';
import { BoxRing } from './CircleIt';
import { FrameStrip, LoopVideo } from './MomentMedia';
import { Avatar, ProductThumb, TwinIcon } from './TwinBits';
import { TwinCompare } from './TwinCompare';
import { TwinItSheet } from './TwinItSheet';
import { ReportTwinSheet } from './ReportTwinSheet';

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export type WantedScreen = 'detail' | 'compare';

// One wanted moment, opened: the moment itself (looping), how many people want it, "Want it"
// and the bell ("Notify me"), the "N twinned this moment" bar into the compare list, and for
// sellers "Twin it". Counts are different people, never names.
export function WantedDetail({
  id,
  initialScreen = 'detail',
  onScreenChange,
  onBack,
  onOpenProduct,
  isMerchant,
  onOpenMerchantCreate,
  onNeedLogin,
}: {
  id: string;
  initialScreen?: WantedScreen;
  // Lets the page remember the screen, so coming back from a product page lands on the same one.
  onScreenChange?: (screen: WantedScreen) => void;
  onBack: () => void;
  onOpenProduct: (product: Product) => void;
  isMerchant: boolean;
  onOpenMerchantCreate: () => void;
  onNeedLogin: () => void;
}) {
  const [d, setD] = useState<ApiWantedDetail | null>(null);
  const [twins, setTwins] = useState<ApiWantedTwins | null>(null);
  const [gone, setGone] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [screen, setScreenState] = useState<WantedScreen>(initialScreen);
  const [twinItOpen, setTwinItOpen] = useState(false);
  const [reporting, setReporting] = useState<ApiTwinOption | null>(null);

  const setScreen = (s: WantedScreen) => {
    setScreenState(s);
    onScreenChange?.(s);
  };

  const load = useCallback(() => {
    getWanted(id)
      .then(setD)
      .catch(() => setGone(true));
    getWantedTwins(id)
      .then(setTwins)
      .catch(() => setTwins({ items: [], has_official: false }));
  }, [id]);
  useEffect(load, [load]);

  const needAuth = (fn: () => Promise<void>) => async () => {
    if (!getToken()) {
      onNeedLogin();
      return;
    }
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setNote(e instanceof ApiError ? e.message : 'Something went wrong — try again.');
    } finally {
      setBusy(false);
    }
  };

  const want = needAuth(async () => {
    if (!d) return;
    if (d.upvoted) {
      const after = await removeWantedUpvote(id);
      if (after) setD(after);
      else onBack(); // you were the only one; the request is gone
      return;
    }
    const r = await upvoteWanted(id);
    setD(r.item);
    setNote(
      r.matches.length > 0
        ? 'Good news — a twin for this is already available.'
        : `You’re #${r.item.count} 🎉 We’ll tell you when it’s twinned.`,
    );
  });

  const bell = needAuth(async () => {
    if (!d) return;
    setD(await setWantedNotify(id, !d.notifying));
  });

  const withdraw = (o: ApiTwinOption) =>
    needAuth(async () => {
      await withdrawWantedTwin(id, o.product.id);
      load();
    })();

  // Share this moment: the phone's share sheet where there is one, otherwise copy the link.
  // The link (?wanted=<id>) is read by the app on load and opens this screen.
  const share = async () => {
    if (!d) return;
    const url = new URL(window.location.href);
    url.search = '';
    url.hash = '';
    url.searchParams.set('wanted', id);
    const text = `Do you know where to get this? “${d.query}” — ${compactCount(d.count)} want it`;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Wanted twin', text, url: url.toString() });
      } else {
        await navigator.clipboard.writeText(url.toString());
        setNote('Link copied.');
      }
    } catch {
      /* the person closed the share sheet */
    }
  };

  const startTwinIt = () => {
    if (!getToken()) {
      onNeedLogin();
      return;
    }
    if (isMerchant) setTwinItOpen(true);
    else onOpenMerchantCreate();
  };

  if (gone) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-panel p-8 text-center">
        <p className="text-[14px] text-text-mute">This request isn&apos;t available any more.</p>
        <button onClick={onBack} className="brand-gradient rounded-full px-6 py-2 text-[13px] font-bold text-white">
          Back to Wanted
        </button>
      </div>
    );
  }
  if (!d) return <div className="flex h-full items-center justify-center bg-panel text-[13px] text-text-mute">Loading…</div>;

  const options = twins?.items ?? [];

  const sheets = (
    <>
      {twinItOpen && (
        <TwinItSheet
          requestId={id}
          onClose={() => setTwinItOpen(false)}
          onDone={(m) => {
            setNote(m);
            load();
          }}
        />
      )}
      {reporting && <ReportTwinSheet requestId={id} option={reporting} onClose={() => setReporting(null)} />}
    </>
  );

  if (screen === 'compare') {
    return (
      <>
        <TwinCompare
          detail={d}
          options={options}
          hasOfficial={twins?.has_official ?? false}
          onBack={() => setScreen('detail')}
          onOpenProduct={onOpenProduct}
          onReport={(o) => {
            if (!getToken()) onNeedLogin();
            else setReporting(o);
          }}
          onWithdraw={withdraw}
        />
        {sheets}
      </>
    );
  }

  const hasClip = d.video_url && d.start_ms != null && d.end_ms != null;
  const ratio = tileRatio(d.width, d.height, d.id);

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-white">
      <div className="flex shrink-0 items-center gap-3 px-4 py-4">
        <button onClick={onBack} aria-label="Back" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line">
          <ArrowLeft size={18} className="text-text" />
        </button>
        <h1 className="flex-1 truncate text-center text-[18px] font-extrabold text-text">Wanted twin</h1>
        <button
          onClick={() => void share()}
          aria-label="Share this moment"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line"
        >
          <Share2 size={17} className="text-text" aria-hidden="true" />
        </button>
      </div>

      {hasClip && (
        <div className="px-4">
          <div
            className="relative mx-auto max-h-[58vh] overflow-hidden rounded-2xl bg-black"
            style={{ aspectRatio: `1 / ${Math.min(ratio, 1.4)}` }}
          >
            {tileKind(d) === 'still' ? (
              <FrameStrip
                url={d.video_url!}
                times={frameTimes(d.start_ms!, d.end_ms!, d.box_at_ms)}
                poster={d.thumbnail_url}
                box={d.box}
                boxAtMs={d.box_at_ms}
                videoRatio={d.width && d.height ? d.height / d.width : undefined}
              />
            ) : (
              <>
                <LoopVideo
                  url={d.video_url!}
                  startMs={d.start_ms!}
                  endMs={d.end_ms!}
                  poster={d.thumbnail_url}
                  className="h-full w-full object-cover"
                />
                {d.box && d.width && d.height && <BoxRing box={d.box} videoRatio={d.height / d.width} />}
                <span className="absolute right-2.5 top-2.5 rounded-md bg-black/55 px-2 py-0.5 text-[11px] font-bold text-white">
                  {clockLabel(d.end_ms! - d.start_ms!)} · looping
                </span>
              </>
            )}
            {d.creator_name && (
              <span className="absolute bottom-2.5 left-2.5 flex items-center gap-1.5 rounded-full bg-black/55 py-1 pl-1 pr-2.5 text-[11.5px] font-semibold text-white">
                <Avatar url={d.creator_avatar_url} name={d.creator_name} size={20} />
                From {d.creator_name}
              </span>
            )}
          </div>
        </div>
      )}

      <div className="px-4 pb-4 pt-3.5">
        <h2 className="text-[19px] font-extrabold leading-snug text-text">{d.query}</h2>
        <div className="mt-3 flex gap-2">
          <button
            onClick={want}
            disabled={busy}
            aria-pressed={d.upvoted}
            className={`flex items-center gap-1.5 rounded-full px-4 py-2.5 text-[13.5px] font-bold ${
              d.upvoted ? 'border border-hot-pink bg-hot-pink/10 text-hot-pink' : 'brand-gradient text-white'
            }`}
          >
            <ChevronUp size={16} strokeWidth={2.8} aria-hidden="true" />
            {d.upvoted ? 'Wanted' : 'Want it'}
          </button>
          <button
            onClick={bell}
            disabled={busy}
            aria-pressed={d.notifying}
            className={`flex items-center gap-1.5 rounded-full px-4 py-2.5 text-[13.5px] font-bold ${
              d.notifying ? 'bg-ink text-white' : 'border border-line bg-white text-text'
            }`}
          >
            {d.notifying ? <Bell size={15} aria-hidden="true" /> : <BellOff size={15} aria-hidden="true" />}
            {d.notifying ? 'Notifying' : 'Notify me'}
          </button>
        </div>
        <p className="mt-2.5 text-[13px] text-text-mute">
          <span className="font-bold text-text">{compactCount(d.count)}</span> want it
        </p>
        {note && (
          <p role="status" className="mt-2.5 text-[12.5px] font-semibold text-text">
            {note}
          </p>
        )}
      </div>

      {options.length > 0 ? (
        <div className="px-4">
          <button
            onClick={() => setScreen('compare')}
            className="flex w-full items-center gap-3 rounded-2xl bg-ink p-4 text-left text-white"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/30">
              <TwinIcon size={17} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-bold">{options.length} twinned this moment</span>
              <span className="block text-[12.5px] text-white/70">Compare prices and matches</span>
            </span>
            <ChevronRight size={18} aria-hidden="true" />
          </button>
          <div className="mt-2.5 flex items-center gap-2">
            {options.slice(0, 5).map((o) => (
              <ProductThumb key={o.product.id} product={o.product} size={44} />
            ))}
            {options.length > 5 && (
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-box text-[12px] font-bold text-text-mute">
                +{options.length - 5}
              </span>
            )}
          </div>
        </div>
      ) : (
        <p className="px-4 text-[13px] text-text-mute">
          {d.fulfilled_product ? 'A twin is available.' : 'No twins yet. Sellers who have it can twin it.'}
        </p>
      )}

      {options.length === 0 && d.fulfilled_product && (
        <div className="mx-4 mt-3 rounded-2xl border border-line bg-white p-4">
          <button
            onClick={() => onOpenProduct(apiProductToProduct(d.fulfilled_product!))}
            className="text-left text-[13.5px] font-bold text-hot-pink underline"
          >
            {d.fulfilled_product.name}
          </button>
        </div>
      )}

      <div className="mx-4 mt-3 flex items-center gap-2 rounded-xl border border-dashed border-line p-3 text-[13px] text-text-mute">
        <TwinIcon size={15} />
        <span>Sell something like this?</span>
        <button onClick={startTwinIt} className="font-bold text-hot-pink">
          {isMerchant || !getToken() ? 'Twin it' : 'Open a shop'}
        </button>
      </div>

      {d.events.length > 0 && (
        <div className="mx-4 mb-8 mt-4 rounded-2xl border border-line bg-white p-4">
          <p className="mb-2 text-[13px] font-bold text-text">Recent activity</p>
          <ul className="space-y-2">
            {d.events.map((e, i) => (
              <li key={i} className="flex items-center justify-between text-[12.5px]">
                <span className="text-text">{e.kind === 'listed' ? 'A seller offered a product' : 'Someone wants this'}</span>
                <span className="text-text-mute">{ago(e.at)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {sheets}
    </div>
  );
}
