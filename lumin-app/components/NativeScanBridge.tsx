'use client';

import { useEffect, useState } from 'react';
import { getApiBaseUrl, getToken } from '@/lib/api';
import { useScanStatus } from '@/lib/useScanStatus';
import { nativeScanPlugin, scanAction, type ScanAction, type ScanEvent } from '@/lib/nativeScan';

/**
 * Inside the Android/iPhone app: keeps the native side informed of the API address and sign-in (so a share or the
 * quick-settings tile can upload as the person), and shows what a native scan found. Renders nothing elsewhere.
 */
export function NativeScanBridge() {
  const [banner, setBanner] = useState<ScanAction>({ kind: 'none' });
  const status = useScanStatus(banner.kind === 'working');

  useEffect(() => {
    const plugin = nativeScanPlugin();
    if (!plugin) return;
    let removed = false;
    let handle: { remove: () => Promise<void> } | null = null;

    const sync = () => {
      plugin.configure({ apiBase: getApiBaseUrl(), token: getToken() ?? '' }).catch(() => {});
    };
    const handle_ = (e: ScanEvent) => {
      const a = scanAction(e);
      if (a.kind === 'open') {
        setBanner({ kind: 'none' });
        window.location.assign(a.path);
      } else if (a.kind !== 'none') {
        setBanner(a);
      }
    };

    sync();
    // Sign-in/out happens in the page, so refresh the native copy when the page returns to the foreground.
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        sync();
        plugin.consumePending().then(handle_).catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('storage', sync);
    plugin.consumePending().then(handle_).catch(() => {});
    plugin
      .addListener('scanResult', handle_)
      .then((h) => {
        if (removed) h.remove().catch(() => {});
        else handle = h;
      })
      .catch(() => {});

    return () => {
      removed = true;
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('storage', sync);
      handle?.remove().catch(() => {});
    };
  }, []);

  if (banner.kind === 'none') return null;
  return (
    <div
      role="status"
      className="fixed left-3 right-3 top-3 z-[100] rounded-xl bg-neutral-900 px-4 py-3 text-sm text-white shadow-lg"
      style={{ marginTop: 'env(safe-area-inset-top)' }}
    >
      <div className="flex items-start justify-between gap-3">
        <span>{banner.kind === 'working' ? status : banner.kind === 'notfound' ? banner.message : ''}</span>
        {banner.kind === 'notfound' && (
          <button className="font-semibold underline" onClick={() => setBanner({ kind: 'none' })}>
            OK
          </button>
        )}
      </div>
    </div>
  );
}
