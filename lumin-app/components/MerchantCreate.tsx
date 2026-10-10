'use client';

import { useState } from 'react';
import { merchantCategories } from '@/lib/data';
import type { MerchantAccount } from '@/lib/types';
import { PageHeader } from './PageHeader';

interface MerchantCreateProps {
  onBack: () => void;
  onCreate: (account: MerchantAccount) => void;
}

// One merchant page per personal account for now (confirmed as the v1
// scope) — so this form only ever runs once per account; there's no
// "create another page" entry point anywhere else in the app.
export function MerchantCreate({ onBack, onCreate }: MerchantCreateProps) {
  const [businessName, setBusinessName] = useState('');
  const [category, setCategory] = useState(merchantCategories[0]);
  const [description, setDescription] = useState('');

  const canSubmit = businessName.trim().length > 0;

  const handleSubmit = () => {
    if (!canSubmit) return;
    onCreate({
      id: 'merchant-1',
      businessName: businessName.trim(),
      category,
      description: description.trim(),
      // Overwritten immediately by the real server response anyway
      // (handleCreateMerchant in page.tsx), but the type needs a value
      // here regardless — a brand new merchant account never starts
      // with payouts already set up.
      payoutReady: false,
    });
  };

  return (
    <div className="flex h-full flex-col bg-panel">
      <PageHeader title="Create a Page" onBack={onBack} backLabel="Back to profile" />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-md px-4 py-6 lg:px-0 lg:py-10">
          <p className="mb-1 text-[15px] font-bold text-text">Set up your business page</p>
          <p className="mb-6 text-[13.5px] leading-snug text-text-mute">
            This is the seller-facing side of your account — separate from your personal
            profile, the way a Facebook Page sits alongside a personal account. You can switch
            between the two any time.
          </p>

          <label className="mb-4 block">
            <span className="mb-1.5 block text-[12.5px] font-bold text-text">Business name</span>
            <input
              type="text"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              placeholder="e.g. Nadia's Vintage Finds"
              className="w-full rounded-lg border border-line bg-white px-3 py-2 text-[13px] text-text placeholder:text-text-mute focus:border-hot-pink focus:outline-none"
            />
          </label>

          <label className="mb-4 block">
            <span className="mb-1.5 block text-[12.5px] font-bold text-text">Category</span>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-lg border border-line bg-white px-3 py-2 text-[13px] text-text focus:border-hot-pink focus:outline-none"
            >
              {merchantCategories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>

          <label className="mb-6 block">
            <span className="mb-1.5 block text-[12.5px] font-bold text-text">
              Description <span className="font-normal text-text-mute">(optional)</span>
            </span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What do you sell?"
              rows={3}
              className="w-full resize-none rounded-lg border border-line bg-white px-3 py-2 text-[13px] text-text placeholder:text-text-mute focus:border-hot-pink focus:outline-none"
            />
          </label>

          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="brand-gradient w-full rounded-full py-2.5 text-[13px] font-bold text-white disabled:opacity-40"
          >
            Create page
          </button>
        </div>
      </div>
    </div>
  );
}
