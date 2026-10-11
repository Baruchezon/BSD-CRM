import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
if (!supabaseUrl || !serviceRoleKey) throw new Error('Supabase configuration is missing');
const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const allowedOrigins = new Set([
  'https://bsd-bbi.co.il',
  'https://www.bsd-bbi.co.il',
  'https://lively-wood-e2c6.baruch-ezon.workers.dev',
]);

function cors(origin: string | null) {
  return {
    'Access-Control-Allow-Origin': origin && allowedOrigins.has(origin) ? origin : 'https://www.bsd-bbi.co.il',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(origin), 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function clean(value: unknown, max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export function websiteLeadSide(purposes: string[], isTraining: boolean): 'seller' | 'buyer' | null {
  if (isTraining) return null;
  const joined = purposes.join(' ').toLowerCase();
  const sell = /למכור|sell/.test(joined);
  const buy = /לקנות|buy/.test(joined);
  if (sell && !buy) return 'seller';
  if (buy && !sell) return 'buyer';
  return null;
}

function escapeHtml(value: string) {
  const entities: Record<string, string> = {
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  };
  return value.replace(/[&<>'"]/g, character => entities[character] ?? character);
}

async function sendLeadNotification(values: {
  fullName: string;
  phone: string;
  email: string;
  city: string;
  purposes: string;
  message: string;
  preferredDate: string;
}): Promise<{ sent: boolean; error?: string }> {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  // 09.10.2026 (Baruch): all BSD system emails from «צוות BSD <info@bsd-bbi.co.il>», replies to info@.
  // The shared RESEND_FROM_EMAIL secret is no longer read.
  const from = 'צוות BSD <info@bsd-bbi.co.il>';
  if (!apiKey) {
    console.error('Lead notification email failed: missing Resend API key');
    return { sent: false, error: 'missing_email_configuration' };
  }

  const field = (label: string, value: string) =>
    `<p><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value || 'לא צוין')}</p>`;
  const html = `<div dir="rtl" lang="he"><h2>פנייה חדשה מאתר BSD</h2>${field('שם מלא', values.fullName)}${field('טלפון', values.phone)}${field('אימייל', values.email)}${field('עיר', values.city)}${field('מטרת הפנייה', values.purposes)}${field('הודעה', values.message)}${field('מועד מועדף לשיחה', values.preferredDate)}<div dir="rtl" style="margin-top:24px;padding-top:12px;border-top:1px solid #e3d9bf;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.6;color:#1f2d3d;text-align:right"><b>צוות BSD</b><br><span style="color:#8a6d1f">BSD Business Brokers Israel · מחברים עסקים להזדמנויות</span><br><span dir="ltr"><a href="mailto:info@bsd-bbi.co.il" style="color:#0f5ea8;text-decoration:none">info@bsd-bbi.co.il</a> | <a href="https://www.bsd-bbi.co.il/" style="color:#0f5ea8;text-decoration:none">www.bsd-bbi.co.il</a></span></div></div>`;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        from,
        reply_to: 'info@bsd-bbi.co.il',
        to: ['baruch.ezon@gmail.com'],
        subject: 'פנייה חדשה מאתר BSD',
        html,
      }),
    });
    if (!response.ok) {
      const detail = await response.text();
      console.error('Lead notification email failed', response.status, detail);
      return { sent: false, error: `resend_${response.status}` };
    }
    return { sent: true };
  } catch (error) {
    console.error('Lead notification email failed', error instanceof Error ? error.message : String(error));
    return { sent: false, error: 'email_request_failed' };
  }
}

