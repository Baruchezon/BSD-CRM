// BSD CRM - process-site123-leads Edge Function
//
// רץ על פי לוח זמנים (כל כמה דקות, מתוזמן ב-Supabase Dashboard -> Cron Jobs,
// לא ב-SQL בריפו הציבורי כדי לא לחשוף מפתחות). בכל ריצה:
//   1. מתחבר בעברית: מתחבר לתיבת ה-Gmail (baruch.ezon@gmail.com, IMAP + App
//      Password) ומחפש מיילים מ-info@site123.com שהם "קיבלת הודעה חדשה מהאתר".
//   2. לכל מייל חדש (לפי Message-ID, לא עובד פעמיים): מחלץ את פרטי הפנייה,
//      בודק כפילות מול leads קיימים (טלפון/מייל), יוצר ליד חדש או ממזג לתוך
//      ליד קיים, יוצר משימת מעקב, ושולח פוש-נוטיפיקציה למנהל.
//   3. שום מייל לא "נעלם": כל מייל נרשם בטבלת site123_lead_emails עם סטטוס
//      (created/merged/skipped_not_lead/error). אם קרתה תקלה זמנית (חיבור
//      IMAP נופל, שגיאת DB וכו') - המייל נשאר עם action='error' ומנוסה שוב
//      אוטומטית בריצה הבאה, בלי לגעת במיילים שכבר טופלו בהצלחה.
//
// Secrets נדרשים (Supabase Dashboard -> Edge Functions -> process-site123-leads -> Secrets,
// או `supabase secrets set`):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (זמינים אוטומטית בכל Edge Function)
//   GMAIL_EMAIL_ADDRESS   - כתובת תיבת המייל שאליה מגיעות הודעות SITE123 (baruch.ezon@gmail.com)
//   GMAIL_APP_PASSWORD    - App Password של Gmail (16 תווים, נוצר ב-myaccount.google.com/apppasswords)
//   VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT  - כמו ב-task-reminders, לשליחת פוש

import { createClient } from 'npm:@supabase/supabase-js@2';
import { ImapFlow } from 'npm:imapflow@1';
import { simpleParser } from 'npm:mailparser@3';
import webpush from 'npm:web-push@3';
import { parseSite123Body, classifyPurpose, findDuplicate, last9Digits, stripPipes, isSite123LeadEmail, resolveDisplayName } from './lib.ts';

const SITE123_SENDER = 'info@site123.com';
const SUBJECT_MARK = 'קיבלת הודעה חדשה מהאתר';
const LOOKBACK_DAYS = 30; // חלון חיפוש בכל ריצה - רחב בכוונה; מיילים שכבר טופלו מדולגים תוך שנייה בזכות ה-unique על gmail_message_id, כך שאין עלות אמיתית לחלון רחב, והוא נותן רשת ביטחון אם ריצה נכשלה כמה ימים ברצף

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const hasVapid = Deno.env.get('VAPID_PUBLIC_KEY') && Deno.env.get('VAPID_PRIVATE_KEY');
if (hasVapid) {
  webpush.setVapidDetails(
    Deno.env.get('VAPID_SUBJECT') ?? 'mailto:baruch@bsd-bbi.co.il',
    Deno.env.get('VAPID_PUBLIC_KEY')!,
    Deno.env.get('VAPID_PRIVATE_KEY')!
  );
}

// ---------- עזרים כלליים ----------

async function sendPushToAdmins(payload: Record<string, unknown>) {
  const { data: admins } = await supabase.from('profiles').select('id').eq('role', 'admin').eq('status', 'active');
  for (const a of admins ?? []) {
    const { data: subs } = await supabase.from('push_subscriptions').select('*').eq('user_id', a.id);
    for (const sub of subs ?? []) {
      const subscription = { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } };
      try {
        if (hasVapid) await webpush.sendNotification(subscription, JSON.stringify(payload));
      } catch (err: any) {
        if (err?.statusCode === 410 || err?.statusCode === 404) {
          await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
        } else {
          console.error('push send failed', a.id, err?.statusCode, err?.body);
        }
      }
    }
  }
}

async function getAdminProfileId(): Promise<string | null> {
  const { data } = await supabase.from('profiles').select('id').eq('email', 'baruch@bsd-bbi.co.il').maybeSingle();
  if (data?.id) return data.id;
  const { data: anyAdmin } = await supabase.from('profiles').select('id').eq('role', 'admin').eq('status', 'active').limit(1).maybeSingle();
  return anyAdmin?.id ?? null;
}

