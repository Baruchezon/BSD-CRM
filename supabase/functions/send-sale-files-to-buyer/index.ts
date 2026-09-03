// BSD CRM - send-sale-files-to-buyer Edge Function
//
// 30.08.2026: נוצר לפי הנחיה מפורשת - מנגנון הרשאות קשיח (לא רק אזהרת
// ממשק) לשליחת קבצים מ"תיק המכירה" (business_sale_files) לקונים.
//
// למה פונקציה נפרדת ולא הרחבה של send-match-summary הקיים: send-match-summary
// משמש כבר במקומות אחרים (match-detail.html, businesses.html - אזור "קבצי
// עסק" הכללי, standaloneRecording.js) בתור "שולח מייל גנרי" שמקבל to/subject/
// body מהלקוח כמו שהם. שינוי ההתנהגות שלו היה שובר את השימושים האחרים או
// דורש דגל מיוחד בכל קריאה קיימת - סיכון מיותר. הפונקציה הזו עצמאית,
// ממוקדת אך ורק בתיק המכירה, ולא נוגעת בשום קוד קיים.
//
// ההבדל המהותי מ-send-match-summary: כאן הלקוח (הדפדפן) *לעולם* לא שולח
// כתובת מייל של קונה, רשימת קבצים סופית או קישורי הורדה - הוא שולח רק
// business_id + buyer_id + file_ids + טקסט חופשי לעריכה (נושא/פתיח).
// כל השאר (אימייל הקונה, סטטוס ההסכם, רמת הסודיות של כל קובץ, קישורי
// ההורדה עצמם) נשלף ונבנה כאן בשרת, עם ה-service role key, ולא ניתן
// לזייף מהצד השני - זו הדרישה המרכזית בהנחיה (סעיף 7): החסימה חייבת
// להתקיים גם אם קוראים ל-API ישירות ומדלגים על ה-UI.
//
// כלל ההרשאה (זהה למה שכבר קיים ב-js/saleFileModule2.js בצד הלקוח - כאן
// הוא רק נאכף שוב, באמת, בשרת):
//   confidentiality_level = 1 (אנונימי) -> מותר לכל קונה, בכל מצב הסכם.
//   confidentiality_level = 2 (חסוי)    -> מותר רק אם leads.agreement_status
//                                          === 'יש הסכם חתום'. אחרת נכשל
//                                          כשל מוחלט (fail-closed) - לא
//                                          שולח את שאר הקבצים בשקט, לא
//                                          מוריד לבד את הקובץ החסום.
//
// כל ניסיון שליחה (הצלחה או כישלון/חסימה) נרשם ל-audit_log הקיים - אותה
// טבלה שכבר משמשת את שאר תיק המכירה (sfLogAudit בצד הלקוח) - לא טבלה
// מקבילה חדשה.

import { createClient } from 'npm:@supabase/supabase-js@2';

function cleanEnv(v: string | undefined): string {
  return (v || '').trim();
}

const RESEND_API_KEY = cleanEnv(Deno.env.get('RESEND_API_KEY'));
const RESEND_FROM_EMAIL = cleanEnv(Deno.env.get('RESEND_FROM_EMAIL')) || 'onboarding@resend.dev';
const SIGNED_URL_SECONDS = 60 * 60 * 24 * 7; // שבוע - זהה לקבוע הקיים (SF_SIGNED_URL_SECONDS) בצד הלקוח
const SALE_FILE_BUCKET = 'business-files';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
}

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
  });
}

function esc(s: string): string {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));
}

