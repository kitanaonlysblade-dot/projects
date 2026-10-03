'use client';

import { PageHeader } from './PageHeader';

interface TermsScreenProps {
  onBack: () => void;
}

// Reached by tapping "Terms and Conditions" on CreateAccountScreen's
// agreement checkbox (see that component's own comment on the gating).
// Placeholder copy — standard sections for a video/shopping app, not
// reviewed by legal. Swap in the real document whenever it's ready;
// nothing else in the app reads this text or depends on its content.
export function TermsScreen({ onBack }: TermsScreenProps) {
  return (
    <div className="flex h-full flex-col bg-panel">
      <PageHeader title="Terms and Conditions" onBack={onBack} backLabel="Back to sign up" />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl px-4 py-6 lg:px-0 lg:py-10">
          <p className="mb-6 text-[12.5px] text-text-mute">Last updated: placeholder</p>

          {SECTIONS.map((section) => (
            <div key={section.title} className="mb-5">
              <p className="mb-1.5 text-[13px] font-bold text-text">{section.title}</p>
              <p className="text-[13.5px] leading-relaxed text-text-mute">{section.body}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const SECTIONS: { title: string; body: string }[] = [
  {
    title: '1. Acceptance of terms',
    body: 'By creating an account, you agree to these Terms and Conditions and to our Privacy Policy. If you do not agree, please do not create an account or use the app.',
  },
  {
    title: '2. Your account',
    body: "You're responsible for the activity on your account and for keeping your password secure. You must provide accurate information when signing up, and you must be old enough to use the app under the laws that apply to you.",
  },
  {
    title: '3. Content you post',
    body: 'You keep ownership of the videos, photos, comments, and other content you post. By posting, you give us permission to host, display, and distribute that content within the app so other people can see it. You\u2019re responsible for making sure you have the rights to anything you post.',
  },
  {
    title: '4. Buying and selling',
    body: 'Purchases made through the app are between you and the merchant selling the product. Prices, shipping, and return policies are set by each merchant. We handle payment processing but are not the seller of record for merchant products.',
  },
  {
    title: '5. Acceptable use',
    body: "Don't use the app to post illegal content, harass other people, infringe on someone else's rights, or interfere with how the app works. We can remove content or suspend accounts that break these rules.",
  },
  {
    title: '6. Termination',
    body: 'You can delete your account at any time. We can suspend or terminate accounts that violate these terms or that we reasonably believe put other users or the platform at risk.',
  },
  {
    title: '7. Disclaimers',
    body: 'The app is provided "as is." We don\u2019t guarantee it will always be available, error-free, or uninterrupted.',
  },
  {
    title: '8. Changes to these terms',
    body: "We may update these terms from time to time. If we make material changes, we'll let you know before they take effect.",
  },
  {
    title: '9. Contact',
    body: 'Questions about these terms can be sent to the support email listed in the app.',
  },
];
