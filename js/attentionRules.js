// BSD CRM - כללי "דורש טיפול" מרוכזים במקום אחד (סעיף 26 באפיון).
// כל שינוי עתידי בהגדרת "מה נחשב דורש טיפול" נעשה כאן בלבד, לא מפוזר
// בין matches.html / needs-attention.html / app.html.
//
// שים לב: כללים שתלויים בפגישות/סיכומים (פגישה ללא סיכום, מסמך שהתבקש
// בפגישה) ממתינים לשלב 2-3, כשתיווסף טבלת match_meetings. הם מסומנים
// כ-TODO_STAGE2 למטה.

const ATTENTION_STALE_NEGOTIATION_DAYS = 7;   // משא ומתן בלי עדכון X ימים
const ATTENTION_STALE_WAITING_DAYS = 5;       // סטטוסי המתנה בלי עדכון X ימים
// 03.09.2026 - תוקן בתצוגה מקדימה בלבד: המחרוזות המקוריות כאן ('נסגר בהצלחה','בהשהיה','לא רלוונטי',
// 'ממתין לתגובת קונה','ממתין להסכם או NDA','ממתין למידע מהעסק','ממתין לקונה') לא קיימות בכלל
// ברשימת MATCH_STATUSES האמיתית במערכת (match-detail.html) - כלומר הסינון הזה מעולם לא תפס אף
// התאמה בפועל, וסטטוסים סופיים כמו "הקונה לא מעוניין" המשיכו להופיע ברשימות "דורש טיפול" לנצח.
// תוקן מול הסטטוסים האמיתיים. שני סטטוסים לא ברורים ("ממתין למידע מהעסק"/"ממתין לקונה") אין להם
// מקבילה חד-משמעית בסטטוסים האמיתיים - הושארו בחוץ בינתיים, ממתין לאישורו איזה סטטוס אמיתי מתכוון אליו.
// 03.09.2026 - תוקן גם: staleNegotiation בדק 'משא ומתן' אבל הסטטוס האמיתי הוא 'במשא ומתן' -
// כך שגם הכלל הזה מעולם לא תפס אף התאמה בפועל.
const ATTENTION_CLOSED_STATUSES = ['הקונה לא מעוניין', 'נסגר ללא עסקה', 'עסקה הושלמה'];
const ATTENTION_WAITING_STATUSES = ['ממתין לתגובה', 'ממתין לחתימת סודיות'];

function daysBetween(iso){
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}
function isToday(dateStr){
  if (!dateStr) return false;
  const today = new Date().toISOString().slice(0,10);
  return dateStr.slice(0,10) === today;
}
function isPast(dateStr){
  if (!dateStr) return false;
  const today = new Date().toISOString().slice(0,10);
  return dateStr.slice(0,10) < today;
}

/**
 * מחשב את כל פריטי "דורש טיפול" מתוך הנתונים הגולמיים.
 * @param {Object} data - { matches, tasks, userId, isAdminLike }
 * @returns {Object} - { overdueTasks, dueTodayTasks, noNextAction, overdueNextAction, staleNegotiation, staleWaiting }
 */
function computeAttentionItems(data){
  const matches = data.matches || [];
  const tasks = data.tasks || [];

  const openTasks = tasks.filter(t => t.status !== 'הושלמה');

  const overdueTasks = openTasks.filter(t => t.due_date && isPast(t.due_date));
  const dueTodayTasks = openTasks.filter(t => t.due_date && isToday(t.due_date));

  const activeMatches = matches.filter(m => !ATTENTION_CLOSED_STATUSES.includes(m.status));

  const noNextAction = activeMatches.filter(m => !m.next_action || !m.next_action.trim());

  const overdueNextAction = activeMatches.filter(m =>
    m.next_action && m.next_action_at && isPast(m.next_action_at)
  );

  const staleNegotiation = activeMatches.filter(m =>
    m.status === 'במשא ומתן' && daysBetween(m.updated_at) >= ATTENTION_STALE_NEGOTIATION_DAYS
  );

  const staleWaiting = activeMatches.filter(m =>
    ATTENTION_WAITING_STATUSES.includes(m.status) && daysBetween(m.updated_at) >= ATTENTION_STALE_WAITING_DAYS
  );

  // TODO_STAGE2: meetingsWithoutSummary - matches שהייתה להם פגישה (match_meetings)
  // בלי סיכום שנשמר. ממתין לטבלת match_meetings.
  // TODO_STAGE2: documentsRequestedNotHandled - מבוסס על requested_documents
  // בסיכום פגישה. ממתין לטבלת match_meetings.

  return { overdueTasks, dueTodayTasks, noNextAction, overdueNextAction, staleNegotiation, staleWaiting };
}
