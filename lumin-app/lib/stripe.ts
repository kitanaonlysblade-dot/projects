// Stripe's card form (the "Payment Element") in a bottom sheet, for a payment the backend already created via
// /payments/initialize (it hands back a `client_secret`). Card details go straight from this form to Stripe: our server and
// this code never see them. Stripe.js is loaded from js.stripe.com the first time someone pays (Stripe requires that: it must
// not be bundled), and cached after.
//
// Like the old Paystack popup, resolving here is NOT proof of payment (it is just this browser's view): whatever calls it must
// then call /payments/verify with the same reference, which re-checks with Stripe and creates the order.
//
// Built with plain DOM and inline styles (the Tailwind scan only covers app/ and components/), using the app's CSS colour
// variables so it follows light/dark mode.

interface StripeElement {
  mount: (el: HTMLElement) => void;
  unmount: () => void;
  destroy: () => void;
}
interface StripeInstance {
  elements: (o: { clientSecret: string; appearance?: Record<string, unknown> }) => { create: (t: 'payment') => StripeElement };
  confirmPayment: (o: {
    elements: unknown;
    redirect: 'if_required';
    confirmParams?: Record<string, unknown>;
  }) => Promise<{ error?: { message?: string }; paymentIntent?: { status: string } }>;
}
declare global {
  interface Window {
    Stripe?: (publicKey: string) => StripeInstance;
  }
}

let scriptPromise: Promise<void> | null = null;

function loadStripeScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('No window'));
  if (window.Stripe) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://js.stripe.com/v3/';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptPromise = null; // let a later tap try again
      reject(new Error('Could not load the payment form. Check your connection and try again.'));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export interface StripeChargeParams {
  publicKey: string;
  clientSecret: string;
  amountSubunit: number;
  currency: string;
}

const css = (el: HTMLElement, styles: Partial<CSSStyleDeclaration>) => Object.assign(el.style, styles);

export function openStripeCheckout(params: StripeChargeParams): Promise<void> {
  return loadStripeScript().then(
    () =>
      new Promise<void>((resolve, reject) => {
        if (!window.Stripe) {
          reject(new Error('The payment form failed to load'));
          return;
        }
        const stripe = window.Stripe(params.publicKey);
        const dark = document.documentElement.classList.contains('dark');
        const elements = stripe.elements({
          clientSecret: params.clientSecret,
          appearance: { theme: dark ? 'night' : 'stripe', variables: { borderRadius: '10px' } },
        });
        const card = elements.create('payment');

        const overlay = document.createElement('div');
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-label', 'Pay');
        css(overlay, { position: 'fixed', inset: '0', zIndex: '100', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', background: 'rgba(0,0,0,0.55)' });

        const sheet = document.createElement('div');
        css(sheet, {
          width: '100%', maxWidth: '480px', maxHeight: '92vh', overflowY: 'auto', boxSizing: 'border-box', padding: '18px 16px 22px',
          background: 'rgb(var(--c-surface))', color: 'rgb(var(--c-text))', borderRadius: '24px 24px 0 0',
        });
        sheet.addEventListener('click', (e) => e.stopPropagation());

        const title = document.createElement('p');
        title.textContent = `Pay ${(params.amountSubunit / 100).toFixed(2)} ${params.currency.toUpperCase()}`;
        css(title, { margin: '0 0 12px', fontSize: '17px', fontWeight: '800' });

        const mount = document.createElement('div');
        const error = document.createElement('p');
        css(error, { margin: '10px 0 0', minHeight: '18px', fontSize: '13px', color: 'rgb(var(--c-sale))' });
        error.setAttribute('role', 'alert');

        const pay = document.createElement('button');
        pay.type = 'button';
        pay.textContent = 'Pay now';
        css(pay, {
          width: '100%', marginTop: '12px', padding: '13px', border: '0', borderRadius: '12px', color: '#fff', fontSize: '15px',
          fontWeight: '700', cursor: 'pointer', background: 'linear-gradient(135deg,#ff5a8a,#c026d3)',
        });
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.textContent = 'Cancel';
        css(cancel, { width: '100%', marginTop: '6px', padding: '10px', border: '0', background: 'transparent', color: 'rgb(var(--c-mute))', fontSize: '13px', cursor: 'pointer' });

        sheet.append(title, mount, error, pay, cancel);
        overlay.appendChild(sheet);
        document.body.appendChild(overlay);
        card.mount(mount);

        let busy = false;
        const close = () => {
          try {
            card.destroy();
          } catch {
            /* already gone */
          }
          overlay.remove();
        };
        const abort = () => {
          if (busy) return; // never walk away from a payment that is being confirmed
          close();
          reject(new Error('Payment cancelled'));
        };
        overlay.addEventListener('click', abort);
        cancel.addEventListener('click', abort);

        pay.addEventListener('click', async () => {
          if (busy) return;
          busy = true;
          pay.disabled = true;
          pay.textContent = 'Paying…';
          error.textContent = '';
          try {
            const res = await stripe.confirmPayment({ elements, redirect: 'if_required' });
            if (res.error) {
              error.textContent = res.error.message ?? 'That payment did not go through. Try another card.';
            } else if (res.paymentIntent && ['succeeded', 'processing', 'requires_capture'].includes(res.paymentIntent.status)) {
              close();
              resolve();
              return;
            } else {
              error.textContent = 'That payment did not go through. Try again.';
            }
          } catch {
            error.textContent = 'Could not reach the payment service. Try again.';
          }
          busy = false;
          pay.disabled = false;
          pay.textContent = 'Pay now';
        });
      }),
  );
}
