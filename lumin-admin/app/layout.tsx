import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Lumin Admin',
  description: 'Moderation, disputes, and analytics for the Lumin platform',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-panel font-sans text-text antialiased">{children}</body>
    </html>
  );
}
