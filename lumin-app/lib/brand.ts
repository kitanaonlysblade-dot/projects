// The platform's name and logo, in one place.
//   Name: the NEXT_PUBLIC_APP_NAME variable (set it on the website service, then redeploy). Empty = "Lumin".
//   Logo: the file public/brand/logo.png. Replace that file with your own (square PNG, at least 192x192).
//   Dark theme logo: public/brand/logo-dark.png (a version that reads on a dark page; delete it to use logo.png there too).
import { COMPANY } from './company';

// If your logo picture already contains the name (the usual case for a wordmark), the app shows the picture alone
// where it would otherwise show logo + name. Set NEXT_PUBLIC_LOGO_HAS_NAME=false for a symbol-only logo.
export const BRAND = {
  name: COMPANY.name,
  logo: '/brand/logo.png',
  logoDark: '/brand/logo-dark.png',
  // The opening (loading) screen has its own pictures, so it can differ from the app logo:
  //   public/brand/splash.png       shown on the light theme
  //   public/brand/splash-dark.png  shown on the dark theme (delete it to use splash.png there too)
  // If a file is missing the screen falls back to splash.png, then to logo.png.
  splash: '/brand/splash.png',
  splashDark: '/brand/splash-dark.png',
  logoHasName: process.env.NEXT_PUBLIC_LOGO_HAS_NAME !== 'false',
};
