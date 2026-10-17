import Link from 'next/link';
import { COMPANY } from '@/lib/company';
import { LEGAL_DOCS, type LegalDocId } from '@/lib/legalDocs';

const LINKS: { id: LegalDocId; href: string; label: string }[] = [
  { id: 'terms', href: '/terms', label: 'Terms' },
  { id: 'privacy', href: '/privacy', label: 'Privacy' },
  { id: 'guidelines', href: '/guidelines', label: 'Community guidelines' },
  { id: 'help', href: '/help', label: 'Help' },
  { id: 'about', href: '/about', label: 'About' },
];

// The same words as the in-app screens (lib/legalDocs.ts), as plain public web pages with stable addresses:
// the app stores ask for a web link to the privacy policy (and Google Play for account deletion, see
// /delete-account). No sign-in, no app state, rendered on the server so it also works without JavaScript.
export function PublicLegal({ doc }: { doc: LegalDocId }) {
  const d = LEGAL_DOCS[doc];
  return (
    <main className="mx-auto w-full max-w-2xl bg-white px-5 py-10 text-text">
      <p className="mb-1 text-[13px] font-bold text-hot-pink">{COMPANY.name}</p>
      <h1 className="text-[24px] font-bold">{d.title}</h1>
      {COMPANY.lastUpdated && <p className="mt-1 text-[12.5px] text-text-mute">Last updated: {COMPANY.lastUpdated}</p>}
      {d.intro && <p className="mt-5 text-[14px] leading-relaxed text-text-mute">{d.intro}</p>}
      {d.sections.map((section) => (
        <section key={section.title} className="mt-6">
          <h2 className="mb-1.5 text-[15px] font-bold">{section.title}</h2>
          <p className="whitespace-pre-line text-[14px] leading-relaxed text-text-mute">{section.body}</p>
        </section>
      ))}
      <nav aria-label="Legal pages" className="mt-10 flex flex-wrap gap-x-4 gap-y-2 border-t border-line pt-5 text-[13px]">
        {LINKS.filter((l) => l.id !== doc).map((l) => (
          <Link key={l.id} href={l.href} className="font-bold text-hot-pink underline">
            {l.label}
          </Link>
        ))}
        <Link href="/delete-account" className="font-bold text-hot-pink underline">
          Delete your account
        </Link>
        <Link href="/" className="font-bold text-text underline">
          Back to {COMPANY.name}
        </Link>
      </nav>
    </main>
  );
}
