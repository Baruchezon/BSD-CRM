// BSD CRM - Service Worker for Push Notifications
// Receives push events from the server (Supabase Edge Function task-reminders) and shows
// an OS-level notification even if the app/tab isn't open.
//
// 21.10.2026 - cross-device sync:
//  - push {type:'close', tag}: the task was handled on some device -> close every notification
//    with that tag here too (getNotifications({tag})) and tell open tabs to drop their in-app card.
//  - task notifications carry two buttons (browsers show at most ~2): "✅ בוצע" and "🔕 השתק".
//    They act straight from here via the per-tag token in the payload (no login needed) and the
//    server then closes the notification on all the other devices.
//  - closing a task notification (✕ / swipe) counts as "close": the server stops the repeats
//    and closes it on the other devices. The full set of options is on task-alert.html.
//  - click: focus the tab FIRST (focus() is only allowed while the click is fresh), then navigate,
//    and always use an absolute URL. Fixes "sometimes it doesn't open".

const SW_VERSION = '20261021-1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

function absUrl(u) { try { return new URL(u || 'tasks.html', self.registration.scope).href; } catch (e) { return self.registration.scope; } }

async function closeTag(tag) {
  if (!tag) return;
  const list = await self.registration.getNotifications({ tag });
  list.forEach(n => n.close());
}

async function tellClients(msg) {
  const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  clientList.forEach(c => { try { c.postMessage(msg); } catch (e) {} });
}

async function serverAction(d, action) {
  if (!d || !d.api || !d.taskId || !d.token || !d.userId) return false;
  try {
    const r = await fetch(d.api, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'action', task_id: d.taskId, action, user_id: d.userId, token: d.token })
    });
    return r.ok;
  } catch (e) { return false; }
}

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch (e) { data = { title: 'BSD CRM', body: event.data ? event.data.text() : '' }; }

  if (data.type === 'close') {
    event.waitUntil((async () => {
      // show-then-close with the same tag: a push must show something (Chrome/Safari rules),
      // and replacing by tag means the old reminder is gone even if close() races.
      try {
        await self.registration.showNotification(data.title || 'BSD CRM', {
          body: data.body || '✓ טופל', tag: data.tag, silent: true, renotify: false,
          icon: 'icon-192.png', badge: 'icon-192.png', dir: 'rtl', lang: 'he', data: { closing: true }
        });
      } catch (e) {}
      await closeTag(data.tag);
      await tellClients({ type: 'BSD_PUSH_CLOSE', tag: data.tag, taskId: data.taskId || null });
    })());
    return;
  }

  const title = data.title || 'BSD CRM';
  const kind = data.kind === 'nudnik' ? 'nudnik' : 'morning'; // 'morning' = date-only digest, 'nudnik' = date+time task (repeats)
  const targetUrl = absUrl(data.url || 'tasks.html');
  const isTask = !!(data.taskId && data.token);
  const options = {
    body: data.body || '',
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    dir: 'rtl',
    lang: 'he',
    tag: data.tag || undefined, // same tag replaces the previous nudge instead of stacking
    renotify: kind === 'nudnik',
    requireInteraction: kind === 'nudnik',
    actions: isTask ? [{ action: 'done', title: '✅ בוצע' }, { action: 'mute', title: '🔕 השתק' }] : [],
    data: { url: targetUrl, tag: data.tag || null, taskId: data.taskId || null, userId: data.userId || null, token: data.token || null, api: data.api || null }
  };
  event.waitUntil(Promise.all([
    self.registration.showNotification(title, options),
    tellClients({ type: 'BSD_PUSH_SOUND', kind, url: targetUrl, title, body: options.body, tag: data.tag || null, taskId: data.taskId || null })
  ]));
});

async function openUrl(targetUrl) {
  const windowClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  // 1) a tab already on this exact URL -> focus it
  for (const c of windowClients) {
    if (c.url === targetUrl && 'focus' in c) { try { return await c.focus(); } catch (e) {} }
  }
  // 2) any other BSD CRM tab -> focus first (needs the fresh click), then navigate
  for (const c of windowClients) {
    if (!('focus' in c)) continue;
    try {
      const focused = await c.focus();
      if ('navigate' in c) { try { const nav = await (focused || c).navigate(targetUrl); if (nav) return nav; } catch (e) {} }
      (focused || c).postMessage({ type: 'BSD_OPEN_URL', url: targetUrl }); // uncontrolled tab: let the page navigate itself
      return focused;
    } catch (e) { /* try next */ }
  }
  // 3) nothing open -> new window
  if (self.clients.openWindow) { try { return await self.clients.openWindow(targetUrl); } catch (e) {} }
}

self.addEventListener('notificationclick', event => {
  const n = event.notification;
  const d = n.data || {};
  n.close();
  if (d.closing) return;
  if (event.action === 'done' || event.action === 'mute') {
    event.waitUntil((async () => {
      const ok = await serverAction(d, event.action);
      await tellClients({ type: 'BSD_PUSH_CLOSE', tag: d.tag, taskId: d.taskId });
      if (!ok) await openUrl(absUrl(d.url)); // could not save -> open the task so nothing is lost
    })());
    return;
  }
  // body click: open the task alert (it marks the task as seen and closes it on the other devices)
  event.waitUntil(openUrl(absUrl(d.url)));
});

self.addEventListener('notificationclose', event => {
  const d = event.notification.data || {};
  if (d.closing || !d.taskId) return;
  // ✕ / swipe away on this device = "close": stop the repeats and close it everywhere else
  event.waitUntil(serverAction(d, 'close'));
});
