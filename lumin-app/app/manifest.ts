import { BRAND } from '@/lib/brand';
import type { MetadataRoute } from 'next';

// Installing Lumin to the home screen (Android Chrome: menu > Install app) adds it to the system share sheet,
// so a video can be shared straight to Lumin from any app. Shared files and links land on /share.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: BRAND.name,
    short_name: BRAND.name,
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#f5334a',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
    share_target: {
      action: '/share-target',
      method: 'post',
      enctype: 'multipart/form-data',
      params: {
        title: 'title',
        text: 'text',
        url: 'url',
        files: [{ name: 'video', accept: ['video/*'] }],
      },
    },
  } as unknown as MetadataRoute.Manifest;
}