// ---------- לוגיקה מרכזית לטיפול במייל בודד ----------

async function processOneEmail(row: {
  id: string;
  gmail_message_id: string;
  raw_subject: string;
  raw_body: string;
  received_at: string | null;
}) {
  const parsed = parseSite123Body(row.raw_body);
  const { type, classification, needsReview } = classifyPurpose(parsed.checkboxes, parsed.message);

  await supabase.from('site123_lead_emails').update({
    parsed: parsed as any,
    classification,
    needs_review: needsReview || !parsed.recognizedTemplate
  }).eq('id', row.id);

  const nowStr = new Date().toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' });
  const last9 = last9Digits(parsed.phone);
  const emailNorm = parsed.email ? parsed.email.trim().toLowerCase() : '';

  // חריג הכשרות (ראו הרחבה למטה ליד "ליד חדש") - מחושב כבר כאן כי הוא
  // צריך להשפיע על החלטת המיזוג/כפילות, לא רק על יצירת ליד חדש.
  const isClearTraining = classification === 'training' && !needsReview;

  // ---- בדיקת כפילות מול leads קיימים ----
  let existing: any = null;
  if (last9 || emailNorm) {
    const orParts: string[] = [];
    if (last9) { orParts.push(`phone.ilike.%${last9}%`); orParts.push(`phone2.ilike.%${last9}%`); }
    if (emailNorm) orParts.push(`email.ilike.${emailNorm}`);
    const { data: candidates } = await supabase
      .from('leads')
      .select('id, phone, phone2, email, notes, full_name, type, updated_at, website_intake_stage')
      .or(orParts.join(','));
    // סינון סופי בקוד (לא רק ב-DB): ה-ilike גס בכוונה כדי לתפוס פורמטים שונים
    // של אותו מספר (05x מול 9725x מול +9725x), findDuplicate מוודא התאמה אמיתית
    existing = findDuplicate(parsed.phone, parsed.email, (candidates ?? []) as any);
  }

  // תיקון שורש (30.08.2026): פנייה חד-משמעית להכשרה שמזוהה כ"כפילות" מול
  // איש קשר שכבר קיים במערכת מסיבה אחרת לגמרי (למשל ליד קונה/מוכר ישן
  // שנסגר) לא אמורה "להיבלע" כהערה על אותה רשומה לא-קשורה - זה בדיוק מה
  // שקרה בפועל (בדיקה אמיתית 30.08: פנייה על "רישום לקורס" נכנסה כהערה+
  // משימה על ליד קונה ישן, בלי שהיא הגיעה בכלל לתיבת הלידים להכשרה).
  // ההבחנה: אם הרשומה הקיימת היא כבר בעצמה ליד-הכשרה פתוח
  // (website_intake_stage='training') - זו אכן אותה פנייה נמשכת, וממשיכים
  // למיזוג הרגיל. אחרת (ליד מסוג/עניין אחר לגמרי) - לא ממזגים; ממשיכים
  // לנתיב "ליד חדש" ויוצרים ליד הכשרה נפרד, עם הפניה צולבת להערה (לא
  // נוגעים ברשומה הישנה בכלל - אפס סיכון לניתוב הקיים שלה).
  const existingIsUnrelatedToTraining = isClearTraining && existing && existing.website_intake_stage !== 'training';
  const crossRefExisting = existingIsUnrelatedToTraining ? existing : null;
  if (existingIsUnrelatedToTraining) existing = null;

  const adminId = await getAdminProfileId();
  // שם התצוגה של הליד: אף פעם לא שם בעל התיבה/BSD, ואף פעם לא מומצא - אם
  // אין שם ברור בשדה "שם ושם משפחה" של הטופס, "שם לא זוהה" בלבד.
  const displayName = resolveDisplayName(parsed.fullName);

  if (existing) {
    // ---- מיזוג לתוך ליד קיים - לא נוצר כרטיס כפול ----
    // שני השמות מוצגים בנפרד ובבירור בהערה, כדי שלעולם לא ייראה כאילו שם
    // הפונה החדש "התחלף" בשם הרשומה הקיימת - הרשומה הקיימת לא משנה שם.
    const sameName = (existing.full_name || '').trim() === displayName.trim();
    const addNote = `\n\n[קליטה אוטומטית מהאתר ${nowStr}] התקבלה פנייה נוספת בטלפון/מייל התואמים לרשומה זו.\n`
      + `שם הפונה בטופס הנוכחי: ${displayName}${sameName ? '' : ` (שונה משם הרשומה הקיימת: ${existing.full_name || 'שם לא זוהה'})`}\n`
      + `תיבות סימון שנבחרו (כל הבחירות): ${parsed.checkboxes.length ? parsed.checkboxes.join(', ') : '(לא סומן)'} | הודעה: ${parsed.message || '—'}`;
    // אם הרשומה הקיימת היא עדיין ליד-אתר פתוח (עוד לא סווג/הועבר) - מחזירים
    // אותה ל-'new' (או 'training' אם זו פנייה חוזרת להכשרה) כדי שהפנייה
    // הנוספת תקפוץ שוב בתיבת הקליטה הרלוונטית ולא תיבלע בתוך הערה על ליד
    // שממתין ממילא. לידים שכבר הועברו סופית (stage=null) לא נפתחים מחדש
    // אוטומטית - רק מקבלים הערה + משימה, כמו קודם.
    const stillOpenIntake = existing.website_intake_stage === 'new' || existing.website_intake_stage === 'contacted' || existing.website_intake_stage === 'training';
    const updatePayload: Record<string, any> = { notes: (existing.notes || '') + addNote };
    if (stillOpenIntake) {
      updatePayload.website_intake_stage = existing.website_intake_stage === 'training' ? 'training' : 'new';
      updatePayload.status = existing.website_intake_stage === 'training' ? 'חדש לטיפול' : 'חדש';
    }
    const { error: updErr } = await supabase.from('leads').update(updatePayload).eq('id', existing.id);
    if (updErr) throw new Error('update existing lead failed: ' + updErr.message);

    await supabase.from('audit_log').insert({
      table_name: 'leads', record_id: existing.id, action: 'update',
      actor_id: adminId, details: { source: 'site123_email_intake', kind: 'repeat_contact', gmail_message_id: row.gmail_message_id, submitted_name: displayName }
    });

    const { data: task } = await supabase.from('tasks').insert({
      title: `פנייה חוזרת מ-${displayName} - בדוק ליד קיים (${existing.full_name || 'שם לא זוהה'})`,
      description: `התקבלה פנייה נוספת מהאתר בשם "${displayName}", בטלפון/מייל שכבר שייכים לרשומה קיימת בשם "${existing.full_name || 'שם לא זוהה'}". תיבות שסומנו: ${parsed.checkboxes.join(', ') || '—'}. הודעה: ${parsed.message || '—'}`,
      priority: 'גבוהה', assigned_to: adminId, status: 'פתוחה',
      related_type: 'lead', related_id: existing.id
    }).select('id').single();

    await sendPushToAdmins({
      title: '🔁 פנייה חוזרת מהאתר',
      body: `${displayName} - הטלפון/מייל כבר שייכים לרשומה קיימת (${existing.full_name || 'שם לא זוהה'})`,
      kind: 'morning',
      url: `lead-alert.html?id=${existing.id}&kind=repeat`,
      tag: `bsd-site123-${row.id}`
    });

    await supabase.from('site123_lead_emails').update({
      action: 'merged', lead_id: existing.id, matched_existing: true, processed_at: new Date().toISOString()
    }).eq('id', row.id);

    return { action: 'merged', leadId: existing.id, taskId: task?.id };
  }

  // ---- ליד חדש ----
  // כל ליד חדש מהאתר נכנס ל"תיבת קליטה" (website_intake_stage='new') ולא
  // מסווג סופית לקונה/מוכר/שותף כאן, גם כשההודעה ברורה - הסיווג הסופי
  // וההעברה לרשימה המתאימה נעשים אך ורק ידנית, אחרי שדיברו עם הלקוח
  // (ראה לידים-hub.html / דרישה מפורשת: "אל תסווג את הליד סופית לבד").
  // ה-type/needsReview כאן הם ניחוש בלבד לתצוגה במסך הקליטה - לא קובעים
  // לאן הליד "שייך" במערכת.
  //
  // חריג יחיד, לפי הנחיה מפורשת (30.08.2026): הכשרות/קורס. כשההודעה
  // מכילה אזכור ברור וחד-משמעי (לא ניחוש - classifyPurpose כבר קבע
  // needsReview=false רק כשהיה אזכור מפורש של "קורס"/"הכשרה"/"לימוד")
  // הליד מנותב ישירות לתיבת "לידים" במודול הכשרות ומתעניינים
  // (website_intake_stage='training') במקום לתיבת הקליטה הכללית - כדי
  // שלא "ייבלע" בין לידי קונה/מוכר. שום סיווג אחר (מוכר/קונה/שותף/לא
  // ברור) לא משתנה - כולם ממשיכים בדיוק כמו קודם ל-website_intake_stage='new'.
  // (isClearTraining עצמו מחושב למעלה, לפני בדיקת הכפילות - ראו שם.)

  const nameParts = displayName === 'שם לא זוהה' ? [] : displayName.split(/\s+/).filter(Boolean);
  const firstName = nameParts[0] || null;
  const lastName = nameParts.slice(1).join(' ') || null;

  const guessLabel = classification === 'seller' ? 'מעוניין למכור עסק (ניחוש)'
    : classification === 'buyer' ? 'מחפש לקנות עסק (ניחוש)'
    : classification === 'partner' ? 'מעוניין בשותפות/השקעה (ניחוש)'
    : classification === 'training' ? 'מתעניין בהכשרת מתווכי עסקים' // לא "ניחוש" - זו זיהוי ודאי לפי תוכן, לא שדה טכני
    : 'דורש בדיקה - לא ניתן היה לזהות תחום התעניינות בוודאות';

  const notes = (isClearTraining
      ? `[זוהה אוטומטית ע"י המערכת לפי תוכן ההודעה כמתעניין בהכשרה, ${nowStr}]\n`
      : `[נוצר אוטומטית ע"י המערכת - ליד מהאתר, טרם סווג, ${nowStr}]\nניחוש ראשוני (לא סופי): ${guessLabel}\n`)
    + `תיבות סימון שנבחרו בטופס (כל הבחירות שסומנו, לא רק אחת): ${parsed.checkboxes.length ? parsed.checkboxes.join(', ') : '(לא סומנה אף תיבה)'}\n`
    + `הודעה חופשית מהפונה: ${parsed.message || '(לא צוין)'}\n`
    + (parsed.city ? `עיר/מיקום כפי שנרשם: ${parsed.city}\n` : '')
    + (crossRefExisting ? `\n⚠️ לתשומת לב: אותו טלפון/מייל קיים כבר במערכת ברשומה אחרת (לא הכשרה) - "${crossRefExisting.full_name || 'שם לא זוהה'}" (סוג: ${crossRefExisting.type || '—'}, מזהה: ${crossRefExisting.id}). לא מוזג אוטומטית כדי לא לאבד את פנייתו החדשה על ההכשרה - כדאי לבדוק ידנית אם זה אותו איש קשר.\n` : '')
    + (!parsed.recognizedTemplate ? `\nהמייל לא תאם אף אחת משתי תבניות הטופס המוכרות - טקסט מקורי מלא:\n${stripPipes(row.raw_body).slice(0, 2000)}` : '');

  const payload: Record<string, any> = {
    type, first_name: firstName, last_name: lastName, full_name: displayName,
    phone: parsed.phone || null, email: parsed.email || null, city: parsed.city || null,
    source: 'SITE123 / אתר BSD', status: isClearTraining ? 'חדש לטיפול' : 'חדש', notes,
    website_intake_stage: isClearTraining ? 'training' : 'new', website_purpose_guess: guessLabel,
    created_by: adminId, handled_by: adminId, agreement_status: 'אין הסכם'
  };
  if (type === 'buyer' || type === 'partner') {
    payload.requested_area = parsed.city || null;
  } else {
    payload.business_city = parsed.city || null;
  }

  const { data: newLead, error: insErr } = await supabase.from('leads').insert(payload).select('id').single();
  if (insErr) throw new Error('insert lead failed: ' + insErr.message);

  // אימות אמיתי (לא רק "לא החזיר שגיאה"): שליפה חוזרת בקריאה נפרדת ובדיקה
  // שהשורה אכן קיימת עם הערכים שביקשנו - כדי שלעולם לא נדווח "נוצר" בלי
  // שזה באמת נשמר במסד הנתונים.
  const expectedStage = isClearTraining ? 'training' : 'new';
  const { data: verifyRow, error: verifyErr } = await supabase
    .from('leads').select('id, website_intake_stage, status').eq('id', newLead.id).maybeSingle();
  if (verifyErr || !verifyRow || verifyRow.website_intake_stage !== expectedStage) {
    throw new Error('lead insert could not be verified after write: ' + (verifyErr?.message || 'row not found or mismatched after insert'));
  }

  await supabase.from('audit_log').insert({
    table_name: 'leads', record_id: newLead.id, action: 'create',
    actor_id: adminId, details: { source: 'site123_email_intake', gmail_message_id: row.gmail_message_id, classification }
  });

  const { data: task } = await supabase.from('tasks').insert({
    title: isClearTraining
      ? `מתעניין חדש בהכשרה ממתין לטיפול - ${displayName}`
      : `צור קשר עם ליד חדש מהאתר - ${displayName}`,
    description: `תיבות שסומנו: ${parsed.checkboxes.join(', ') || '—'}\nהודעה: ${parsed.message || '—'}\nטלפון: ${parsed.phone || '—'} | מייל: ${parsed.email || '—'}`,
    priority: 'רגילה', assigned_to: adminId, status: 'פתוחה',
    related_type: 'lead', related_id: newLead.id
  }).select('id').single();

  await sendPushToAdmins(isClearTraining ? {
    title: '🎓 מתעניין חדש בהכשרה ממתין לטיפול',
    body: `${displayName}${parsed.phone ? ' | ' + parsed.phone : ''}`,
    kind: 'morning',
    url: `training-admin.html?tab=inbox&open=${newLead.id}`,
    tag: `bsd-site123-${row.id}`
  } : {
    title: '🆕 ליד חדש התקבל מהאתר',
    body: `${displayName}${parsed.phone ? ' | ' + parsed.phone : ''} - ${guessLabel}`,
    kind: 'morning',
    url: `lead-alert.html?id=${newLead.id}&kind=new`,
    tag: `bsd-site123-${row.id}`
  });

  await supabase.from('site123_lead_emails').update({
    action: 'created', lead_id: newLead.id, matched_existing: false, processed_at: new Date().toISOString()
  }).eq('id', row.id);

  return { action: 'created', leadId: newLead.id, taskId: task?.id };
}

