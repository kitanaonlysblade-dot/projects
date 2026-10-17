// Website side of the native scan features (Android share sheet, quick-settings tile; iPhone share extension).
// The native shell exposes a "LuminScan" plugin; outside the app none of this does anything.
import { safeAppPath } from './native';

export interface ScanEvent {
  working?: boolean;
  found?: boolean;
  video_post_id?: string | null;
  message?: string | null;
  open_path?: string | null;
}

export interface NativeScanPlugin {
  configure(opts: { apiBase: string; token: string }): Promise<void>;
  consumePending(): Promise<ScanEvent>;
  requestAddTile?(): Promise<{ supported: boolean; result?: number }>;
  addListener(event: string, cb: (e: ScanEvent) => void): Promise<{ remove: () => Promise<void> }>;
}

export function nativeScanPlugin(): NativeScanPlugin | null {
  if (typeof window === 'undefined') return null;
  const caps = (window as unknown as { Capacitor?: { Plugins?: Record<string, unknown> } }).Capacitor;
  return (caps?.Plugins?.LuminScan as NativeScanPlugin | undefined) ?? null;
}

export type ScanAction =
  | { kind: 'none' }
  | { kind: 'working' }
  | { kind: 'open'; path: string }
  | { kind: 'notfound'; message: string };

/** Turns what the native side reported into one thing for the page to do. Pure, so it can be tested. */
export function scanAction(e: ScanEvent | null | undefined): ScanAction {
  if (!e || typeof e !== 'object') return { kind: 'none' };
  if (e.working) return { kind: 'working' };
  const direct = safeAppPath(e.open_path);
  if (direct) return { kind: 'open', path: direct };
  if (e.found && typeof e.video_post_id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(e.video_post_id)) {
    return { kind: 'open', path: `/v/${e.video_post_id}` };
  }
  if (e.found === false) {
    return { kind: 'notfound', message: typeof e.message === 'string' && e.message ? e.message : "We couldn't find this on Lumin." };
  }
  return { kind: 'none' };
}
