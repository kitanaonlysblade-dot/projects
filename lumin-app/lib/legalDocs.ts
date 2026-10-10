import { COMPANY } from './company';

export type LegalDocId = 'about' | 'help' | 'guidelines' | 'terms' | 'privacy';

export interface LegalSection {
  title: string;
  // Plain text; blank lines separate paragraphs and lines starting with "• " render as a list.
  body: string;
}

export interface LegalDoc {
  title: string;
  intro?: string;
  sections: LegalSection[];
}

const app = COMPANY.name;
const who = COMPANY.legalName ? `${COMPANY.legalName} (“${app}”, “we”, “us”)` : `${app} (“we”, “us”)`;
const contactLine = COMPANY.supportEmail
  ? `You can reach us at ${COMPANY.supportEmail}.`
  : 'You can reach us through the Help & contact page in the app.';
const addressLine = COMPANY.address ? `\n\nOur address: ${COMPANY.address}.` : '';
// On the Help page itself: only say how to reach us when we actually have a way to (a page
// that says "reach us through this page" would send people in a circle).
const helpContact = COMPANY.supportEmail ? ` You can reach us at ${COMPANY.supportEmail}.` : '';

// DRAFT copy, written from what the app actually does, not reviewed by a lawyer. Review it
// (and fill in lib/company.ts) before launch, and update COMPANY.lastUpdated when it changes.
export const LEGAL_DOCS: Record<LegalDocId, LegalDoc> = {
  about: {
    title: `About ${app}`,
    sections: [
      {
        title: `What ${app} is`,
        body: `${app} is a video shopping app. Watch short videos from sellers and creators, tap a product you like, and buy it without leaving the video.`,
      },
      {
        title: 'Two feeds, two jobs',
        body: 'The Shop feed is for shopping: videos with products you can open, add to your cart and buy. Discover is for entertainment: videos from creators picked around your interests.',
      },
      {
        title: 'For sellers and creators',
        body: 'Create a business page, list your products, and post videos that show them. You can mark the moments in a video where each product appears, so viewers can find it while they watch.',
      },
      {
        title: 'Buying with confidence',
        body: 'Payments are handled by Paystack. If something goes wrong with an order, you can open a dispute and our team reviews it.',
      },
      { title: 'Get in touch', body: contactLine + addressLine },
    ],
  },

  help: {
    title: 'Help & contact',
    sections: [
      {
        title: 'My order',
        body: 'Open My orders from your profile to see where an order is. If something is wrong with it, open a dispute from the order and our team will review it.',
      },
      {
        title: 'Report a video, comment or person',
        body: 'Tap the “…” menu on a video, or on a profile, and choose Report. Reports are reviewed by our team.',
      },
      {
        title: 'Sign-in problems',
        body: 'On the log in screen, choose “Forgot password” and we will help you reset it.',
      },
      {
        title: 'Account and privacy requests',
        body: 'To ask for a copy of your data, to correct it, or to ask us to delete your account, contact us.' + helpContact,
      },
      ...(COMPANY.supportEmail || COMPANY.address
        ? [{ title: 'Contact us', body: (COMPANY.supportEmail ? `Email: ${COMPANY.supportEmail}` : '') + addressLine.replace(/^\n\n/, COMPANY.supportEmail ? '\n\n' : '') }]
        : []),
    ],
  },

  guidelines: {
    title: 'Community guidelines',
    intro: `${app} works because people can trust what they see. These rules apply to everything you post: videos, comments, product listings and messages.`,
    sections: [
      {
        title: 'Keep it legal and safe',
        body: '• No illegal content or illegal products.\n• No sexual content involving anyone under 18. We remove it and report it.\n• No threats, violence, or content that encourages self-harm.',
      },
      {
        title: 'Be respectful',
        body: '• No harassment, bullying or hate toward people because of who they are.\n• Don’t share other people’s private information.',
      },
      {
        title: 'Be honest about what you sell',
        body: '• Show and describe products as they really are, and send what you showed.\n• No counterfeits, scams or misleading claims.\n• Only post videos and products you have the right to use.',
      },
      {
        title: 'What happens when something breaks the rules',
        body: 'Anyone can report content. Our team reviews reports and may remove content, limit an account, or suspend it. If your content or account is affected, you can appeal the decision from the app.',
      },
    ],
  },

  terms: {
    title: 'Terms and Conditions',
    sections: [
      {
        title: '1. Acceptance of terms',
        body: `By creating an account, you agree to these Terms and Conditions and to our Privacy Policy. These terms are between you and ${who}. If you do not agree, please do not create an account or use the app.`,
      },
      {
        title: '2. Your account',
        body: "You're responsible for the activity on your account and for keeping your password secure. You must provide accurate information when signing up, and you must be old enough to use the app under the laws that apply to you.",
      },
      {
        title: '3. Content you post',
        body: 'You keep ownership of the videos, photos, comments, and other content you post. By posting, you give us permission to host, display, and distribute that content within the app so other people can see it. You promise you have the right to post it.',
      },
      {
        title: '4. Buying and selling',
        body: 'Purchases made through the app are between you and the merchant selling the product. Prices, shipping, and return policies are set by each merchant. We handle payment processing but are not the seller of record. If there is a problem with an order, you can open a dispute and we will review it.',
      },
      {
        title: '5. Acceptable use',
        body: "Don't use the app to post illegal content, harass other people, infringe on someone else's rights, or interfere with how the app works. Our Community guidelines explain the rules in more detail. We can remove content or suspend accounts that break these rules.",
      },
      {
        title: '6. Termination',
        body: 'You can ask us to delete your account at any time by contacting us. We can suspend or terminate accounts that violate these terms or that we reasonably believe put other users or the platform at risk.',
      },
      {
        title: '7. Disclaimers',
        body: 'The app is provided “as is.” We don’t guarantee it will always be available, error-free, or uninterrupted.',
      },
      {
        title: '8. Changes to these terms',
        body: "We may update these terms from time to time. If we make material changes, we'll let you know before they take effect.",
      },
      { title: '9. Contact', body: 'Questions about these terms: ' + contactLine + addressLine },
    ],
  },

  privacy: {
    title: 'Privacy Policy',
    intro: `This policy explains what ${who} collects when you use ${app}, why, and the choices you have.`,
    sections: [
      {
        title: 'Information you give us',
        body: '• Account details: your name, email or username, and a password (stored in protected form, not as readable text).\n• Profile details you choose to add, such as a photo, bio, birthday and delivery address.\n• What you post: videos, comments, likes, follows and your watchlist.\n• Orders: what you buy, delivery details and payment status.\n• Reports, disputes and messages you send us.',
      },
      {
        title: 'Information we collect as you use the app',
        body: '• Which videos you watch and how much of them, so we can count views and show you content you are more likely to enjoy.\n• Basic technical data such as your IP address and device or browser type, used to keep the app secure and working.',
      },
      {
        title: 'How we use it',
        body: '• To run the app: your account, feeds, cart and orders.\n• To process payments and deliveries.\n• To show you relevant videos and products.\n• To keep the community safe: reviewing reports, preventing fraud and abuse.\n• To send you notifications you have asked for, such as order updates and replies.\n• To meet our legal obligations.',
      },
      {
        title: 'Who we share it with',
        body: '• Sellers: when you buy, the seller receives what they need to fulfil your order, such as your name, delivery address and the items.\n• Payment processor: payments are handled by Paystack under its own privacy policy.\n• Sign-in: if you sign in with Google, Google shares your name and email with us.\n• Service providers who host the app and store videos for us.\n• Authorities, when the law requires it or to protect people from harm.',
      },
      {
        title: 'What other people can see',
        body: 'Your profile, videos and comments are visible to other people in the app. In Settings you can hide your followers and following lists and hide mutual followers. Your delivery address and birthday are not shown publicly.',
      },
      {
        title: 'Your choices and rights',
        body: 'You can change your profile and settings in the app. To ask for a copy of your data, to correct it, or to have your account deleted, contact us. ' + contactLine,
      },
      {
        title: 'How long we keep it',
        body: 'We keep your information while your account is active. Some records, such as orders, payments and reports, may be kept longer where we need them for legal, safety or accounting reasons.',
      },
      {
        title: 'Children',
        body: `${app} is not intended for children below the minimum age allowed by law where they live. If you think a child has created an account, contact us and we will act on it.`,
      },
      {
        title: 'Changes to this policy',
        body: 'If we make important changes we will let you know in the app before they take effect.',
      },
      { title: 'Contact', body: contactLine + addressLine },
    ],
  },
};
