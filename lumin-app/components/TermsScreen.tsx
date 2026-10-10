'use client';

import { LegalScreen } from './LegalScreen';

// Reached by tapping "Terms and Conditions" on CreateAccountScreen's agreement checkbox (see
// that component's own comment on the gating). The text itself now lives in lib/legalDocs.ts
// next to the other company pages so there is one place to edit it.
export function TermsScreen({ onBack }: { onBack: () => void }) {
  return <LegalScreen doc="terms" onBack={onBack} backLabel="Back to sign up" />;
}
