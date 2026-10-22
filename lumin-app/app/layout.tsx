import { readFileSync } from 'fs';
import { join } from 'path';
import { BRAND } from '@/lib/brand';
import type { Metadata, Viewport } from 'next';
import './globals.css';
import { ServiceWorker } from '@/components/ServiceWorker';
import { NativeScanBridge } from '@/components/NativeScanBridge';
import { THEME_BOOT_SCRIPT } from '@/lib/theme';
import { AppSplash } from '@/components/AppSplash';
import { NetworkStatus } from '@/components/NetworkStatus';

export const metadata: Metadata = {
  title: BRAND.name,
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

// The opening screen's logos are read here and written straight into the page as data, so the picture is part of
// the very first paint instead of being fetched after the animation has already started.
function inlineImage(file: string): string | undefined {
  try {
    const buf = readFileSync(join(process.cwd(), 'public', 'brand', file));
    return `data:image/png;base64,${buf.toString('base64')}`;
  } catch {
    return undefined; // the screen then loads it by address
  }
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="theme-color" content="#ffffff" />
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="bg-surface font-sans text-text antialiased">
        <ServiceWorker />
        <NativeScanBridge />
        {children}
        <NetworkStatus />
        <AppSplash lightSrc={inlineImage('splash.png')} darkSrc={inlineImage('splash-dark.png') ?? inlineImage('splash.png')} />
      </body>
    </html>
  );
}