// 03.09.2026: תוקן באג פוטנציאלי - עד כה שום קריאה חיצונית (auth, storage,
// Resend) לא הייתה מוגבלת בזמן, כך שאם אחת מהן נתקעת (רשת איטית/ספק לא
// מגיב) הפונקציה כולה נתקעת ללא סוף והלקוח נשאר על "שולח..." בלי תשובה
// לעולם. כל קריאה חיצונית עוברת עכשיו דרך withTimeout כדי שתמיד תוחזר
// תשובה סופית ללקוח (הצלחה או שגיאת timeout מפורשת).
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout: ${label} לא הגיב תוך ${ms / 1000} שניות`)), ms);
    promise.then((v) => { clearTimeout(timer); resolve(v); },
                 (e) => { clearTimeout(timer); reject(e); });
  });
}

function log(step: string, details?: Record<string, unknown>) {
  // 03.09.2026: לוגים מסודרים לכל שלב קריטי, לצפייה ב-Supabase Edge Function
  // Logs - כדי לאתר בדיוק איפה תקוע ניסיון שליחה עתידי, בלי לנחש.
  console.log(`[send-sale-files-to-buyer] ${step}`, details ? JSON.stringify(details) : '');
}

async function logAttempt(details: Record<string, unknown>, actorId: string | null, businessId: string) {
  try {
    await supabase.from('audit_log').insert({
      table_name: 'business_sale_files',
      record_id: businessId,
      action: 'send_sale_files_to_buyer',
      actor_id: actorId,
      details,
    });
  } catch (_e) {
    // כמו ב-sfLogAudit הקיים בצד הלקוח: תיעוד לא חוסם את התוצאה עצמה,
    // אבל השליחה/החסימה כבר קרתה בפועל לפני הניסיון לתעד.
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders() });
  }

  let actorId: string | null = null;
  let businessIdForLog = '';

  try {
    log('start');
    // 1. אימות משתמש מחובר (זהה לתבנית ב-send-match-summary הקיים)
    const authHeader = req.headers.get('Authorization') || '';
    const jwt = authHeader.replace('Bearer ', '');
    const { data: userData, error: userErr } = await withTimeout(
      supabase.auth.getUser(jwt), 10000, 'אימות משתמש (auth.getUser)'
    );
    if (userErr || !userData?.user) {
      log('auth_failed', { error: userErr?.message });
      return jsonResponse(401, { error: 'לא מחובר' });
    }
    actorId = userData.user.id;
    log('auth_ok', { actorId });

    const body = await req.json();
    const { business_id, buyer_id, file_ids, subject, intro_text, intro_html } = body || {};
    businessIdForLog = business_id || '';
    log('body_parsed', { business_id, buyer_id, file_ids_count: Array.isArray(file_ids) ? file_ids.length : null });

    if (!business_id || !buyer_id || !Array.isArray(file_ids) || !file_ids.length) {
      return jsonResponse(400, { error: 'חסרים שדות חובה: business_id, buyer_id, file_ids (רשימה לא ריקה)' });
    }

    // 2. שליפת פרטי הקונה מה-DB (לא מהלקוח) - כולל agreement_status האמיתי כרגע
    const { data: buyer, error: buyerErr } = await supabase
      .from('leads')
      .select('id, full_name, first_name, last_name, email, phone, agreement_status')
      .eq('id', buyer_id)
      .eq('type', 'buyer')
      .maybeSingle();
    if (buyerErr) { log('buyer_lookup_error', { message: buyerErr.message }); return jsonResponse(500, { error: 'שגיאה בשליפת פרטי הקונה: ' + buyerErr.message }); }
    if (!buyer) { log('buyer_not_found'); return jsonResponse(404, { error: 'קונה לא נמצא' }); }
    log('buyer_ok', { has_email: !!buyer.email, agreement_status: buyer.agreement_status || null });
    if (!buyer.email) {
      await logAttempt({ buyer_id, reason: 'buyer_missing_email', status: 'failed' }, actorId, business_id);
      return jsonResponse(400, { error: 'לקונה הזה אין כתובת אימייל שמורה - יש להוסיף אחת בכרטיס הקונה קודם' });
    }
    const buyerName = buyer.full_name || [buyer.first_name, buyer.last_name].filter(Boolean).join(' ') || 'קונה';
    const signed = buyer.agreement_status === 'יש הסכם חתום';

    // 3. שליפת הקבצים מה-DB לפי business_id+id בלבד - מתעלמים לגמרי משם קובץ/
    //    רמת סודיות/נתיב שהלקוח אולי שלח; רק מה שבאמת רשום כרגע ב-DB קובע.
    const { data: files, error: filesErr } = await supabase
      .from('business_sale_files')
      .select('id, file_name, storage_path, confidentiality_level, category, document_type')
      .eq('business_id', business_id)
      .eq('status', 'active')
      .in('id', file_ids);
    if (filesErr) { log('files_lookup_error', { message: filesErr.message }); return jsonResponse(500, { error: 'שגיאה בשליפת הקבצים: ' + filesErr.message }); }
    log('files_ok', { found_count: (files || []).length, requested_count: file_ids.length });

    const foundIds = new Set((files || []).map((f) => f.id));
    const missing = file_ids.filter((id: string) => !foundIds.has(id));
    if (missing.length) {
      await logAttempt({ buyer_id, file_ids, missing_file_ids: missing, status: 'failed', reason: 'file_not_found_or_inactive' }, actorId, business_id);
      return jsonResponse(400, { error: 'קובץ אחד או יותר לא נמצא בתיק המכירה של העסק הזה (ייתכן שנמחק) - רענן ונסה שוב' });
    }

    // 4. הכלל המרכזי - נאכף כאן, לא רק בממשק: קובץ חסוי (confidentiality_level=2)
    //    מותר אך ורק לקונה עם agreement_status === 'יש הסכם חתום'. ספק במצב
    //    ההסכם = חסימה (ברירת המחדל היא חסימה, לפי סעיף 7 בהנחיה).
    const disallowed = (files || []).filter((f) => !signed && f.confidentiality_level === 2);
    if (disallowed.length) {
      await logAttempt({
        buyer_id, buyer_email: buyer.email, file_ids,
        disallowed_files: disallowed.map((f) => ({ id: f.id, name: f.file_name })),
        agreement_status_at_send: buyer.agreement_status || 'אין הסכם',
        status: 'blocked',
      }, actorId, business_id);
      const names = disallowed.map((f) => f.file_name).join(', ');
      return jsonResponse(403, {
        error: `לא ניתן לשלוח את הקבצים הבאים: ${names}. לקונה אין הסכם סודיות חתום.`,
        disallowed_file_ids: disallowed.map((f) => f.id),
      });
    }

    // 5. יצירת קישורי הורדה מאובטחים - נוצרים כאן, בשרת, ולעולם לא מתקבלים מהלקוח
    log('signed_urls_start', { count: (files || []).length });
    const linkItems: { name: string; url: string }[] = [];
    for (const f of files || []) {
      let signedUrlData, linkErr;
      try {
        ({ data: signedUrlData, error: linkErr } = await withTimeout(
          supabase.storage.from(SALE_FILE_BUCKET).createSignedUrl(f.storage_path, SIGNED_URL_SECONDS),
          10000, `יצירת קישור עבור ${f.file_name}`
        ));
      } catch (te) {
        log('signed_url_timeout', { file: f.file_name, error: te instanceof Error ? te.message : String(te) });
        await logAttempt({ buyer_id, file_ids, status: 'failed', reason: 'signed_url_timeout', failed_file: f.file_name }, actorId, business_id);
        return jsonResponse(504, { error: `יצירת קישור הורדה נתקעה עבור "${f.file_name}" (זמן קצוב) - נסה שוב` });
      }
      if (linkErr || !signedUrlData?.signedUrl) {
        log('signed_url_failed', { file: f.file_name, error: linkErr?.message });
        await logAttempt({ buyer_id, file_ids, status: 'failed', reason: 'signed_url_failed', failed_file: f.file_name }, actorId, business_id);
        return jsonResponse(500, { error: `יצירת קישור הורדה נכשלה עבור "${f.file_name}": ${linkErr?.message || 'שגיאה לא ידועה'}` });
      }
      linkItems.push({ name: f.file_name, url: signedUrlData.signedUrl });
    }
    log('signed_urls_ok', { count: linkItems.length });

    if (!RESEND_API_KEY) {
      log('resend_not_configured');
      await logAttempt({ buyer_id, file_ids, status: 'failed', reason: 'resend_not_configured' }, actorId, business_id);
      return jsonResponse(500, { error: 'RESEND_API_KEY לא מוגדר ב-Secrets של הפונקציה' });
    }

    const finalSubject = (subject && String(subject).trim()) || `חומרי מכירה${signed ? '' : ' (אנונימי)'}`;
    const safeIntroText = (intro_text && String(intro_text)) || `שלום ${buyerName},\n\nמצורפים קישורים להורדת החומרים (בתוקף לשבוע):`;
    const safeIntroHtml = intro_html ? String(intro_html) : `<p style="font-size:15px;">${esc(safeIntroText).replace(/\n/g, '<br>')}</p>`;

    const bodyText =
      safeIntroText + '\n\n' +
      linkItems.map((l) => `${l.name}:\n${l.url}`).join('\n\n') +
      '\n\nבברכה,\nBSD Business Brokers Israel';

    const htmlBody = `
      <div dir="rtl" style="font-family:Heebo,Rubik,Arial,sans-serif;color:#0e1b34;max-width:520px;">
        ${safeIntroHtml}
        <div style="margin:18px 0;">
          ${linkItems.map((l) => `
            <div style="border:1px solid #e5e1d5;border-radius:10px;padding:12px 16px;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;gap:12px;">
              <div style="font-weight:700;font-size:14px;">${esc(l.name)}</div>
              <a href="${l.url}" style="background:#c9a24b;color:#1c2333;text-decoration:none;font-weight:700;font-size:13px;padding:8px 16px;border-radius:8px;white-space:nowrap;">📥 הורדה</a>
            </div>`).join('')}
        </div>
        <p style="font-size:13px;color:#8a93ab;">בברכה,<br>BSD Business Brokers Israel</p>
      </div>`;

    // 6. שליפת פרטי המשתמש המבצע (לשם בתיעוד, לא רק uuid)
    let actorLabel = actorId;
    try {
      const { data: actorProfile } = await supabase.from('profiles').select('full_name, email').eq('id', actorId).maybeSingle();
      if (actorProfile) actorLabel = actorProfile.full_name || actorProfile.email || actorId;
    } catch (_e) { /* לא חוסם */ }

    const replyTo = (body && body.reply_to) ? String(body.reply_to) : undefined;

    log('resend_call_start', { to: buyer.email, from: RESEND_FROM_EMAIL });
    let resp: Response;
    try {
      // 03.09.2026: זה ה-await החיצוני הכי חשוד לתקיעה ללא סוף (קריאת רשת
      // יחידה, בלי טיפול קודם ב-timeout) - AbortController מבטיח שגם אם
      // Resend לא עונה בכלל, הלקוח יקבל תשובה סופית תוך 15 שניות ולא יישאר
      // על "שולח..." לנצח.
      const controller = new AbortController();
      const abortTimer = setTimeout(() => controller.abort(), 15000);
      resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          from: `BSD Business Brokers Israel <${RESEND_FROM_EMAIL}>`,
          to: [buyer.email],
          subject: finalSubject,
          text: bodyText,
          html: htmlBody,
          ...(replyTo ? { reply_to: replyTo } : {}),
        }),
      });
      clearTimeout(abortTimer);
    } catch (fe) {
      const isAbort = fe instanceof Error && fe.name === 'AbortError';
      log('resend_call_exception', { aborted: isAbort, error: fe instanceof Error ? fe.message : String(fe) });
      await logAttempt({
        buyer_id, buyer_email: buyer.email, file_ids, status: 'failed',
        reason: isAbort ? 'resend_timeout' : 'resend_network_error',
        error: fe instanceof Error ? fe.message : String(fe),
      }, actorId, business_id);
      return jsonResponse(isAbort ? 504 : 502, {
        error: isAbort
          ? 'שירות המייל (Resend) לא הגיב תוך 15 שניות - נסה שוב'
          : `שגיאת רשת בקריאה לשירות המייל: ${fe instanceof Error ? fe.message : String(fe)}`,
      });
    }
    log('resend_call_done', { status: resp.status });
    const respBody = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      const detail = (respBody && (respBody.message || respBody.error)) || `HTTP ${resp.status}`;
      await logAttempt({
        buyer_id, buyer_email: buyer.email, file_ids, file_names: (files || []).map((f) => f.file_name),
        agreement_status_at_send: buyer.agreement_status || 'אין הסכם', performed_by: actorLabel,
        status: 'failed', reason: 'resend_api_error', error: detail,
      }, actorId, business_id);
      return jsonResponse(500, { error: `שליחה דרך Resend נכשלה: ${detail}` });
    }

    // 7. תיעוד הצלחה - כולל בדיוק מה שסעיף 6 בהנחיה דורש
    await logAttempt({
      buyer_id, buyer_email: buyer.email,
      file_ids, file_names: (files || []).map((f) => f.file_name),
      file_confidentiality: (files || []).map((f) => ({ id: f.id, name: f.file_name, confidentiality_level: f.confidentiality_level })),
      agreement_status_at_send: buyer.agreement_status || 'אין הסכם',
      performed_by: actorLabel, subject: finalSubject,
      status: 'sent',
    }, actorId, business_id);

    log('sent_ok', { buyer_email: buyer.email });

    // 03.09.2026: תיעוד אוטומטי במרכז ההתאמות - לפי הנחיה מפורשת. מתבצע
    // אך ורק כאן, אחרי שהמייל נשלח בהצלחה בפועל דרך Resend (לא לפני).
    // בכוונה בתוך הפונקציה הקשיחה הזו (שרת, service role) ולא בצד הלקוח -
    // כך שהתיעוד קורה גם אם מישהו קורא ל-API הזה ישירות ומדלג על ה-UI,
    // ולא ניתן לזייף buyer_id/business_id מהלקוח (סעיף 2 בהנחיה: לפי
    // IDs אמיתיים, לא לפי שמות). כשל בבלוק הזה לעולם לא הופך שליחת מייל
    // מוצלחת לכישלון כלפי המשתמש - התיעוד הוא תוספת, לא תנאי.
    let matchAction: 'created' | 'updated' | 'failed' = 'failed';
    try {
      const fileNamesText = (files || []).map((f) => f.file_name).join(', ');
      const actionText = `נשלחו לקונה ${buyerName} קבצים: ${fileNamesText} (מייל)`;
      const nowIso = new Date().toISOString();
      const { data: existingMatch, error: matchLookupErr } = await supabase
        .from('matches').select('id').eq('business_id', business_id).eq('buyer_id', buyer_id).maybeSingle();
      if (matchLookupErr) throw matchLookupErr;
      if (existingMatch) {
        const { error: updErr } = await supabase.from('matches')
          .update({ last_action: actionText, last_action_at: nowIso })
          .eq('id', existingMatch.id);
        if (updErr) throw updErr;
        matchAction = 'updated';
        log('match_updated', { match_id: existingMatch.id });
      } else {
        const { data: newMatch, error: insErr } = await supabase.from('matches')
          .insert({
            business_id, buyer_id, status: 'חומרים מלאים נשלחו',
            match_source: 'אוטומטי - נשלחו קבצים במייל',
            last_action: actionText, last_action_at: nowIso, created_by: actorId,
          }).select('id').single();
        if (insErr) throw insErr;
        matchAction = 'created';
        log('match_created', { match_id: newMatch?.id });
      }
    } catch (me) {
      log('match_documentation_failed', { error: me instanceof Error ? me.message : String(me) });
    }

    return jsonResponse(200, { ok: true, match_action: matchAction });
  } catch (e) {
    log('unhandled_exception', { error: e instanceof Error ? e.message : String(e) });
    await logAttempt({ status: 'failed', reason: 'exception', error: e instanceof Error ? e.message : String(e) }, actorId, businessIdForLog);
    return jsonResponse(500, { error: e instanceof Error ? e.message : String(e) });
  }
});
