'use client';

import { useEffect, useRef, useState } from 'react';

// Thin wrapper around Google Identity Services (GIS) — the current
// "Sign in with Google" library, loaded lazily (only once someone
// actually reaches a screen with this button, not on every page load)
// and cached the same way lib/paystack.ts caches its own script tag.
//
// Renders Google's own button rather than the app's previous hand-drawn
// SVG one: GIS's basic ID-token flow (what backs both this and
// auth.py's POST /auth/google) only ships a verified identity through
// Google's own rendered button or One Tap — there's no supported way to
// wire a fully custom button to a guaranteed popup without moving to
// the heavier OAuth code-exchange flow, which needs a client secret and
// a token-exchange step this app doesn't otherwise have a reason to
// carry. `theme`/`shape` below get it as close to this app's pill
// buttons as Google's customization options allow.

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential: string }) => void;
          }) => void;
          renderButton: (
            parent: HTMLElement,
            options: {
              type: 'standard';
              theme: 'outline';
              size: 'large';
              shape: 'pill';
              text: 'continue_with';
              width: number;
            },
          ) => void;
        };
      };
    };
  }
}

let scriptPromise: Promise<void> | null = null;

function loadGoogleScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('No window'));
  if (window.google?.accounts?.id) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptPromise = null;
      reject(new Error('Could not load Google Sign-In'));
    };
    document.body.appendChild(script);
  });
  return scriptPromise;
}

interface GoogleSignInButtonProps {
  // The verified ID token — hand this straight to lib/api.ts's
  // googleAuth(); this component doesn't call it itself, so
  // CreateAccountScreen and LoginScreen can each wire their own
  // existing error-handling/navigation around the same button.
  onCredential: (idToken: string) => void;
  onError?: () => void;
}

export function GoogleSignInButton({ onCredential, onError }: GoogleSignInButtonProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    if (!clientId) {
      // Not configured in this environment (see README's "Google
      // sign-in" section) — fail quietly into a disabled state rather
      // than crash the whole auth screen over one missing button.
      setUnavailable(true);
      return;
    }

    let cancelled = false;
    loadGoogleScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.google) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (response) => onCredential(response.credential),
        });
        window.google.accounts.id.renderButton(containerRef.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          shape: 'pill',
          text: 'continue_with',
          width: 336,
        });
      })
      .catch(() => {
        if (!cancelled) {
          setUnavailable(true);
          onError?.();
        }
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onCredential/onError are event handlers, not reactive inputs; re-running this would re-init Google's SDK on every render.
  }, []);

  if (unavailable) return null;

  return <div ref={containerRef} className="mb-5 flex w-full justify-center" />;
}
