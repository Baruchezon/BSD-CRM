// BSD CRM - Service Worker for Push Notifications
// Receives push events from the server (Supabase Edge Function) and shows
// an OS-level notification even if the app/tab isn't open.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch (e) { data = { title: 'BSD CRM', body: event.data ? event.data.text() : '' }; }

  const title = data.title || 'BSD CRM';
  const kind = data.kind === 'nudnik' ? 'nudnik' : 'morning'; // 'morning' = date-only task, 'nudnik' = date+time task (repeats)
  const options = {
    body: data.body || '',
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    dir: 'rtl',
    lang: 'he',
    tag: data.tag || undefined, // same tag replaces the previous nudnik notification instead of stacking
    renotify: kind === 'nudnik',
    data: { url: data.url || 'tasks.html' }
  };
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
        clientList.forEach(client => client.postMessage({ type: 'BSD_PUSH_SOUND', kind }));
      })
    ])
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || 'tasks.html';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (const client of windowClients) {
        if (client.url.includes(targetUrl) && 'focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
