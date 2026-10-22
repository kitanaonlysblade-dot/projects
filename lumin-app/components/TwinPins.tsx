import { Check } from 'lucide-react';
import { TWIN_ENABLED } from '@/lib/features';
import { twinPins } from '@/lib/twins';
import type { Twin } from '@/lib/types';

// Pins on the video's timeline at each twinned moment: a pink stretch of the track and a
// pin-head at its start, with a check once the twin has been approved. A viewer watching
// the pins light up as the video plays learns what a Twin is without being told. Purely
// visual (pointer-events off); sits inside the progress track's positioned container.
export function TwinPins({ twins, durationMs }: { twins?: Twin[]; durationMs: number }) {
  if (!TWIN_ENABLED) return null; // part of the twin discovery layer (lib/features.ts)
  const pins = twinPins(twins, durationMs);
  if (pins.length === 0) return null;
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0">
      {pins.map((p) => (
        <span key={p.id}>
          <span
            className="absolute top-0 h-[3px] bg-hot-pink"
            style={{ left: `${p.leftPct}%`, width: `${p.widthPct}%` }}
          />
          <span
            className="absolute -top-[3px] flex h-[9px] w-[9px] -translate-x-1/2 items-center justify-center rounded-full bg-hot-pink ring-1 ring-white"
            style={{ left: `${p.leftPct}%` }}
          >
            {p.approved && <Check size={6} strokeWidth={4} className="text-white" />}
          </span>
        </span>
      ))}
    </div>
  );
}
