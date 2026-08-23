// BSD CRM - task-reminders Edge Function
//
// Runs on a schedule (every minute, via pg_cron + pg_net — see the SQL migration
// file next to this one) and checks the `tasks` table for anything due.
//
// - Task has due_date only (no due_time)  -> included in ONE consolidated
//   digest push per user in the morning (between MORNING_HOUR:00 and
//   MORNING_HOUR:05 local time), sound "morning", showing today/overdue
//   counts and linking straight to tasks.html's "today" tab - never one push
//   per task.
// - Task has due_date AND due_time        -> sends a push at due_time, then
//   keeps repeating every NUDNIK_INTERVAL_MIN minutes ("nudnik" sound) until
//   the task is marked completed/read, up to NUDNIK_MAX_REPEATS times.
//   (unchanged from before - only the date-only morning path was consolidated)
//
// Requires these Edge Function secrets (set via `supabase secrets set`):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (auto-available in Supabase)
//   VAPID_PUBLIC_KEY   - must match js/push.js's BSD_VAPID_PUBLIC_KEY
//   VAPID_PRIVATE_KEY  - the matching private key (never put this in the repo)
//   VAPID_SUBJECT      - e.g. "mailto:baruch@bsd-bbi.co.il"

import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3';

const MORNING_HOUR = 8;                 // local hour tasks with date-only fire their reminder
const NUDNIK_INTERVAL_MIN = 10;         // minutes between repeat nudges once due_time has passed
const NUDNIK_MAX_REPEATS = 6;           // stop nagging after this many pushes (task likely stuck/forgotten -> still visible in tasks.html)
const TIMEZONE = 'Asia/Jerusalem';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

webpush.setVapidDetails(
  Deno.env.get('VAPID_SUBJECT') ?? 'mailto:baruch@bsd-bbi.co.il',
  Deno.env.get('VAPID_PUBLIC_KEY')!,
  Deno.env.get('VAPID_PRIVATE_KEY')!
);

function nowInTz(): Date {
  // current time expressed in Asia/Jerusalem, kept as a real Date for comparisons
  const s = new Date().toLocaleString('en-US', { timeZone: TIMEZONE });
  return new Date(s);
}

function todayISO(d: Date): string {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function sendToUser(userId: string, payload: Record<string, unknown>) {
  const { data: subs, error } = await supabase
    .from('push_subscriptions')
    .select('*')
    .eq('user_id', userId);
  if (error || !subs || subs.length === 0) return;

  for (const sub of subs) {
    const subscription = {
      endpoint: sub.endpoint,
      keys: { p256dh: sub.p256dh, auth: sub.auth }
    };
    try {
      await webpush.sendNotification(subscription, JSON.stringify(payload));
    } catch (err: any) {
      // 410/404 = subscription is gone (uninstalled, permission revoked, etc.) -> clean it up
      if (err?.statusCode === 410 || err?.statusCode === 404) {
        await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
      } else {
        console.error('push send failed for', userId, err?.statusCode, err?.body);
      }
    }
  }
}

Deno.serve(async () => {
  const now = nowInTz();
  const today = todayISO(now);
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const nowTime = `${hh}:${mm}:00`;

  let sentMorning = 0, sentNudnik = 0, morningTasksIncluded = 0;

  // ---- 1) Date-only tasks due today OR still open from a past date (never disappear) ----
  // ONE consolidated digest push per user (not one push per task) showing how
  // many are due today vs. overdue, clicking opens tasks.html straight on the
  // "today" tab. Per-task last_notified_at is still the dedupe key (a task
  // already included in today's digest is skipped), so re-running this
  // function within the same morning window never double-notifies.
  if (now.getHours() === MORNING_HOUR && now.getMinutes() < 5) {
    const { data: morningTasks } = await supabase
      .from('tasks')
      .select('id, title, assigned_to, due_date, due_time, status, last_notified_at')
      .lte('due_date', today)
      .is('due_time', null)
      .eq('status', 'פתוחה');

    const byUser: Record<string, { todayCount: number; overdueCount: number; taskIds: string[] }> = {};
    for (const t of morningTasks ?? []) {
      const lastNotified = t.last_notified_at ? todayISO(new Date(t.last_notified_at)) : null;
      if (lastNotified === today) continue; // already included in today's digest - never re-notify same task same day
      if (!t.assigned_to) continue;
      const bucket = byUser[t.assigned_to] ?? (byUser[t.assigned_to] = { todayCount: 0, overdueCount: 0, taskIds: [] });
      if (t.due_date === today) bucket.todayCount++; else bucket.overdueCount++;
      bucket.taskIds.push(t.id);
    }

    for (const [userId, info] of Object.entries(byUser)) {
      const total = info.todayCount + info.overdueCount;
      const parts: string[] = [];
      if (info.todayCount) parts.push(`היום: ${info.todayCount}`);
      if (info.overdueCount) parts.push(`באיחור: ${info.overdueCount}`);

      await sendToUser(userId, {
        title: `📋 ${total} משימות ממתינות`,
        body: parts.join(' · '),
        kind: 'morning',
        url: `tasks.html?tab=today`,
        tag: `bsd-morning-digest-${userId}` // one tag per user -> a second run in the same window replaces rather than stacks
      });
      await supabase.from('tasks').update({ last_notified_at: new Date().toISOString() }).in('id', info.taskIds);
      sentMorning++;
      morningTasksIncluded += total;
    }
  }

  // ---- 2) Date+time tasks: due today or overdue from a past date, due_time has passed, still open, repeat until max ----
  const { data: nudnikTasks } = await supabase
    .from('tasks')
    .select('id, title, assigned_to, due_date, due_time, status, last_notified_at, notify_count')
    .lte('due_date', today)
    .not('due_time', 'is', null)
    .eq('status', 'פתוחה')
    .lte('due_time', nowTime)
    .lt('notify_count', NUDNIK_MAX_REPEATS);

  for (const t of nudnikTasks ?? []) {
    if (!t.assigned_to) continue;
    const last = t.last_notified_at ? new Date(t.last_notified_at).getTime() : 0;
    const minutesSince = (Date.now() - last) / 60000;
    if (last !== 0 && minutesSince < NUDNIK_INTERVAL_MIN) continue; // too soon since last nudge

    await sendToUser(t.assigned_to, {
      title: '⏰ תזכורת: משימה ממתינה',
      body: t.title,
      kind: 'nudnik',
      url: `task-alert.html?id=${t.id}&kind=nudnik`,
      tag: `bsd-task-${t.id}` // same tag = replaces the previous nudge instead of piling up
    });
    await supabase.from('tasks').update({
      last_notified_at: new Date().toISOString(),
      notify_count: (t.notify_count ?? 0) + 1
    }).eq('id', t.id);
    sentNudnik++;
  }

  return new Response(JSON.stringify({ ok: true, sentMorning, sentNudnik, morningTasksIncluded }), {
    headers: { 'Content-Type': 'application/json' }
  });
});
