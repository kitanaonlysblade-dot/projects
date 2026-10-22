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
        body: 'Payments are handled by Stripe. If something goes wrong with an order, you can open a dispute and our team reviews it.',
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
        title: 'About add-ons',
        body: 'Add-ons (shown as “Complete the look”, “Frequently bought with” or “Recommended add-on”) come from sellers who share a commission with ' + app + '. They are picked to go with what you are looking at, and the seller pays a commission only when you buy one. Nothing changes in the price you pay.',
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
        body: 'You can delete your account yourself in Settings, under Account > Delete account. You can download a copy of your data in Settings, under Account > Download my data. To correct it, contact us.' + helpContact,
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
        title: 'No nudity or graphic violence',
        body: '• No nude or sexually explicit content, and no graphic violence or gore.\n• Videos and photos are screened automatically and by our team. Content that may break these rules can be hidden while we check it, and removed if it does.\n• Repeated or serious breaches can lead to account suspension.',
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
        body: 'Anyone can report content. Our team reviews reports and may remove content, limit an account, or suspend it. If your content or account is affected, you can appeal the decision from the app. You can also block an account from its profile, so you and that account stop seeing each other’s videos, comments and products.',
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
        body: 'Purchases made through the app are between you and the merchant selling the product. Prices, shipping, and return policies are set by each merchant. We handle payment processing but are not the seller of record. If there is a problem with an order, you can open a dispute and we will review it.\n\nAdd-ons (shown as “Complete the look”, “Frequently bought with” or “Recommended add-on”) come from sellers who share a commission with ' + app + '. They are chosen to go with what you are viewing, and the commission is only paid when you buy one.',
      },
      {
        title: '5. Acceptable use',
        body: "Don't use the app to post illegal content, harass other people, infringe on someone else's rights, or interfere with how the app works. Our Community guidelines explain the rules in more detail. We can remove content or suspend accounts that break these rules.",
      },
      {
        title: '6. Termination',
        body: 'You can delete your account at any time in Settings, under Account > Delete account. We can suspend or terminate accounts that violate these terms or that we reasonably believe put other users or the platform at risk.',
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
        body: '• Account details: your name, email or username, and a password (stored in protected form, not as readable text). We email you a code to confirm your address when you sign up.\n• Profile details you choose to add, such as a photo, bio, birthday and delivery address.\n• What you post: videos, comments, likes, follows and your watchlist.\n• Orders: what you buy, delivery details and payment status.\n• Reports, disputes and messages you send us.\n• Seller verification: if you are a seller and choose to verify your store, the name, ID or business document photo and selfie you send. They are stored privately, seen only by our reviewers, and deleted as soon as we decide. We keep only the decision.\n• Push notifications: if you turn them on, an address for your device so we can send them; you can turn them off any time in Settings.',
      },
      {
        title: 'Information we collect as you use the app',
        body: '• Which videos you watch and how much of them, so we can count views and show you content you are more likely to enjoy.\n• Basic technical data such as your IP address and device or browser type, used to keep the app secure and working.\n• Video scans: if you use “scan a video”, when your device can, the recording is first turned into a small fingerprint on the device and only that is sent; if that finds no match, or your device can\'t do it, the recording or link you give us is then sent and analysed to find a matching video on ' + app + ' and is not kept afterwards. We keep a record that a scan happened (when, whether it found a match, and which account) so sellers can see how many people scanned their video.\n• Error reports: when the app breaks, technical details (not your messages or password) may be sent to our error-monitoring service.',
      },
      {
        title: 'How we use it',
        body: '• To run the app: your account, feeds, cart and orders.\n• To process payments and deliveries.\n• To show you relevant videos and products.\n• To keep the community safe: reviewing reports, preventing fraud and abuse.\n• To send you notifications you have asked for, such as order updates and replies.\n• To meet our legal obligations.',
      },
      {
        title: 'Who we share it with',
        body: '• Sellers: when you buy, the seller receives what they need to fulfil your order, such as your name, delivery address and the items.\n• Payment processor: payments are handled by Stripe under its own privacy policy. Sellers are paid out through Stripe too, and Stripe collects their identity and bank details itself.\n• Sign-in: if you sign in with Google or Apple, they share your name and email with us (Apple may give a private relay address instead of your real email).\n• Safety checks: to keep nudity and violence off Lumin, pictures and a few frames from uploaded videos are sent to an image-safety service, which returns a score and does not keep them for its own use under our agreement with it. Flagged items are reviewed by our team.\n• Service providers who host the app and store videos for us, send our emails (such as your sign-up confirmation code and order updates), and monitor errors.\n• Authorities, when the law requires it or to protect people from harm.',
      },
      {
        title: 'What other people can see',
        body: 'Your profile, videos and comments are visible to other people in the app. In Settings you can hide your followers and following lists and hide mutual followers. Your delivery address and birthday are not shown publicly.',
      },
      {
        title: 'Your choices and rights',
        body: 'You can change your profile and settings in the app, and delete your account yourself in Settings, under Account > Delete account. You can download a copy of your data in Settings, under Account > Download my data. To correct it, contact us. ' + contactLine,
      },
      {
        title: 'How long we keep it',
        body: 'We keep your information while your account is active. When you delete your account, your profile, videos, comments and similar content are deleted. Some records, such as orders, payments and reports, are kept without your name or address where we need them for legal, safety or accounting reasons.',
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
