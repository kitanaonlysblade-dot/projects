'use client';

import { useState } from 'react';
import type { Interest } from '@/lib/types';

interface DiscoverOnboardingProps {
  open: boolean;
  // Lifted to page.tsx and passed down — see that fetch's own comment for
  // why this used to be a duplicate fetch here.
  interests: Interest[];
  onDone: (selected: string[] | null) => void;
}

export function DiscoverOnboarding({ open, interests, onDone }: DiscoverOnboardingProps) {
  const [selected, setSelected] = useState<string[]>([]);

  if (!open) return null;

  const toggle = (id: string) => {
    setSelected((current) =>
      current.includes(id) ? current.filter((existing) => existing !== id) : [...current, id],
    );
  };

  return (
    <div className="fixed inset-0 z-[60] flex flex-col overflow-y-auto bg-white">
      <div className="mx-auto flex w-full max-w-[560px] flex-1 flex-col px-6 py-10 sm:py-16">
        <h1 className="text-2xl font-bold text-text sm:text-[28px]">
          What are you interested in?
        </h1>
        <p className="mt-2 text-sm text-text-mute">
          Pick a few topics to personalize your Discover feed. Skip anytime —
          we&apos;ll just show you everything.
        </p>

        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {interests.map((interest) => {
            const isSelected = selected.includes(interest.id);
            return (
              <button
                key={interest.id}
                onClick={() => toggle(interest.id)}
                aria-pressed={isSelected}
                className={`flex items-center gap-2 rounded-full border px-4 py-2.5 text-left text-[13px] font-medium transition-colors ${
                  isSelected
                    ? 'brand-gradient border-transparent text-white'
                    : 'border-line text-text hover:border-hot-pink/40'
                }`}
              >
                <span className="text-base leading-none">{interest.emoji}</span>
                {interest.label}
              </button>
            );
          })}
        </div>

        <div className="mt-auto flex items-center gap-3 pt-10">
          <button
            onClick={() => onDone(null)}
            className="flex-1 rounded-full bg-panel py-3 text-[13px] font-bold text-text-mute"
          >
            Skip
          </button>
          <button
            onClick={() => onDone(selected)}
            className="brand-gradient flex-1 rounded-full py-3 text-[13px] font-bold text-white"
          >
            {selected.length > 0 ? `Continue (${selected.length})` : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  );
}
