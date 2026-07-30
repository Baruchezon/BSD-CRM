// BSD CRM - Push notification subscription (client side)

const BSD_VAPID_PUBLIC_KEY = 'BKKuGWOeY3OCA3aMcyTCdLgX5x3j4qARJKzYHyhwy6RQx-n-zs3UI_Vu86MJGWIKkOet6VpV2-6mPlBCL7mqRKE';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

async function bsdEnablePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    alert('הדפדפן הזה לא תומך בהתראות Push.');
    return false;
  }

  const reg = await navigator.serviceWorker.register('sw.js');
  await navigator.serviceWorker.ready;

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    alert('לא אושרה הרשאה להתראות. אפשר להפעיל שוב מאוחר יותר דרך הגדרות האתר בדפדפן.');
    return false;
  }

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(BSD_VAPID_PUBLIC_KEY)
    });
  }

  const subJson = sub.toJSON();
  const { data: { user } } = await window.supabaseClient.auth.getUser();
  if (!user) return false;

  const { error } = await window.supabaseClient.from('push_subscriptions').upsert({
    user_id: user.id,
    endpoint: subJson.endpoint,
    p256dh: subJson.keys.p256dh,
    auth: subJson.keys.auth
  }, { onConflict: 'endpoint' });

  if (error) { console.error('push subscribe save error', error); return false; }

  localStorage.setItem('bsd_push_enabled', '1');
  return true;
}

function bsdRefreshPushBellLabel() {
  const btn = document.getElementById('pushBellBtn');
  if (!btn) return;
  const enabled = (typeof Notification !== 'undefined') &&
    Notification.permission === 'granted' &&
    localStorage.getItem('bsd_push_enabled') === '1';
  btn.textContent = enabled ? '🔔 התראות פעילות' : '🔕 הפעל התראות';
  btn.title = enabled ? 'התראות Push פעילות במכשיר הזה' : 'לחץ כדי לקבל התראות על משימות גם כשהמערכת סגורה';
}

function bsdInitPushBell() {
  const btn = document.getElementById('pushBellBtn');
  if (!btn || typeof Notification === 'undefined') { if (btn) btn.style.display = 'none'; return; }

  bsdRefreshPushBellLabel();

  btn.addEventListener('click', async () => {
    if (Notification.permission === 'denied') {
      alert('ההתראות חסומות בדפדפן הזה. כדי להפעיל, יש לאשר התראות דרך הגדרות האתר בדפדפן (סמל המנעול ליד שורת הכתובת).');
      return;
    }
    const ok = await bsdEnablePush();
    bsdRefreshPushBellLabel();
    if (ok) {
      btn.textContent = '✅ הופעל!';
      setTimeout(bsdRefreshPushBellLabel, 2500);
    }
  });
}

document.addEventListener('DOMContentLoaded', bsdInitPushBell);
