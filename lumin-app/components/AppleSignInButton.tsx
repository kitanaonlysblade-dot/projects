'use client';

import { useEffect, useState } from 'react';
import { appleMode, signInWithApple, wasCancelled, type AppleResult } from '@/lib/appleSignIn';

// Black pill button following Apple's guidelines (Apple logo, "Continue with Apple", at least as prominent as the
// Google button). Hidden where Sign in with Apple isn't set up or can't work (the Android app).
export function AppleSignInButton({
  onResult,
  onError,
}: {
  onResult: (r: AppleResult) => void;
  onError?: (message: string) => void;
}) {
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);

  // Checked after mount: the native plugin only exists in the browser, so this can't run during server rendering.
  useEffect(() => setAvailable(appleMode() !== null), []);
  if (!available) return null;

  const click = async () => {
    setBusy(true);
    try {
      onResult(await signInWithApple());
    } catch (err) {
      if (!wasCancelled(err)) onError?.('Sign in with Apple didn’t work. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={click}
      disabled={busy}
      className="mb-5 flex h-10 w-full max-w-[336px] items-center justify-center gap-2 self-center rounded-full bg-black text-[14px] font-semibold text-white disabled:opacity-60"
      style={{ marginInline: 'auto' }}
    >
      <svg width="16" height="18" viewBox="0 0 16 18" fill="currentColor" aria-hidden="true">
        <path d="M13.3 9.5c0-2.2 1.8-3.2 1.9-3.3-1-1.5-2.6-1.7-3.2-1.7-1.4-.1-2.7.8-3.4.8-.7 0-1.8-.8-2.9-.8-1.5 0-2.9.9-3.7 2.2-1.6 2.7-.4 6.8 1.1 9 .8 1.1 1.7 2.3 2.9 2.3 1.1 0 1.6-.7 3-.7s1.8.7 3 .7c1.2 0 2-1.1 2.8-2.2.9-1.3 1.2-2.5 1.2-2.6-.1 0-2.6-1-2.7-3.7zM11 2.9c.6-.8 1.1-1.8.9-2.9-.9 0-2 .6-2.7 1.4-.6.700-1.1 1.8-1 2.8 1 .1 2.1-.5 2.8-1.3z" />
      </svg>
      {busy ? 'Opening Apple…' : 'Continue with Apple'}
    </button>
  );
}
