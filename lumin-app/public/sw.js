// Lumin service worker: only job is to receive things shared TO Lumin from Android's share sheet.
// A shared video arrives as a POST; we keep the file for a moment and send the person to /share to scan it.
const CACHE = 'lumin-share';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'POST' || url.pathname !== '/share-target') return;
  event.respondWith(
    (async () => {
      try {
        const form = await event.request.formData();
        const params = new URLSearchParams();
        for (const k of ['title', 'text', 'url']) {
          const v = form.get(k);
          if (typeof v === 'string' && v) params.set(k, v);
        }
        const file = form.get('video');
        if (file && typeof file !== 'string' && file.size > 0) {
          const cache = await caches.open(CACHE);
          await cache.put('/shared-video', new Response(file, { headers: { 'Content-Type': file.type || 'video/mp4' } }));
          params.set('file', '1');
        }
        return Response.redirect('/share?' + params.toString(), 303);
      } catch (err) {
        return Response.redirect('/share', 303);
      }
    })()
  );
});

// ---- Push notifications (backend: app/push.py) ----
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (err) {
    data = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Lumin', {
      body: data.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: data.tag || undefined,
      data: { url: data.url || '/' },
    })
  );
});

// Tapping it: focus Lumin if it is open (and send it to the right place), otherwise open it.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const w of windows) {
        if (new URL(w.url).origin === self.location.origin && 'navigate' in w) {
          await w.navigate(target);
          return w.focus();
        }
      }
      return self.clients.openWindow(target);
    })()
  );
});
