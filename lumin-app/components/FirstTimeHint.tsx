'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { hintSeen, markHintSeen, type HintId } from '@/lib/hints';

// A small dismissible line shown once per device. Renders nothing on the
// server and until storage has been checked, so it never flashes for
// people who've already seen it.
export function FirstTimeHint({ id, emoji, children, className = '' }: { id: HintId; emoji: string; children: ReactNode; className?: string }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    setShow(!hintSeen(id));
  }, [id]);
  if (!show) return null;
  const dismiss = () => {
    markHintSeen(id);
    setShow(false);
  };
  return (
    <div role="note" className={`flex items-start gap-2 rounded-xl bg-hot-pink/5 px-3 py-2 text-[12.5px] leading-snug text-text ${className}`}>
      <span aria-hidden className="text-[15px] leading-none">{emoji}</span>
      <span className="min-w-0 flex-1">{children}</span>
      <button onClick={dismiss} aria-label="Got it" className="shrink-0 rounded-full p-0.5 text-text-mute">
        <X size={14} />
      </button>
    </div>
  );
}
