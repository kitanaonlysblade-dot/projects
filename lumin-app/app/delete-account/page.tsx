import Link from 'next/link';
import { COMPANY } from '@/lib/company';

// A plain public page (no sign-in, no app state) that says how to delete an account and what
// happens to the data. Google Play asks for a web link like this in addition to the in-app
// option; point the store listing's "delete account" URL at /delete-account.
export const metadata = { title: `Delete your ${COMPANY.name} account` };

export default function DeleteAccountInfoPage() {
  return (
    <main className="mx-auto w-full max-w-2xl bg-white px-5 py-10 text-text">
      <h1 className="text-[22px] font-bold">Delete your {COMPANY.name} account</h1>

      <h2 className="mt-6 text-[15px] font-bold">In the app</h2>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-[14px] leading-relaxed text-text-mute">
        <li>Open {COMPANY.name} and sign in.</li>
        <li>Go to your profile and open Settings.</li>
        <li>Under Account, tap Delete account.</li>
        <li>Type DELETE (and your password) to confirm.</li>
      </ol>

      <h2 className="mt-6 text-[15px] font-bold">What is deleted</h2>
      <p className="mt-2 text-[14px] leading-relaxed text-text-mute">
        Your profile and login, your videos and comments, your followers, likes, watchlist and cart, your saved address and
        notifications, and, if you sell, your store and its products.
      </p>

      <h2 className="mt-6 text-[15px] font-bold">What is kept</h2>
      <p className="mt-2 text-[14px] leading-relaxed text-text-mute">
        Order and payment records, which other people and our accounting rely on. They are no longer linked to you and the
        delivery address on them is removed. Reports and moderation records are kept without your name.
      </p>

      <h2 className="mt-6 text-[15px] font-bold">If you can&apos;t sign in</h2>
      <p className="mt-2 text-[14px] leading-relaxed text-text-mute">
        {COMPANY.supportEmail
          ? `Email ${COMPANY.supportEmail} from the address on your account and ask us to delete it.`
          : 'Contact us from the address on your account and ask us to delete it.'}{' '}
        We may need to confirm it&apos;s you first. An account can&apos;t be deleted while an order or payment is still in
        progress.
      </p>

      <p className="mt-8 text-[13px]">
        <Link href="/" className="font-bold text-hot-pink underline">
          Back to {COMPANY.name}
        </Link>
      </p>
    </main>
  );
}
