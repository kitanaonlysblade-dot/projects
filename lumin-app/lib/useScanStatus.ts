import { useEffect, useState } from 'react';

// What the scan says while it works, so it never looks stuck. Driven by elapsed time (the check has no
// real progress to report), kept short and calm: a handful of phrases, the last one repeats.
const STEPS: Array<[number, string]> = [
  [0, 'Looking…'],
  [5, 'Widening the search…'],
  [14, 'Looking closer at the details…'],
  [24, 'Still working — this one takes a little longer'],
  [40, 'Nearly there…'],
];

export function scanStatusAt(seconds: number, steps: Array<[number, string]> = STEPS): string {
  let text = steps[0][1];
  for (const [from, t] of steps) if (seconds >= from) text = t;
  return text;
}

export function useScanStatus(active: boolean): string {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!active) {
      setSeconds(0);
      return;
    }
    const started = Date.now();
    const id = setInterval(() => setSeconds((Date.now() - started) / 1000), 500);
    return () => clearInterval(id);
  }, [active]);
  return scanStatusAt(seconds);
}
