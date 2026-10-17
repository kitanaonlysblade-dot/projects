'use client';

import { useEffect, useRef, useState } from 'react';
import { ScanSearch } from 'lucide-react';
import { ApiError, getVideoPost, scanLink, type ApiScanMatch } from '@/lib/api';
import { scanRecording, sendRecording } from '@/lib/scanClip';
import { apiProductToProduct, apiVideoPostToVideoPost } from '@/lib/adapters';
import type { Product, VideoPost } from '@/lib/types';
import { ScanResult } from './ScanResult';
import { useScanStatus } from '@/lib/useScanStatus';
import { liveScanSupported, startLiveScan, type ScanArea } from '@/lib/liveScan';
import { AreaPicker } from './AreaPicker';

interface ScanVideoCardProps {
  onSelectProduct: (product: Product) => void;
  onSelectShopPost: (post: VideoPost) => void;
  onBuyNow?: (product: Product, color: string, size: string) => void;
  onBuyLook?: (items: { product: Product; color: string; size: string }[]) => void;
  // A result that is on screen is kept by the page, so coming back from a product's page shows it again.
  saved?: FoundScan | null;
  onSave?: (found: FoundScan | null) => void;
}

export type ScanState =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'live'; seconds: number }
  | { kind: 'found'; post: VideoPost; products: Product[]; disputed: boolean; videoUrl: string | null; thumbUrl: string | null; atS: number }
  | { kind: 'none'; message: string; deeperFile?: File; suggestion?: { id: string; atS: number } }
  | { kind: 'error'; message: string };
type State = ScanState;
export type FoundScan = Extract<ScanState, { kind: 'found' }>;

