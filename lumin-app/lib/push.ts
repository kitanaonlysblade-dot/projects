// Push notifications in the browser (Web Push). The backend side is lumin-backend/app/push.py.
// State machine for the Settings toggle: 'unsupported' (this browser can't), 'unavailable' (server not set up),
// 'blocked' (the person denied permission in the browser), 'on', 'off'.
import { getPushConfig, pushDeviceRegister, pushDeviceRemove, pushSubscribe, pushUnsubscribe } from './api';
import { isNativeApp, nativePlatform, nativePush, safeAppPath } from './native';

export type PushState = 'unsupported' | 'unavailable' | 'blocked' | 'on' | 'off';

export function pushSupported(): boolean {
  if (isNativeApp()) return nativePush() !== null;
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

// The server's public key is URL-safe base64; the browser wants raw bytes.
export function urlBase64ToBytes(value: string): Uint8Array {
  const padded = value + '='.repeat((4 - (value.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.ready;
}

const TOKEN_KEY = 'lumin_native_push_token';
const readToken = (): string | null => {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};
const writeToken = (t: string | null) => {
  try {
    if (t) window.localStorage.setItem(TOKEN_KEY, t);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable: the toggle just shows off next time */
  }
};

// Native app: ask the phone for permission, get its Firebase token, hand it to the backend.
async function enableNative(): Promise<PushState> {
  const config = await getPushConfig();
  const plugin = nativePush();
  const platform = nativePlatform();
  if (!config.native || !plugin || !platform) return 'unavailable';
  let perm = await plugin.checkPermissions();
  if (perm.receive !== 'granted') perm = await plugin.requestPermissions();
  if (perm.receive !== 'granted') return perm.receive === 'denied' ? 'blocked' : 'off';
  const token = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The phone did not return a push token.')), 15000);
    void plugin.addListener('registration', (t: { value: string }) => {
      clearTimeout(timer);
      resolve(t.value);
    });
    void plugin.addListener('registrationError', () => {
      clearTimeout(timer);
      reject(new Error('Could not register for notifications.'));
    });
    void plugin.register();
  });
  await pushDeviceRegister({ token, platform });
  writeToken(token);
  return 'on';
}

async function disableNative(): Promise<PushState> {
  const token = readToken();
  if (token) {
    const platform = nativePlatform();
    if (platform) await pushDeviceRemove({ token, platform }).catch(() => {});
    writeToken(null);
  }
  return 'off';
}

// Tapping a notification while the app is installed: open the screen it points at. Called once at start-up.
export function listenForNativeTaps(): void {
  const plugin = isNativeApp() ? nativePush() : null;
  if (!plugin) return;
  void plugin.addListener('pushNotificationActionPerformed', (event: { notification?: { data?: { url?: string } } }) => {
    const path = safeAppPath(event?.notification?.data?.url);
    if (path) window.location.assign(path);
  });
}

export async function getPushState(): Promise<PushState> {
  if (isNativeApp()) {
    const plugin = nativePush();
    if (!plugin) return 'unsupported';
    try {
      const config = await getPushConfig();
      if (!config.native) return 'unavailable';
      const perm = await plugin.checkPermissions();
      if (perm.receive === 'denied') return 'blocked';
      return perm.receive === 'granted' && readToken() ? 'on' : 'off';
    } catch {
      return 'unavailable';
    }
  }
  if (!pushSupported()) return 'unsupported';
  try {
    const config = await getPushConfig();
    if (!config.enabled || !config.public_key) return 'unavailable';
  } catch {
    return 'unavailable';
  }
  if (Notification.permission === 'denied') return 'blocked';
  const sub = await (await registration()).pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

export async function enablePush(): Promise<PushState> {
  if (isNativeApp()) return enableNative();
  const config = await getPushConfig();
  if (!config.enabled || !config.public_key) return 'unavailable';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'blocked' : 'off';
  const reg = await registration();
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToBytes(config.public_key) as BufferSource,
    }));
  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) throw new Error('This browser gave an incomplete push address.');
  await pushSubscribe({ endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } });
  return 'on';
}

export async function disablePush(): Promise<PushState> {
  if (isNativeApp()) return disableNative();
  const sub = await (await registration()).pushManager.getSubscription();
  if (sub) {
    await pushUnsubscribe(sub.endpoint).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
  return 'off';
}

// On log out: stop this browser receiving the previous person's notifications. Only the browser side is dropped; the
// server forgets the device the first time a push to it is refused (app/push.py), and re-registers it on the next
// sign-in anyway.
export function detachOnLogout(): void {
  if (isNativeApp()) {
    // The backend moves a phone to whoever signs in next; drop our record so the toggle reads off for them.
    writeToken(null);
    return;
  }
  if (!pushSupported()) return;
  navigator.serviceWorker.ready
    .then((reg) => reg.pushManager.getSubscription())
    .then((sub) => sub?.unsubscribe())
    .catch(() => {});
}
