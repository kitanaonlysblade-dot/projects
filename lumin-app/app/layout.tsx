import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'LUMIN',
  description: 'Social e-commerce, shoppable video',
};

// viewportFit: 'cover' lets the page draw under the iPhone notch/home
// indicator and Android's gesture bar instead of leaving a plain white
// strip there — paired with .app-shell's 100dvh (see globals.css), the
// video frame now sizes itself to the real, currently-visible screen on
// both platforms rather than an idealized "no browser chrome" one.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