Deno.serve(async req => {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405, origin);
  if (origin && !allowedOrigins.has(origin)) return json({ ok: false, error: 'origin_not_allowed' }, 403, origin);

  try {
    const body = await req.json();
    if (clean(body.website, 100)) return json({ ok: true }, 200, origin);

    const fullName = clean(body.name, 120);
    const phone = clean(body.phone, 40);
    const contactEmail = clean(body.email, 180).toLowerCase();
    const city = clean(body.city, 120);
    const message = clean(body.message, 2500);
    const preferredDate = clean(body.date, 20);
    const language = clean(body.language, 10) === 'en' ? 'en' : 'he';
    const purposes = Array.isArray(body.purpose)
      ? body.purpose.map((v: unknown) => clean(v, 100)).filter(Boolean).slice(0, 8)
      : [clean(body.purpose, 100)].filter(Boolean);

    if (!fullName || !phone || !contactEmail || !city) return json({ ok: false, error: 'missing_required_fields' }, 400, origin);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) return json({ ok: false, error: 'invalid_email' }, 400, origin);
    if (phone.replace(/\D/g, '').length < 9) return json({ ok: false, error: 'invalid_phone' }, 400, origin);

    const joined = purposes.join(' ').toLowerCase();
    const isTraining = /קורס|הכשר|training/.test(joined);
    const type = /למכור|sell/.test(joined) ? 'seller' : /שותף|השקע|partner|invest/.test(joined) ? 'partner' : 'buyer';
    const guess = isTraining ? 'מתעניין בהכשרת מתווכי עסקים'
      : type === 'seller' ? 'מעוניין למכור עסק'
      : type === 'partner' ? 'מעוניין בשותפות או השקעה'
      : /לקנות|buy/.test(joined) ? 'מחפש לקנות עסק'
      : 'דורש בדיקה';
    // 11.10.2026 (Baruch): «מוכר עסק» / «קונה עסק» badge in «לידים». Confirmed side only from the
    // explicit form purpose (never from the free-text message); both or neither -> null («לא ידוע»).
    const leadSide = websiteLeadSide(purposes, isTraining);

    const { data: admin } = await supabase.from('profiles').select('id').eq('email', 'baruch@bsd-bbi.co.il').maybeSingle();
    const adminId = admin?.id ?? null;
    const nameParts = fullName.split(/\s+/).filter(Boolean);
    const notes = `[פנייה ישירה מאתר BSD]\nמטרת הפנייה: ${purposes.join(', ') || 'לא נבחרה'}\nהודעה: ${message || 'לא נכתבה'}\nעיר: ${city}\nמועד מועדף: ${preferredDate || 'לא צוין'}\nשפה: ${language}`;

    const payload: Record<string, unknown> = {
      type,
      first_name: nameParts[0] || null,
      last_name: nameParts.slice(1).join(' ') || null,
      full_name: fullName,
      phone,
      email: contactEmail,
      city,
      source: 'אתר BSD החדש',
      status: isTraining ? 'חדש לטיפול' : 'חדש',
      notes,
      website_intake_stage: isTraining ? 'training' : 'new',
      website_purpose_guess: guess,
      created_by: adminId,
      handled_by: adminId,
      agreement_status: 'אין הסכם',
      lead_side: leadSide,
      lead_side_source: leadSide ? 'website_form' : null,
    };
    if (type === 'seller') payload.business_city = city;
    else payload.requested_area = city;

    const { data: lead, error } = await supabase.from('leads').insert(payload).select('id').single();
    if (error || !lead?.id) throw error ?? new Error('lead_not_created');

    const { data: verifiedLead, error: verifyError } = await supabase
      .from('leads').select('id').eq('id', lead.id).maybeSingle();
    if (verifyError || !verifiedLead?.id) throw verifyError ?? new Error('lead_not_verified');

    const { error: taskError } = await supabase.from('tasks').insert({
      title: isTraining ? `מתעניין חדש בהכשרה ממתין לטיפול ${fullName}` : `צור קשר עם ליד חדש מהאתר ${fullName}`,
      description: `מטרה: ${purposes.join(', ') || 'לא נבחרה'}\nטלפון: ${phone}\nמייל: ${contactEmail}\nהודעה: ${message || 'לא נכתבה'}`,
      priority: 'רגילה',
      assigned_to: adminId,
      status: 'פתוחה',
      related_type: 'lead',
      related_id: lead.id,
    });
    if (taskError) console.error('Task insert failed', taskError.message);

    await supabase.from('audit_log').insert({
      table_name: 'leads', record_id: lead.id, action: 'create', actor_id: adminId,
      details: { source: 'bsd_new_website', language, purposes },
    });

    const emailDelivery = await sendLeadNotification({
      fullName,
      phone,
      email: contactEmail,
      city,
      purposes: purposes.join(', '),
      message,
      preferredDate,
    });

    return json({ ok: true, leadId: lead.id, emailSent: emailDelivery.sent, emailError: emailDelivery.error ?? null }, 200, origin);
  } catch (error) {
    console.error('website-lead failed', error);
    return json({ ok: false, error: 'save_failed' }, 500, origin);
  }
});
