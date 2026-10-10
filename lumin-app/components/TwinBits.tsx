'use client';

import { Copy } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ApiProduct } from '@/lib/api';
import { MATCH_LABEL, type TwinMatch } from '@/lib/wanted';

// The twin icon: two overlapping squares. Used for the count on a tile, "Twin it" and the
// compare list's title, so it only has to be learnt once.
export function TwinIcon({ size = 14, className = '' }: { size?: number; className?: string }) {
  return <Copy size={size} strokeWidth={2.4} className={className} aria-hidden="true" />;
}

type Tone = 'green' | 'amber' | 'gray' | 'blue' | 'pink';

const TONE: Record<Tone, string> = {
  green: 'bg-emerald-50 text-emerald-700',
  amber: 'bg-amber-50 text-amber-700',
  gray: 'bg-box text-text',
  blue: 'bg-indigo-50 text-indigo-700',
  pink: 'bg-hot-pink/10 text-hot-pink',
};

export function Tag({ tone = 'gray', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-bold ${TONE[tone]}`}>
      {children}
    </span>
  );
}

const MATCH_TONE: Record<TwinMatch, Tone> = { strong: 'green', good: 'gray', partial: 'amber', weak: 'amber' };

export function MatchTag({ match }: { match: TwinMatch }) {
  return <Tag tone={MATCH_TONE[match]}>{MATCH_LABEL[match]}</Tag>;
}

export function firstImage(p: ApiProduct): string | undefined {
  return [...p.images].sort((a, b) => a.position - b.position)[0]?.url;
}

export function ProductThumb({ product, size = 56 }: { product: ApiProduct; size?: number }) {
  const src = firstImage(product);
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" style={{ width: size, height: size }} className="shrink-0 rounded-xl bg-box object-cover" />
  ) : (
    <span style={{ width: size, height: size }} className="shrink-0 rounded-xl bg-box" aria-hidden="true" />
  );
}

export const money = (price: string | number) => {
  const n = typeof price === 'number' ? price : parseFloat(price);
  return Number.isFinite(n) ? `$${n.toFixed(2).replace(/\.00$/, '')}` : '';
};

// A creator's round avatar, or their initial when they have none.
export function Avatar({ url, name, size = 24 }: { url?: string | null; name: string; size?: number }) {
  const style = { width: size, height: size };
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" style={style} className="shrink-0 rounded-full border-[1.5px] border-white bg-box object-cover" />
  ) : (
    <span
      style={{ ...style, fontSize: size * 0.45 }}
      className="brand-gradient flex shrink-0 items-center justify-center rounded-full border-[1.5px] border-white font-extrabold text-white"
      aria-hidden="true"
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

// The first few twins as overlapping round photos: a tile that shows which products fit
// the moment, at a glance, with nothing to read.
export function PhotoStack({ urls, size = 20 }: { urls: string[]; size?: number }) {
  return (
    <span className="flex shrink-0 items-center" aria-hidden="true">
      {urls.slice(0, 3).map((u, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={u + i}
          src={u}
          alt=""
          style={{ width: size, height: size, marginLeft: i === 0 ? 0 : -size * 0.35, zIndex: 3 - i }}
          className="relative rounded-full border-[1.5px] border-white bg-box object-cover"
        />
      ))}
    </span>
  );
}