// ---------- כניסה ל-Gmail ושליפת מיילים ----------

Deno.serve(async (req) => {
  const summary = { fetched: 0, newRows: 0, created: 0, merged: 0, skipped: 0, errors: [] as string[] };

  const gmailUser = Deno.env.get('GMAIL_EMAIL_ADDRESS');
  const gmailPass = Deno.env.get('GMAIL_APP_PASSWORD');
  if (!gmailUser || !gmailPass) {
    return new Response(JSON.stringify({ ok: false, error: 'GMAIL_EMAIL_ADDRESS / GMAIL_APP_PASSWORD secrets not set' }), { status: 500 });
  }

  const client = new ImapFlow({
    host: 'imap.gmail.com', port: 993, secure: true,
    auth: { user: gmailUser, pass: gmailPass },
    logger: false
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
      const searchResult = await client.search({ from: SITE123_SENDER, since }, { uid: true });
      const uids: number[] = Array.isArray(searchResult) ? searchResult : [];

      for (const uid of uids) {
        summary.fetched++;
        let currentMessageId: string | null = null;
        try {
          const msg = await client.fetchOne(uid, { source: true, envelope: true, internalDate: true }, { uid: true });
          if (!msg || !msg.source) continue;
          const messageId = msg.envelope?.messageId || `uid-${uid}@imap.gmail.com`;
          currentMessageId = messageId;
          const subject = msg.envelope?.subject || '';

          // תפיסה מוקדמת: אם כבר טופל בהצלחה (created/merged/skipped_not_lead) בעבר - דלג מיד
          const { data: existingRow } = await supabase
            .from('site123_lead_emails').select('id, action').eq('gmail_message_id', messageId).maybeSingle();
          if (existingRow && ['created', 'merged', 'skipped_not_lead'].includes(existingRow.action)) continue;

          const parsedMail = await simpleParser(msg.source);
          const fromAddr = (parsedMail.from?.value?.[0]?.address || '').toLowerCase();
          const bodyText = parsedMail.text || '';

          const isLeadEmail = isSite123LeadEmail(fromAddr, subject);

          let rowId = existingRow?.id;
          if (!rowId) {
            const { data: inserted, error: insErr } = await supabase.from('site123_lead_emails').insert({
              gmail_message_id: messageId,
              received_at: msg.internalDate ? new Date(msg.internalDate).toISOString() : null,
              raw_subject: subject, raw_body: bodyText, action: 'pending'
            }).select('id').single();
            if (insErr) { summary.errors.push(`${messageId}: ${insErr.message}`); continue; }
            rowId = inserted.id;
            summary.newRows++;
          } else {
            await supabase.from('site123_lead_emails').update({ raw_subject: subject, raw_body: bodyText }).eq('id', rowId);
          }

          if (!isLeadEmail) {
            await supabase.from('site123_lead_emails').update({
              action: 'skipped_not_lead', processed_at: new Date().toISOString()
            }).eq('id', rowId);
            summary.skipped++;
            continue;
          }

          const result = await processOneEmail({
            id: rowId, gmail_message_id: messageId, raw_subject: subject,
            raw_body: bodyText, received_at: msg.internalDate ? new Date(msg.internalDate).toISOString() : null
          });
          if (result.action === 'created') summary.created++;
          if (result.action === 'merged') summary.merged++;
        } catch (perMsgErr: any) {
          summary.errors.push(`uid ${uid}: ${perMsgErr?.message || perMsgErr}`);
          // מסמנים error על השורה (אם כבר נוצרה) כדי שריצה הבאה תנסה שוב - לא בולעים בשקט.
          // לא נוגעים בשורות שכבר הגיעו ל-created/merged בהצלחה.
          if (currentMessageId) {
            try {
              const { data: errRow } = await supabase.from('site123_lead_emails')
                .update({ action: 'error', error_message: String(perMsgErr?.message || perMsgErr), processed_at: new Date().toISOString() })
                .eq('gmail_message_id', currentMessageId)
                .not('action', 'in', '("created","merged")')
                .select('id, raw_subject, error_alerted_at')
                .maybeSingle();

              // התראה לאדמין - פעם אחת בלבד לכל מייל כושל (לא בכל ריצה חוזרת של ה-cron),
              // כדי שמייל שנכשל לא "ייעלם בשקט" גם אם הפרסינג/הסיווג נכשל שוב ושוב.
              if (errRow && !errRow.error_alerted_at) {
                const adminIdForAlert = await getAdminProfileId();
                await supabase.from('tasks').insert({
                  title: `⚠️ מייל מהאתר לא נקלט - נדרשת בדיקה ידנית`,
                  description: `מייל בנושא "${errRow.raw_subject || '—'}" נכשל בעיבוד האוטומטי (${String(perMsgErr?.message || perMsgErr).slice(0, 300)}). המייל לא אבד - הוא שמור בטבלת site123_lead_emails (מזהה ${errRow.id}) וממתין לבדיקה/עיבוד ידני.`,
                  priority: 'גבוהה', assigned_to: adminIdForAlert, status: 'פתוחה',
                  related_type: 'site123_lead_email', related_id: errRow.id
                });
                await sendPushToAdmins({
                  title: '⚠️ מייל מהאתר לא נקלט אוטומטית',
                  body: errRow.raw_subject || 'נדרשת בדיקה ידנית',
                  kind: 'morning',
                  url: `training-admin.html`,
                  tag: `bsd-site123-error-${errRow.id}`
                });
                await supabase.from('site123_lead_emails').update({ error_alerted_at: new Date().toISOString() }).eq('id', errRow.id);
              }
            } catch (_) { /* best-effort - לא עוצרים את שאר הריצה בגלל זה */ }
          }
        }
      }
    } finally {
      lock.release();
    }
    await client.logout();
  } catch (connErr: any) {
    // תקלה בחיבור עצמו (רשת/סיסמה) - לא מסמנים כלום כ"נכשל סופית", פשוט מחזירים
    // שגיאה; שום מייל לא אבד כי לא סומן שום דבר. הריצה הבאה תנסה שוב מאפס.
    return new Response(JSON.stringify({ ok: false, error: 'IMAP connection failed: ' + (connErr?.message || connErr), summary }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true, summary }), { headers: { 'Content-Type': 'application/json' } });
});
