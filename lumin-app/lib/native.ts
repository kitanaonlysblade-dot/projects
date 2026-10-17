// The native app (Android / iPhone) is this same website running inside a Capacitor shell (see ../NATIVE.md).
// Capacitor injects `window.Capacitor` into the page; in a normal browser it does not exist. Nothing here may throw
// outside the app.

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  Plugins?: Record<string, unknown>;
}

function cap(): CapacitorGlobal | null {
  if (typeof window === 'undefined') return null;
  return ((window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor ?? null) as CapacitorGlobal | null;
}

export function isNativeApp(): boolean {
  try {
    return cap()?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
}

export function nativePlatform(): 'android' | 'ios' | null {
  const p = cap()?.getPlatform?.();
  return p === 'android' || p === 'ios' ? p : null;
}

// The Firebase push plugin as exposed by the shell (@capacitor/push-notifications).
export interface NativePush {
  checkPermissions(): Promise<{ receive: string }>;
  requestPermissions(): Promise<{ receive: string }>;
  register(): Promise<void>;
  unregister?(): Promise<void>;
  addListener(event: string, cb: (data: any) => void): Promise<{ remove: () => Promise<void> }>;
}

export function nativePush(): NativePush | null {
  const plugin = cap()?.Plugins?.PushNotifications as NativePush | undefined;
  return plugin ?? null;
}

// Where a tapped notification should go: only paths inside the app (never an outside address).
export function safeAppPath(url: unknown): string | null {
  if (typeof url !== 'string' || !url.startsWith('/') || url.startsWith('//')) return null;
  return url;
}
