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
import { parseSite123Body, classifyPurpose, findDuplicate, last9Digits, stripPipes, isSite123LeadEmail } from './lib.ts';

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
  const { type, classification, needsReview } = classifyPurpose(parsed.purpose);

  await supabase.from('site123_lead_emails').update({
    parsed: parsed as any,
    classification,
    needs_review: needsReview || !parsed.recognizedTemplate
  }).eq('id', row.id);

  const nowStr = new Date().toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' });
  const last9 = last9Digits(parsed.phone);
  const emailNorm = parsed.email ? parsed.email.trim().toLowerCase() : '';

  // ---- בדיקת כפילות מול leads קיימים ----
  let existing: any = null;
  if (last9 || emailNorm) {
    const orParts: string[] = [];
    if (last9) { orParts.push(`phone.ilike.%${last9}%`); orParts.push(`phone2.ilike.%${last9}%`); }
    if (emailNorm) orParts.push(`email.ilike.${emailNorm}`);
    const { data: candidates } = await supabase
      .from('leads')
      .select('id, phone, phone2, email, notes, full_name, type, updated_at')
      .or(orParts.join(','));
    // סינון סופי בקוד (לא רק ב-DB): ה-ilike גס בכוונה כדי לתפוס פורמטים שונים
    // של אותו מספר (05x מול 9725x מול +9725x), findDuplicate מוודא התאמה אמיתית
    existing = findDuplicate(parsed.phone, parsed.email, (candidates ?? []) as any);
  }

  const adminId = await getAdminProfileId();
  const displayName = parsed.fullName || '(ללא שם)';

  if (existing) {
    // ---- מיזוג לתוך ליד קיים - לא נוצר כרטיס כפול ----
    const addNote = `\n\n[קליטה אוטומטית מהאתר ${nowStr}] פנייה נוספת מ-${displayName}. מטרה: ${parsed.purpose || '—'}. הודעה: ${parsed.message || '—'} (תאריך בטופס: ${parsed.dateField || '—'})`;
    const { error: updErr } = await supabase.from('leads').update({
      notes: (existing.notes || '') + addNote
    }).eq('id', existing.id);
    if (updErr) throw new Error('update existing lead failed: ' + updErr.message);

    await supabase.from('audit_log').insert({
      table_name: 'leads', record_id: existing.id, action: 'update',
      actor_id: adminId, details: { source: 'site123_email_intake', kind: 'repeat_contact', gmail_message_id: row.gmail_message_id }
    });

    const { data: task } = await supabase.from('tasks').insert({
      title: `פנייה חוזרת מ-${displayName} - בדוק ליד קיים`,
      description: `התקבלה פנייה נוספת מהאתר מאדם שכבר קיים במערכת (${existing.full_name || displayName}). מטרה: ${parsed.purpose || '—'}. הודעה: ${parsed.message || '—'}`,
      priority: 'גבוהה', assigned_to: adminId, status: 'פתוחה',
      related_type: 'lead', related_id: existing.id
    }).select('id').single();

    await sendPushToAdmins({
      title: '🔁 פנייה חוזרת מהאתר',
      body: `${displayName} כבר קיים במערכת - התקבלה פנייה נוספת (${parsed.purpose || 'ללא ציון מטרה'})`,
      kind: 'morning',
      url: `leads.html?open=${existing.id}`,
      tag: `bsd-site123-${row.id}`
    });

    await supabase.from('site123_lead_emails').update({
      action: 'merged', lead_id: existing.id, matched_existing: true, processed_at: new Date().toISOString()
    }).eq('id', row.id);

    return { action: 'merged', leadId: existing.id, taskId: task?.id };
  }

  // ---- ליד חדש ----
  const nameParts = displayName.split(/\s+/).filter(Boolean);
  const firstName = nameParts[0] || null;
  const lastName = nameParts.slice(1).join(' ') || null;

  const reviewPrefix = (needsReview || !parsed.recognizedTemplate)
    ? '⚠️ לא ניתן היה לסווג את הפנייה בוודאות - נדרשת בדיקה ידנית.\n' : '';
  const notes = `${reviewPrefix}[נוצר אוטומטית ע"י המערכת - קליטה אוטומטית מהאתר, ${nowStr}]\n`
    + `מטרת הפנייה כפי שמולאה בטופס: ${parsed.purpose || '(לא צוין)'}\n`
    + `הודעה חופשית מהפונה: ${parsed.message || '(לא צוין)'}\n`
    + `תאריך שדה בטופס: ${parsed.dateField || '(לא צוין)'}\n`
    + (parsed.city ? `עיר/מיקום כפי שנרשם: ${parsed.city}\n` : '')
    + (!parsed.recognizedTemplate ? `\nהמייל לא תאם את מבנה הטופס המוכר - טקסט מקורי מלא:\n${stripPipes(row.raw_body).slice(0, 2000)}` : '');

  const payload: Record<string, any> = {
    type, first_name: firstName, last_name: lastName, full_name: displayName,
    phone: parsed.phone || null, email: parsed.email || null, city: parsed.city || null,
    source: 'SITE123 / אתר BSD', status: 'חדש מהאתר', notes,
    created_by: adminId, handled_by: adminId, agreement_status: 'אין הסכם'
  };
  if (type === 'buyer' || type === 'partner') {
    payload.requested_area = parsed.city || null;
  } else {
    payload.business_city = parsed.city || null;
  }

  const { data: newLead, error: insErr } = await supabase.from('leads').insert(payload).select('id').single();
  if (insErr) throw new Error('insert lead failed: ' + insErr.message);

  await supabase.from('audit_log').insert({
    table_name: 'leads', record_id: newLead.id, action: 'create',
    actor_id: adminId, details: { source: 'site123_email_intake', gmail_message_id: row.gmail_message_id }
  });

  const { data: task } = await supabase.from('tasks').insert({
    title: `צור קשר עם ליד חדש מהאתר - ${displayName}`,
    description: `מטרה: ${parsed.purpose || '—'}\nהודעה: ${parsed.message || '—'}\nטלפון: ${parsed.phone || '—'} | מייל: ${parsed.email || '—'}`,
    priority: 'רגילה', assigned_to: adminId, status: 'פתוחה',
    related_type: 'lead', related_id: newLead.id
  }).select('id').single();

  const typeLabel = type === 'seller' ? 'מוכר עסק' : type === 'partner' ? 'משקיע' : 'מחפש לרכוש עסק';
  await sendPushToAdmins({
    title: '🆕 ליד חדש התקבל מהאתר',
    body: `${displayName} | ${typeLabel}${parsed.phone ? ' | ' + parsed.phone : ''}${needsReview ? ' | ⚠️ נדרש סיווג' : ''}`,
    kind: 'morning',
    url: `leads.html?open=${newLead.id}`,
    tag: `bsd-site123-${row.id}`
  });

  await supabase.from('site123_lead_emails').update({
    action: 'created', lead_id: newLead.id, matched_existing: false, processed_at: new Date().toISOString()
  }).eq('id', row.id);

  return { action: 'created', leadId: newLead.id, taskId: task?.id };
}

// ---------- כניסה ל-Gmail ושליפת מיילים ----------

Deno.serve(async () => {
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
              await supabase.from('site123_lead_emails')
                .update({ action: 'error', error_message: String(perMsgErr?.message || perMsgErr), processed_at: new Date().toISOString() })
                .eq('gmail_message_id', currentMessageId)
                .not('action', 'in', '("created","merged")');
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
