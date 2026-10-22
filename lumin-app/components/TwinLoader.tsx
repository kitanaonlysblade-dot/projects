// Lumin's loading mark: two orbs (the twins) circle, merge into one glow, then split again.
// `size` is in pixels. Decorative: wrap it in something with role="status" when it stands for a wait.
export function TwinLoader({ size = 44, className = '' }: { size?: number; className?: string }) {
  return (
    <span className={`twin-loader ${className}`} style={{ ['--s' as string]: `${size}px` }} aria-hidden="true">
      <i />
      <i />
    </span>
  );
}

// The usual "something is loading" block: the mark and a short label.
export function Loading({ label = 'Loading…', className = '' }: { label?: string; className?: string }) {
  return (
    <div role="status" aria-live="polite" className={`flex flex-col items-center justify-center gap-3 py-10 ${className}`}>
      <TwinLoader size={36} />
      <p className="text-[13px] text-text-mute">{label}</p>
    </div>
  );
}

// The scan sheet while it is looking: the twin mark in the middle with rings spreading outward (Shazam-style).
export function ScanPulse({ label, sub }: { label: string; sub?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col items-center py-4">
      <div className="scan-pulse" aria-hidden="true">
        <b />
        <b />
        <b />
        <TwinLoader size={64} />
      </div>
      <p className="-mt-2 text-[14px] font-bold text-text">{label}</p>
      {sub && <p className="mt-0.5 text-center text-[12px] text-text-mute">{sub}</p>}
    </div>
  );
}
