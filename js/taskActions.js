// BSD CRM - shared task actions
//
// postponeTaskToTomorrow(): the single implementation of "דחה למחר", used by
// both tasks.html (row menu) and task-alert.html (notification card), so the
// two pages can never drift out of sync on what "postpone" actually does.
//
// Behavior (per spec, confirmed 22.08.2026):
//  - Updates the SAME task row - never creates a new task, never leaves a
//    copy on the original day.
//  - due_time carries over UNCHANGED if the task had one; a date-only task
//    stays date-only (keeps showing in the 08:00 digest).
//  - "tomorrow" is always relative to today's real date - even an already-
//    overdue task jumps to tomorrow from now, not to (old due_date + 1).
//  - last_notified_at/notify_count reset so tomorrow's reminder cycle starts
//    fresh instead of the engine thinking "already notified" from before.
//  - read_at reset too (30.08.2026): read_at is the new field "קראתי, הפסק
//    התראה" sets to silence a reminder; if it stayed set across a postpone,
//    tomorrow's reminder would silently never fire even though
//    notify_count/last_notified_at were reset - this keeps the two in sync.
//  - status is left untouched (still 'פתוחה') - postponing is not a status,
//    per his explicit instruction not to introduce a "נדחה" status.

function bsdTomorrowISO(){
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,'0'), day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}

async function postponeTaskToTomorrow(supabaseClient, taskId){
  const newDueDate = bsdTomorrowISO();
  const { error } = await supabaseClient.from('tasks').update({
    due_date: newDueDate,
    last_notified_at: null,
    notify_count: 0,
    read_at: null
  }).eq('id', taskId);
  return { error, newDueDate };
}

// ---------------------------------------------------------------------------
// 21.10.2026 - bsdTaskReminderAction(): the single path for every reminder action
// (open / close / mute / done / postpone / delete / sync). It goes through the
// task-reminders Edge Function, which saves the action on the server AND sends a
// "close" push (same tag) to every device of the user, so the notification
// disappears from the PC, tablet and phone together. If the function can't be
// reached, it falls back to a direct DB update; the DB trigger then queues the
// close and the next cron run (<= 1 minute) closes it on the other devices.
// Returns { error } like the supabase calls.
async function bsdTaskReminderAction(supabaseClient, taskId, action, extra){
  extra = extra || {};
  try {
    const { data, error } = await supabaseClient.functions.invoke('task-reminders', {
      body: Object.assign({ op: 'action', task_id: taskId, action: action }, extra)
    });
    if (!error && data && data.ok) { bsdCloseLocalTaskNotifications(taskId); return { error: null }; }
    if (data && data.error && /forbidden|bad /.test(data.error)) return { error: { message: data.error } };
  } catch (e) { /* fall back below */ }
  const nowIso = new Date().toISOString();
  let res;
  if (action === 'open' || action === 'close') res = await supabaseClient.from('tasks').update({ read_at: nowIso }).eq('id', taskId);
  else if (action === 'mute') res = await supabaseClient.from('tasks').update({ read_at: nowIso, reminder_muted_at: nowIso }).eq('id', taskId);
  else if (action === 'done') res = await supabaseClient.from('tasks').update({ status: 'הושלמה', completed_at: nowIso }).eq('id', taskId);
  else if (action === 'postpone') {
    const patch = { due_date: extra.date, last_notified_at: null, notify_count: 0, read_at: null, reminder_muted_at: null };
    if (extra.time) patch.due_time = extra.time + ':00';
    res = await supabaseClient.from('tasks').update(patch).eq('id', taskId);
  }
  else if (action === 'delete') res = await supabaseClient.from('tasks').delete().eq('id', taskId);
  else return { error: null };
  if (!res.error) bsdCloseLocalTaskNotifications(taskId);
  return { error: res.error || null };
}

// close this device's OS notification + in-app card for the task right away
function bsdCloseLocalTaskNotifications(taskId){
  const tag = 'bsd-task-' + taskId;
  try {
    if ('serviceWorker' in navigator) navigator.serviceWorker.getRegistrations().then(regs => regs.forEach(r =>
      r.getNotifications({ tag }).then(list => list.forEach(n => n.close())).catch(() => {})));
  } catch (e) {}
  try { if (window.BSDNotify) { BSDNotify.closeCard('push:' + tag); BSDNotify.dismiss('task', taskId); } } catch (e) {}
}
