import { BRAND } from '@/lib/brand';
import { BadgeCheck, ShieldCheck } from 'lucide-react';

// "Verified original": Lumin fingerprinted this video and found no earlier copy by someone else. It says nothing
// about the product, only that this is the first time we have seen this footage.
export function VerifiedOriginalBadge({ className = '' }: { className?: string }) {
  return (
    <span
      title={`${BRAND.name} checked this video and found no earlier copy of it`}
      className={`inline-flex items-center gap-1 rounded-full bg-white/15 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white ${className}`}
    >
      <BadgeCheck size={12} aria-hidden="true" />
      Verified original
    </span>
  );
}

// "Verified seller": an admin checked this seller's identity documents.
export function VerifiedSellerBadge({ className = '' }: { className?: string }) {
  return (
    <span
      title={`${BRAND.name} checked this seller's identity`}
      className={`inline-flex items-center gap-1 rounded-full bg-white/15 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white ${className}`}
    >
      <ShieldCheck size={12} aria-hidden="true" />
      Verified seller
    </span>
  );
}
