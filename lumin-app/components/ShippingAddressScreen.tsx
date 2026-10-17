'use client';

import { useState } from 'react';
import type { ShippingAddress } from '@/lib/types';
import { PageHeader } from './PageHeader';

interface ShippingAddressScreenProps {
  address?: ShippingAddress;
  onBack: () => void;
  // Returns the promise (not swallowed) so this screen can show its own
  // inline error and stay put on failure — same "a form someone
  // explicitly submitted needs to visibly succeed or fail, not silently
  // revert" reasoning as ProfileScreen's Edit profile form. The caller
  // (page.tsx) decides what happens next on success — navigating back,
  // or resuming a checkout that was waiting on this — not this screen.
  onSave: (address: ShippingAddress) => Promise<void>;
}

const REQUIRED_FIELDS: { key: keyof ShippingAddress; label: string }[] = [
  { key: 'recipientName', label: 'Recipient name' },
  { key: 'phone', label: 'Phone number' },
  { key: 'line1', label: 'Address' },
  { key: 'city', label: 'City' },
  { key: 'country', label: 'Country' },
];

// One saved address per account, not an address book — matches the
// backend (ShippingAddressMixin's own comment explains why: nothing in
// this app needs more than one). Filling this in and saving is also
// exactly what a checkout does the first time someone pays with no
// address on file yet — see page.tsx's pendingCheckout handling, which
// is what routes here mid-checkout and resumes automatically on success.
export function ShippingAddressScreen({ address, onBack, onSave }: ShippingAddressScreenProps) {
  const [form, setForm] = useState<ShippingAddress>(
    address ?? {
      recipientName: '',
      phone: '',
      line1: '',
      line2: '',
      city: '',
      state: '',
      postalCode: '',
      country: '',
    },
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (key: keyof ShippingAddress) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const missing = REQUIRED_FIELDS.filter(({ key }) => !form[key]?.trim());

  const handleSave = () => {
    if (missing.length > 0) {
      setError(`${missing.map((f) => f.label).join(', ')} — required.`);
      return;
    }
    setSaving(true);
    setError(null);
    onSave(form)
      .catch(() => setError("Couldn't save — check your connection and try again."))
      .finally(() => setSaving(false));
  };

  const inputClass =
    'w-full rounded-lg border border-line bg-white px-3 py-2 text-[13px] text-text focus:border-hot-pink focus:outline-none disabled:opacity-60';
  const labelClass = 'mb-1 block text-[12.5px] font-bold text-text-mute';

  return (
    <div className="flex h-full flex-col bg-panel">
      <PageHeader title="Shipping address" onBack={onBack} backLabel="Back" />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-md flex-col gap-3 px-4 py-4 lg:px-0 lg:py-6">
          <div>
            <label className={labelClass}>Recipient name</label>
            <input
              type="text"
              value={form.recipientName}
              onChange={set('recipientName')}
              disabled={saving}
              className={inputClass}
              placeholder="Who's this for?"
            />
          </div>
          <div>
            <label className={labelClass}>Phone number</label>
            <input
              type="tel"
              value={form.phone}
              onChange={set('phone')}
              disabled={saving}
              className={inputClass}
              placeholder="For the courier to reach you"
            />
          </div>
          <div>
            <label className={labelClass}>Address</label>
            <input
              type="text"
              value={form.line1}
              onChange={set('line1')}
              disabled={saving}
              className={inputClass}
              placeholder="Street address"
            />
          </div>
          <div>
            <label className={labelClass}>Apartment, suite, etc. (optional)</label>
            <input
              type="text"
              value={form.line2 ?? ''}
              onChange={set('line2')}
              disabled={saving}
              className={inputClass}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>City</label>
              <input type="text" value={form.city} onChange={set('city')} disabled={saving} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>State / province (optional)</label>
              <input
                type="text"
                value={form.state ?? ''}
                onChange={set('state')}
                disabled={saving}
                className={inputClass}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Postal code (optional)</label>
              <input
                type="text"
                value={form.postalCode ?? ''}
                onChange={set('postalCode')}
                disabled={saving}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Country</label>
              <input
                type="text"
                value={form.country}
                onChange={set('country')}
                disabled={saving}
                className={inputClass}
              />
            </div>
          </div>

          {error && <p className="text-[12.5px] font-medium text-hot-pink">{error}</p>}

          <button
            onClick={handleSave}
            disabled={saving}
            className="brand-gradient mt-1 w-full rounded-full py-2.5 text-[13px] font-bold text-white disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save address'}
          </button>
        </div>
      </div>
    </div>
  );
}
