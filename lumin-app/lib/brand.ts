// The platform's name and logo, in one place.
//   Name: the NEXT_PUBLIC_APP_NAME variable (set it on the website service, then redeploy). Empty = "Lumin".
//   Logo: the file public/brand/logo.png. Replace that file with your own (square PNG, at least 192x192).
import { COMPANY } from './company';

// If your logo picture already contains the name (the usual case for a wordmark), the app shows the picture alone
// where it would otherwise show logo + name. Set NEXT_PUBLIC_LOGO_HAS_NAME=false for a symbol-only logo.
export const BRAND = {
  name: COMPANY.name,
  logo: '/brand/logo.png',
  logoHasName: process.env.NEXT_PUBLIC_LOGO_HAS_NAME !== 'false',
};
