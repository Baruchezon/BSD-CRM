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
  const targetUrl = data.url || 'tasks.html';
  const options = {
    body: data.body || '',
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    dir: 'rtl',
    lang: 'he',
    tag: data.tag || undefined, // same tag replaces the previous nudnik notification instead of stacking
    renotify: kind === 'nudnik',
    data: { url: targetUrl }
  };
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
        clientList.forEach(client => client.postMessage({ type: 'BSD_PUSH_SOUND', kind, url: targetUrl }));
      })
    ])
  );
});

// 08.09.2026: reworked to actually satisfy "if BSD CRM is already open in a tab,
// bring it to the front and open the task there instead of a new tab" - the old
// version only reused a tab if its URL happened to ALREADY be targetUrl exactly,
// so a tab open on any other BSD CRM page (the common case) always opened a brand
// new tab instead of being reused/navigated. Now: (1) exact-URL tab -> focus it;
// (2) any other BSD-CRM tab -> navigate it to targetUrl, then focus it;
// (3) nothing open -> new window. Wrapped so a failure at one step still falls
// through to opening a new window rather than silently doing nothing (this is the
// most likely explanation for "sometimes I can't open it" - the old code had no
// fallback if focus()/openWindow() rejected).
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || 'tasks.html';

  async function handleClick() {
    const windowClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

    // 1) A tab already sitting on this exact task-alert URL -> just focus it.
    for (const client of windowClients) {
      if (client.url.includes(targetUrl) && 'focus' in client) {
        try { return await client.focus(); } catch (e) { /* fall through */ }
      }
    }

    // 2) Any other BSD CRM tab already open -> navigate it to the task, then focus.
    for (const client of windowClients) {
      if ('focus' in client) {
        try {
          if ('navigate' in client) await client.navigate(targetUrl);
          return await client.focus();
        } catch (e) { /* this client failed to navigate/focus - try the next one, or fall through to a new window */ }
      }
    }

    // 3) Nothing usable was open -> open a fresh tab/window on the task.
    if (self.clients.openWindow) {
      try { return await self.clients.openWindow(targetUrl); } catch (e) { /* nothing more we can do */ }
    }
  }

  event.waitUntil(handleClick());
});
