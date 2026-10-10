'use client';

import { COMPANY } from '@/lib/company';
import { LEGAL_DOCS, type LegalDocId } from '@/lib/legalDocs';
import { PageHeader } from './PageHeader';

// One screen for every "about the company" page (About, Help & contact, Community
// guidelines, Terms, Privacy Policy), reached from Settings > Support & About and, for the
// terms and privacy policy, from the sign-up agreement. The words live in lib/legalDocs.ts
// and the company details in lib/company.ts; this just lays them out.
export function LegalScreen({ doc, onBack, backLabel = 'Back' }: { doc: LegalDocId; onBack: () => void; backLabel?: string }) {
  const d = LEGAL_DOCS[doc];
  return (
    <div className="flex h-full flex-col bg-panel">
      <PageHeader title={d.title} onBack={onBack} backLabel={backLabel} />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl px-4 py-6 lg:px-0 lg:py-10">
          {COMPANY.lastUpdated && <p className="mb-4 text-[12.5px] text-text-mute">Last updated: {COMPANY.lastUpdated}</p>}
          {d.intro && <p className="mb-6 text-[13.5px] leading-relaxed text-text-mute">{d.intro}</p>}
          {d.sections.map((section) => (
            <div key={section.title} className="mb-5">
              <p className="mb-1.5 text-[13px] font-bold text-text">{section.title}</p>
              <p className="whitespace-pre-line text-[13.5px] leading-relaxed text-text-mute">{section.body}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