// "Saw a video somewhere else?" — upload a screen recording of it and get back the
// Lumin video it came from and its products. Lives on the search screen's empty state.
// When the device can, the recording is fingerprinted on the device and only the fingerprint is sent (lib/scanClip.ts).
export function ScanVideoCard({ onSelectProduct, onSelectShopPost, onBuyNow, onBuyLook, saved, onSave }: ScanVideoCardProps) {
  const [state, setState] = useState<State>(saved ?? { kind: 'idle' });
  useEffect(() => {
    if (state.kind === 'found') onSave?.(state);
    else if (state.kind === 'idle') onSave?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  const input = useRef<HTMLInputElement>(null);
  const status = useScanStatus(state.kind === 'busy');

  const [link, setLink] = useState('');

  const onFile = (file: File | undefined) => {
    if (file) void run(() => scanRecording(file), file);
  };
  const onLink = () => {
    const url = link.trim();
    if (url) void run(() => scanLink(url));
  };

  // Live scan (desktop browsers only - phone browsers can't capture the screen).
  const [canLive, setCanLive] = useState(false);
  const stopLive = useRef<(() => void) | null>(null);
  useEffect(() => {
    setCanLive(liveScanSupported());
    return () => stopLive.current?.();
  }, []);

  // "Pick the video area": a picture of the shared screen, and the person drags a box around the video.
  const [picker, setPicker] = useState<{ picture: string; done: (a: ScanArea | null) => void } | null>(null);
  const chooseArea = (picture: string) =>
    new Promise<ScanArea | null>((resolve) =>
      setPicker({
        picture,
        done: (a) => {
          setPicker(null);
          resolve(a);
        },
      }),
    );

  const goLive = async (pickArea = false) => {
    setState({ kind: 'live', seconds: 0 });
    const handle = await startLiveScan({
      onTick: (seconds) => setState((cur) => (cur.kind === 'live' ? { kind: 'live', seconds } : cur)),
      onFound: (res) => {
        stopLive.current = null;
        void run(async () => res);
      },
      onEnd: (reason) => {
        stopLive.current = null;
        setState(
          reason === 'timeout'
            ? { kind: 'none', message: "We couldn't find this on Lumin yet. That doesn't mean anything is wrong with it — most videos aren't here." }
            : { kind: 'idle' },
        );
      },
      onError: (message) => {
        stopLive.current = null;
        setState({ kind: 'error', message });
      },
    }, pickArea ? { chooseArea } : {});
    stopLive.current = handle.stop;
  };

  const run = async (lookup: () => Promise<ApiScanMatch>, file?: File) => {
    setState({ kind: 'busy' });
    try {
      const res = await lookup();
      if (!res.found || !res.video_post_id) {
        setState({
          kind: 'none',
          message: res.message || "We couldn't find this on Lumin. That doesn't mean anything is wrong with it — most videos aren't here.",
          deeperFile: res.deeper_check ? file : undefined,
          suggestion: res.suggestion ? { id: res.suggestion.video_post_id, atS: res.suggestion.at_s ?? 0 } : undefined,
        });
        return;
      }
      const api = await getVideoPost(res.video_post_id);
      setState({
        kind: 'found',
        post: apiVideoPostToVideoPost(api),
        products: api.products.map(apiProductToProduct),
        disputed: res.disputed,
        videoUrl: api.lite_video_url || api.video_url,
        thumbUrl: api.thumbnail_url,
        atS: res.at_s ?? 0,
      });
    } catch (e) {
      setState({ kind: 'error', message: e instanceof ApiError ? e.message : 'Something went wrong — please try again.' });
    } finally {
      if (input.current) input.current.value = '';
    }
  };

  return (
    <section className="mx-auto mb-6 w-full max-w-[560px] rounded-2xl border border-line bg-white p-4">
      <div className="flex items-center gap-3">
        <span className="brand-gradient flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white">
          <ScanSearch size={20} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-bold text-text">Saw a video somewhere else?</p>
          <p className="text-[12.5px] leading-snug text-text-mute">
            Choose a screen recording (6–8 seconds works best) to find its products. It&apos;s checked on your device when possible.
          </p>
        </div>
      </div>
      <input
        ref={input}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0])}
        aria-label="Choose a screen recording"
      />
      <button
        type="button"
        disabled={state.kind === 'busy'}
        onClick={() => input.current?.click()}
        className="mt-3 w-full rounded-full bg-hot-pink py-2 text-[13.5px] font-bold text-white disabled:opacity-60"
      >
        {state.kind === 'busy' ? status : 'Choose a recording'}
      </button>

      {state.kind === 'busy' && (
        <div className="mt-3 flex items-center gap-3" aria-hidden="true">
          <div className="skeleton h-16 w-12 shrink-0 rounded-lg" />
          <div className="flex-1 space-y-2">
            <div className="skeleton h-3 w-3/4 rounded" />
            <div className="skeleton h-3 w-1/2 rounded" />
          </div>
        </div>
      )}

      {canLive && (
        <>
          <button
            type="button"
            disabled={state.kind === 'busy' || state.kind === 'live'}
            onClick={() => void goLive()}
            className="mt-2 w-full rounded-full border border-hot-pink py-2 text-[13.5px] font-bold text-hot-pink disabled:opacity-60"
          >
            {state.kind === 'live' ? `Listening… ${state.seconds}s` : 'Scan live (share a tab or window)'}
          </button>
          {state.kind === 'live' ? (
            <button
              type="button"
              onClick={() => stopLive.current?.()}
              className="mt-1.5 w-full text-center text-[12.5px] font-bold text-text-mute"
            >
              Stop
            </button>
          ) : (
            <p className="mt-1.5 text-[11.5px] leading-snug text-text-mute">
              Play the video in another tab or window, share it, and the result pops up while it plays.
            </p>
          )}
        </>
      )}

      <div className="my-3 flex items-center gap-2 text-[11.5px] text-text-mute">
        <span className="h-px flex-1 bg-line" />
        or paste a video link
        <span className="h-px flex-1 bg-line" />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onLink();
        }}
        className="flex gap-2"
      >
        <input
          type="url"
          inputMode="url"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder="https://…"
          aria-label="Video link"
          className="min-w-0 flex-1 rounded-lg border border-line px-3 py-2 text-[13.5px] text-text focus:border-hot-pink focus:outline-none"
        />
        <button
          type="submit"
          disabled={state.kind === 'busy' || !link.trim()}
          className="shrink-0 rounded-full border border-line px-4 py-2 text-[13px] font-bold text-text disabled:opacity-40"
        >
          Scan
        </button>
      </form>
      <p className="mt-1.5 text-[11.5px] leading-snug text-text-mute">
        Works with a Lumin link or a direct video file link. TikTok, Instagram and YouTube links can&apos;t be opened, so
        screen-record those instead.
      </p>

      {state.kind === 'none' && (
        <>
          <p className="mt-3 text-[13px] leading-snug text-text-mute">{state.message}</p>
          {canLive && (
            <button type="button" onClick={() => void goLive(true)} className="mt-2 text-[12.5px] font-bold text-hot-pink">
              Not finding it? Pick the video area and try again
            </button>
          )}
          {state.suggestion && (
            <div className="mt-2 rounded-xl border border-line p-3">
              <p className="text-[13px] font-semibold text-text">Did you mean this video?</p>
              <p className="mt-0.5 text-[12px] leading-snug text-text-mute">We&apos;re not sure, so check that it&apos;s the one you saw.</p>
              <button
                type="button"
                onClick={() => {
                  const sg = state.suggestion!;
                  void run(async () => ({ found: true, video_post_id: sg.id, at_s: sg.atS, stage: null, clip_s: null, covered: null, disputed: false, message: null }));
                }}
                className="mt-2 rounded-full bg-hot-pink px-4 py-1.5 text-[12.5px] font-bold text-white"
              >
                Show me
              </button>
            </div>
          )}
          {state.deeperFile && (
            <button
              type="button"
              onClick={() => void run(() => sendRecording(state.deeperFile!))}
              className="mt-2 w-full rounded-full border border-hot-pink py-2 text-[13px] font-bold text-hot-pink"
            >
              Send the recording for a deeper check
            </button>
          )}
        </>
      )}
      {picker && <AreaPicker picture={picker.picture} onDone={picker.done} />}
      {state.kind === 'error' && <p className="mt-3 text-[13px] text-red-600">{state.message}</p>}
      {state.kind === 'found' && (
        <ScanResult
          post={state.post}
          products={state.products}
          disputed={state.disputed}
          videoUrl={state.videoUrl}
          thumbUrl={state.thumbUrl}
          atS={state.atS}
          onClose={() => setState({ kind: 'idle' })}
          onSelectProduct={onSelectProduct}
          onSelectShopPost={onSelectShopPost}
          onBuyNow={onBuyNow}
          onBuyLook={onBuyLook}
        />
      )}
    </section>
  );
}
