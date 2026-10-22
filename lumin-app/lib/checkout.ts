// One door to the card form of whichever gateway the backend says is live (it answers /payments/initialize with `provider`).
import type { ApiPaymentInit } from './api';
import { openPaystackCheckout } from './paystack';
import { openStripeCheckout } from './stripe';

export function openCheckout(init: ApiPaymentInit): Promise<void> {
  if (init.provider === 'stripe') {
    if (!init.client_secret) return Promise.reject(new Error('Payment could not be started'));
    return openStripeCheckout({
      publicKey: init.public_key,
      clientSecret: init.client_secret,
      amountSubunit: init.amount_subunit,
      currency: init.currency,
    });
  }
  return openPaystackCheckout({
    publicKey: init.public_key,
    email: init.email,
    amountSubunit: init.amount_subunit,
    currency: init.currency,
    reference: init.reference,
  });
}
