// BSD CRM - get-sale-files-signed-links Edge Function
//
// 03.09.2026: נוצר לפי הנחיה מפורשת - הוספת ערוץ שליחה נוסף (WhatsApp)
// לצד המייל הקיים במסך "שליחת חומרים לקונה" (תיק המכירה), בלי לשנות או
// לגעת ב-send-sale-files-to-buyer הקיים (שעובד עכשיו נכון, אחרי תיקון
// אמיתי) בשום צורה.
//
// למה פונקציה נפרדת ולא הרחבה של send-sale-files-to-buyer: ההנחיה המפורשת
// הייתה "אל תשנה ואל תיגע במנגנון שליחת המייל שעובד" - כל שינוי, אפילו
// אדיטיבי (פרמטר channel חדש וכו'), הוא סיכון מיותר לזרימה השברירית שזה
// עתה תוקנה. הפונקציה הזו עצמאית לגמרי: היא לא שולחת שום מייל, לא נוגעת
// ב-Resend בכלל - היא רק מייצרת קישורי הורדה חתומים, לשימוש ב-WhatsApp.
//
// כלל ההרשאה זהה בדיוק לזה שכבר קיים ונאכף ב-send-sale-files-to-buyer -
// קובץ חסוי (confidentiality_level=2) מותר רק לקונה עם הסכם סודיות חתום.
// הכלל נאכף כאן שוב, עצמאית, בשרת - לא רק שהלקוח מסנן אותו בממשק - כדי
// שגם קריאת API ישירה לא תעקוף את החסימה, בדיוק כמו בערוץ המייל.
//
// כל ניסיון (הצלחה/חסימה/כישלון) נרשם ל-audit_log הקיים, עם action
// נפרד ('get_whatsapp_links') כדי להבדיל מרישומי המייל.

import { createClient } from 'npm:@supabase/supabase-js@2';

const SIGNED_URL_SECONDS = 60 * 60 * 24 * 7; // שבוע - זהה לקבוע במייל
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

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout: ${label} לא הגיב תוך ${ms / 1000} שניות`)), ms);
    promise.then((v) => { clearTimeout(timer); resolve(v); },
                 (e) => { clearTimeout(timer); reject(e); });
  });
}

function log(step: string, details?: Record<string, unknown>) {
  console.log(`[get-sale-files-signed-links] ${step}`, details ? JSON.stringify(details) : '');
}

async function logAttempt(details: Record<string, unknown>, actorId: string | null, businessId: string) {
  try {
    await supabase.from('audit_log').insert({
      table_name: 'business_sale_files',
      record_id: businessId,
      action: 'get_whatsapp_links',
      actor_id: actorId,
      details,
    });
  } catch (_e) { /* לא חוסם */ }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders() });
  }

  let actorId: string | null = null;
  let businessIdForLog = '';

  try {
    log('start');
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

    const body = await req.json();
    const { business_id, buyer_id, file_ids } = body || {};
    businessIdForLog = business_id || '';

    if (!business_id || !buyer_id || !Array.isArray(file_ids) || !file_ids.length) {
      return jsonResponse(400, { error: 'חסרים שדות חובה: business_id, buyer_id, file_ids (רשימה לא ריקה)' });
    }

    // שליפת פרטי הקונה מה-DB בלבד (לא מהלקוח) - כולל agreement_status האמיתי
    const { data: buyer, error: buyerErr } = await supabase
      .from('leads')
      .select('id, full_name, first_name, last_name, phone, agreement_status')
      .eq('id', buyer_id)
      .eq('type', 'buyer')
      .maybeSingle();
    if (buyerErr) { log('buyer_lookup_error', { message: buyerErr.message }); return jsonResponse(500, { error: 'שגיאה בשליפת פרטי הקונה: ' + buyerErr.message }); }
    if (!buyer) { log('buyer_not_found'); return jsonResponse(404, { error: 'קונה לא נמצא' }); }
    const signed = buyer.agreement_status === 'יש הסכם חתום';

    // שליפת הקבצים מה-DB בלבד - מתעלמים משם/רמת סודיות שהלקוח שלח
    const { data: files, error: filesErr } = await supabase
      .from('business_sale_files')
      .select('id, file_name, storage_path, confidentiality_level')
      .eq('business_id', business_id)
      .eq('status', 'active')
      .in('id', file_ids);
    if (filesErr) { log('files_lookup_error', { message: filesErr.message }); return jsonResponse(500, { error: 'שגיאה בשליפת הקבצים: ' + filesErr.message }); }

    const foundIds = new Set((files || []).map((f) => f.id));
    const missing = file_ids.filter((id: string) => !foundIds.has(id));
    if (missing.length) {
      await logAttempt({ buyer_id, file_ids, missing_file_ids: missing, status: 'failed', reason: 'file_not_found_or_inactive' }, actorId, business_id);
      return jsonResponse(400, { error: 'קובץ אחד או יותר לא נמצא בתיק המכירה של העסק הזה (ייתכן שנמחק) - רענן ונסה שוב' });
    }

    // אותו כלל הרשאה בדיוק כמו במייל - נאכף שוב, עצמאית, בשרת
    const disallowed = (files || []).filter((f) => !signed && f.confidentiality_level === 2);
    if (disallowed.length) {
      await logAttempt({
        buyer_id, file_ids,
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

    // יצירת קישורי הורדה מאובטחים - נוצרים כאן, בשרת, ולעולם לא מתקבלים מהלקוח
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

    await logAttempt({
      buyer_id, file_ids, file_names: (files || []).map((f) => f.file_name),
      agreement_status_at_send: buyer.agreement_status || 'אין הסכם',
      performed_by: actorId, status: 'links_generated',
    }, actorId, business_id);

    log('done', { count: linkItems.length });
    return jsonResponse(200, { ok: true, links: linkItems, buyer_phone: buyer.phone || null });
  } catch (e) {
    log('unhandled_exception', { error: e instanceof Error ? e.message : String(e) });
    await logAttempt({ status: 'failed', reason: 'exception', error: e instanceof Error ? e.message : String(e) }, actorId, businessIdForLog);
    return jsonResponse(500, { error: e instanceof Error ? e.message : String(e) });
  }
});
