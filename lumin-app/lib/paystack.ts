// Thin wrapper around Paystack Inline (https://paystack.com/docs/payments/accept-payments/).
// Loaded lazily — the script tag only gets added the first time someone
// actually opens a payment popup, not on every page load — and cached so
// a second payment later in the same session doesn't fetch it again.

declare global {
  interface Window {
    PaystackPop?: new () => {
      newTransaction: (options: {
        key: string;
        email: string;
        amount: number;
        currency: string;
        reference: string;
        channels: string[];
        onSuccess: () => void;
        onCancel: () => void;
      }) => void;
    };
  }
}

let scriptPromise: Promise<void> | null = null;

function loadPaystackScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('No window'));
  if (window.PaystackPop) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://js.paystack.co/v2/inline.js';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      // Let a later call try again instead of being stuck rejected
      // forever off one flaky load.
      scriptPromise = null;
      reject(new Error('Could not load Paystack'));
    };
    document.body.appendChild(script);
  });
  return scriptPromise;
}

export interface PaystackChargeParams {
  publicKey: string;
  email: string;
  amountSubunit: number;
  currency: string;
  reference: string;
  // Optional override — omit to get card + bank transfer (see
  // DEFAULT_CHANNELS below).
  channels?: string[];
}

// Opens Paystack's payment popup for a reference the backend already
// created via /payments/initialize, and resolves once the popup itself
// reports success — rejects if the person closes it instead. A resolved
// promise here is not proof of payment on its own (that's just this
// browser tab's own UI state); whatever calls this still needs to call
// verifyPayment() with the same reference right after, which is what
// actually re-checks the charge against Paystack's API and creates the
// order — see payments.py's own comment on why.
//
// `channels` is explicit rather than left for Paystack to default —
// leaving it unset falls back to whatever's toggled on in that Paystack
// account's own dashboard settings, which isn't something this codebase
// can see or guarantee. Card + bank transfer are the two this app asks
// for; USSD and mobile money aren't included here, but adding them is
// just adding to this array, not new integration work.
const DEFAULT_CHANNELS = ['card', 'bank_transfer'];

export function openPaystackCheckout(params: PaystackChargeParams): Promise<void> {
  return loadPaystackScript().then(
    () =>
      new Promise<void>((resolve, reject) => {
        if (!window.PaystackPop) {
          reject(new Error('Paystack failed to load'));
          return;
        }
        const popup = new window.PaystackPop();
        popup.newTransaction({
          key: params.publicKey,
          email: params.email,
          amount: params.amountSubunit,
          currency: params.currency,
          reference: params.reference,
          channels: params.channels ?? DEFAULT_CHANNELS,
          onSuccess: () => resolve(),
          onCancel: () => reject(new Error('Payment cancelled')),
        });
      }),
  );
}
