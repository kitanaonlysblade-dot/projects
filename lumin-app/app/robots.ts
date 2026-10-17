import type { MetadataRoute } from 'next';

// The public pages (privacy, terms, ...) may be indexed; the app itself and scan result pages should not be.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: '*', allow: ['/privacy', '/terms', '/guidelines', '/help', '/about', '/delete-account'], disallow: ['/v/', '/scan', '/share', '/reset-password'] },
    ],
  };
}
