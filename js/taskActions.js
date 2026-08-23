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
    notify_count: 0
  }).eq('id', taskId);
  return { error, newDueDate };
}
