// Sign in with Apple, website + iPhone app. Apple requires it whenever an app offers Google sign-in.
//  - iPhone app: the native "SignInWithApple" plugin (@capacitor-community/apple-sign-in) shows Apple's own sheet.
//  - Website: Apple's JS library opens Apple's popup.
//  - Android app: not offered (Apple's popup doesn't work reliably in the Android web view).
import { isNativeApp, nativePlatform } from './native';

export interface AppleResult {
  idToken: string;
  nonce: string;
  name?: string;
}

const WEB_CLIENT_ID = process.env.NEXT_PUBLIC_APPLE_CLIENT_ID ?? ''; // the "Services ID"
const NATIVE_CLIENT_ID = process.env.NEXT_PUBLIC_APPLE_NATIVE_CLIENT_ID ?? ''; // the iPhone app's bundle id

export type AppleMode = 'native' | 'web' | null;

export function appleMode(): AppleMode {
  if (isNativeApp()) {
    return nativePlatform() === 'ios' && NATIVE_CLIENT_ID && nativeApplePlugin() ? 'native' : null;
  }
  return WEB_CLIENT_ID ? 'web' : null;
}

export function randomNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function joinName(first?: string | null, last?: string | null): string | undefined {
  const n = [first, last].map((x) => (x ?? '').trim()).filter(Boolean).join(' ');
  return n || undefined;
}

/** True when the person closed Apple's sheet or popup themselves: not an error worth showing. */
export function wasCancelled(err: unknown): boolean {
  const e = err as { error?: string; code?: string | number; message?: string } | null;
  const text = `${e?.error ?? ''} ${e?.code ?? ''} ${e?.message ?? ''}`.toLowerCase();
  return /popup_closed|user_cancelled_authorize|cancel|1001/.test(text);
}

interface NativeApple {
  authorize(opts: { clientId: string; redirectURI: string; scopes: string; nonce: string }): Promise<{
    response: { identityToken: string; givenName?: string | null; familyName?: string | null };
  }>;
}

function nativeApplePlugin(): NativeApple | null {
  const caps = (window as unknown as { Capacitor?: { Plugins?: Record<string, unknown> } }).Capacitor;
  return (caps?.Plugins?.SignInWithApple as NativeApple | undefined) ?? null;
}

interface AppleJs {
  auth: {
    init(cfg: { clientId: string; scope: string; redirectURI: string; usePopup: boolean; nonce: string }): void;
    signIn(): Promise<{ authorization: { id_token: string }; user?: { name?: { firstName?: string; lastName?: string } } }>;
  };
}

let scriptPromise: Promise<void> | null = null;
function loadAppleScript(): Promise<void> {
  if ((window as unknown as { AppleID?: AppleJs }).AppleID) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      scriptPromise = null;
      reject(new Error('Could not load Sign in with Apple'));
    };
    document.body.appendChild(s);
  });
  return scriptPromise;
}

export async function signInWithApple(): Promise<AppleResult> {
  const mode = appleMode();
  const nonce = randomNonce();
  if (mode === 'native') {
    const r = await nativeApplePlugin()!.authorize({ clientId: NATIVE_CLIENT_ID, redirectURI: '', scopes: 'email name', nonce });
    return { idToken: r.response.identityToken, nonce, name: joinName(r.response.givenName, r.response.familyName) };
  }
  if (mode === 'web') {
    await loadAppleScript();
    const apple = (window as unknown as { AppleID: AppleJs }).AppleID;
    apple.auth.init({ clientId: WEB_CLIENT_ID, scope: 'name email', redirectURI: window.location.origin, usePopup: true, nonce });
    const r = await apple.auth.signIn();
    return { idToken: r.authorization.id_token, nonce, name: joinName(r.user?.name?.firstName, r.user?.name?.lastName) };
  }
  throw new Error('Sign in with Apple is not available here.');
}
