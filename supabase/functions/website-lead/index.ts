import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import {
  AlertValues, InquiryKind, alertBudget, alertHtml, alertSubject, alertText, businessUrlFromSitemap, clean,
  inquiryKind, isTestSubmission, leadTypeFor, normalizeBusinessNumber, oneLine, parseMessageContext,
  phone9, purposeGuess, safeHttpUrl, websiteLeadSide,
} from './logic.ts';

export { websiteLeadSide };

// 15.11.2026 lead audit (Baruch approved 15.11 08:28 via Roman), shipped in stages:
//  stage 1: alert email with the same subject as before. The body is the compact phone
//           list (name, phone, interests, Israel registration time, budget if any).
//           Reply-To is always info@. is_test submissions never email Baruch.
//  stage 2: CRM intake (business_id link, attach to existing client by phone, page/src stored,
//           «שאלה»/«אחר» not classified as buyer, website_lead_submissions log).
const INTAKE_V2 = true;

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
if (!supabaseUrl || !serviceRoleKey) throw new Error('Supabase configuration is missing');
const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const BARUCH_TO = 'baruch.ezon@gmail.com';
// Resend's sink address: accepted and "delivered" by Resend, reaches no mailbox.
const TEST_TO = 'delivered@resend.dev';
const MAIL_FROM = 'BSD - עסקים למכירה <info@bsd-bbi.co.il>';
const MAIL_REPLY_TO = 'info@bsd-bbi.co.il';
const SITE = 'https://www.bsd-bbi.co.il';
const CATALOG_URL = `${SITE}/%D7%A2%D7%A1%D7%A7%D7%99%D7%9D-%D7%9C%D7%9E%D7%9B%D7%99%D7%A8%D7%94/`;
const CRM_LEAD_URL = 'https://baruchezon.github.io/BSD-CRM/leads-hub.html?open=';

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

let sitemapCache: { at: number; xml: string } | null = null;
async function businessPageUrl(businessNumber: string): Promise<string> {
  if (!businessNumber) return '';
  try {
    if (!sitemapCache || Date.now() - sitemapCache.at > 10 * 60 * 1000) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3000);
      const r = await fetch(`${SITE}/sitemap.xml`, { signal: ctrl.signal });
      clearTimeout(timer);
      if (r.ok) sitemapCache = { at: Date.now(), xml: await r.text() };
    }
    return businessUrlFromSitemap(sitemapCache?.xml || '', businessNumber) || CATALOG_URL;
  } catch {
    return CATALOG_URL;
  }
}

async function sendAlert(to: string, values: AlertValues): Promise<{ sent: boolean; id?: string; error?: string }> {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  if (!apiKey) {
    console.error('Lead notification email failed: missing Resend API key');
    return { sent: false, error: 'missing_email_configuration' };
  }
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        from: MAIL_FROM,
        reply_to: MAIL_REPLY_TO,
        to: [to],
        subject: alertSubject({ kind: values.kind, businessNumber: values.businessNumber, fullName: values.fullName, isTest: values.isTest, repeat: !!values.repeatOf }),
        html: alertHtml(values),
        text: alertText(values),
      }),
    });
    const detail = await response.text();
    if (!response.ok) {
      console.error('Lead notification email failed', response.status, detail.slice(0, 300));
      return { sent: false, error: `resend_${response.status}: ${detail.slice(0, 200)}` };
    }
    let id = '';
    try { id = JSON.parse(detail)?.id || ''; } catch { /* ignore */ }
    return { sent: true, id };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('Lead notification email failed', msg);
    return { sent: false, error: `email_request_failed: ${msg.slice(0, 200)}` };
  }
}

type BusinessRow = { id: string; business_number: string | null; anon_display_name: string | null };
async function resolveBusiness(businessId: string, businessNumber: string, listingTitle: string): Promise<BusinessRow | null> {
  const cols = 'id, business_number, anon_display_name';
  if (/^[0-9a-f-]{36}$/i.test(businessId)) {
    const { data } = await supabase.from('businesses').select(cols).eq('id', businessId).maybeSingle();
    if (data) return data as BusinessRow;
  }
  if (businessNumber) {
    const { data } = await supabase.from('businesses').select(cols).eq('business_number', businessNumber).limit(2);
    if (data?.length === 1) return data[0] as BusinessRow;
  }
  if (listingTitle) {
    const { data } = await supabase.from('businesses').select(cols)
      .eq('anon_display_name', listingTitle).eq('is_archived', false).limit(2);
    if (data?.length === 1) return data[0] as BusinessRow;
  }
  return null;
}

type ExistingLead = { id: string; full_name: string | null; client_number: string | null; email: string | null; notes: string | null; type: string };
async function findExistingLead(p9: string, isTest: boolean): Promise<ExistingLead | null> {
  if (!p9) return null;
  // Same normalization as bsd_enforce_lead_dedupe (last 9 digits of phone or phone2), which
  // service_role skips. Test submissions only ever attach to is_test leads and vice versa.
  const { data, error } = await supabase.rpc('website_lead_find_by_phone9', { p_phone9: p9, p_is_test: isTest });
  if (error) { console.error('existing-lead lookup failed', error.message); return null; }
  const row = Array.isArray(data) ? data[0] : data;
  return row?.id ? row as ExistingLead : null;
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

    const isTest = isTestSubmission(body, fullName, contactEmail, message);
    const kind: InquiryKind = inquiryKind(purposes);
    const isTraining = kind === 'training';
    const type = INTAKE_V2 ? leadTypeFor(kind)
      : (/למכור|sell/.test(purposes.join(' ').toLowerCase()) ? 'seller' : /שותף|השקע|partner|invest/.test(purposes.join(' ').toLowerCase()) ? 'partner' : 'buyer');
    const guess = INTAKE_V2 ? purposeGuess(kind)
      : (isTraining ? 'מתעניין בהכשרת מתווכי עסקים' : type === 'seller' ? 'מעוניין למכור עסק' : type === 'partner' ? 'מעוניין בשותפות או השקעה' : /לקנות|buy/.test(purposes.join(' ').toLowerCase()) ? 'מחפש לקנות עסק' : 'דורש בדיקה');
    const leadSide = websiteLeadSide(purposes, isTraining);

    // Structured context: new payload fields first, then the lines the current form folds into «message».
    const ctx = parseMessageContext(message);
    // 15.11 finder: «business_numbers» = all listings shown to the visitor (first one is the primary business).
    const shownNumbers = [...new Set((Array.isArray(body.business_numbers) ? body.business_numbers : [])
      .slice(0, 10).map((x: unknown) => normalizeBusinessNumber(clean(x, 40))).filter(Boolean))].slice(0, 5) as string[];
    const businessNumber = normalizeBusinessNumber(clean(body.business_number, 40)) || ctx.businessNumber || shownNumbers[0] || '';
    const matchedNumbers = [...new Set([businessNumber, ...shownNumbers].filter(Boolean))];
    const listingTitle = oneLine(body.listing_title, 200) || ctx.listingTitle;
    const page = oneLine(body.page, 300);
    const src = oneLine(body.src, 120);
    const utm = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content']
      .map(k => oneLine(body[k], 120)).filter(Boolean).join(' / ') || ctx.sourceLine;
    const referrer = oneLine(body.referrer, 200) || ctx.referrer;
    const sourceText = [src && `src: ${src}`, utm && `מקור הגעה: ${utm}`, referrer && `הפניה: ${referrer}`].filter(Boolean).join(' · ');

    const { data: admin } = await supabase.from('profiles').select('id').eq('email', 'baruch@bsd-bbi.co.il').maybeSingle();
    const adminId = admin?.id ?? null;
    const nameParts = fullName.split(/\s+/).filter(Boolean);
    const today = new Date().toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem' });

    const business = INTAKE_V2 ? await resolveBusiness(clean(body.business_id, 40), businessNumber, listingTitle) : null;
    const existing = INTAKE_V2 ? await findExistingLead(phone9(phone), isTest) : null;

    const contextLines = INTAKE_V2
      ? [businessNumber && `מספר עסק: ${businessNumber}`, listingTitle && `שם עסק: ${listingTitle}`,
         matchedNumbers.length > 1 && `עסקים שהוצגו: ${matchedNumbers.join(', ')}`,
         page && `עמוד: ${page}`, sourceText && `מקור: ${sourceText}`].filter(Boolean).join('\n')
      : '';
    const notes = `[פנייה ישירה מאתר BSD]\nמטרת הפנייה: ${purposes.join(', ') || 'לא נבחרה'}\nהודעה: ${message || 'לא נכתבה'}\nעיר: ${city}\nמועד מועדף: ${preferredDate || 'לא צוין'}\nשפה: ${language}${contextLines ? `\n${contextLines}` : ''}`;

    let leadId: string;
    let repeatOf = '';
    if (existing) {
      // Attach to the existing client instead of opening a duplicate lead. Only fill gaps and
      // append the inquiry to the notes; nothing already on the card is overwritten.
      leadId = existing.id;
      repeatOf = [existing.full_name, existing.client_number].filter(Boolean).join(' · ') || 'כרטיס קיים';
      const patch: Record<string, unknown> = {
        notes: `${existing.notes ? `${existing.notes}\n\n` : ''}[פנייה חוזרת מאתר BSD ${today}]\nשם בטופס: ${fullName}\nמטרת הפנייה: ${purposes.join(', ') || 'לא נבחרה'}\nהודעה: ${ctx.original || 'לא נכתבה'}${contextLines ? `\n${contextLines}` : ''}`,
      };
      if (!existing.email) patch.email = contactEmail;
      const { error: upErr } = await supabase.from('leads').update(patch).eq('id', leadId);
      if (upErr) throw upErr;
      if (business?.id) await supabase.from('leads').update({ business_id: business.id }).eq('id', leadId).is('business_id', null);
      if (page || src) {
        await supabase.from('leads').update({ source_page: page || null, source_src: src || null }).eq('id', leadId).is('source_page', null).is('source_src', null);
      }
    } else {
      const payload: Record<string, unknown> = {
        type,
        first_name: nameParts[0] || null,
        last_name: nameParts.slice(1).join(' ') || null,
        full_name: isTest && !/is_test/i.test(fullName) ? `${fullName} (is_test)` : fullName,
        phone,
        email: contactEmail,
        city,
        source: isTest ? 'is_test' : 'אתר BSD החדש',
        status: isTest ? 'בדיקה' : isTraining ? 'חדש לטיפול' : 'חדש',
        notes,
        // is_test leads never enter the «new website lead» inbox/popup.
        website_intake_stage: isTest ? null : isTraining ? 'training' : 'new',
        website_purpose_guess: guess,
        created_by: adminId,
        handled_by: adminId,
        agreement_status: 'אין הסכם',
        lead_side: leadSide,
        lead_side_source: leadSide ? 'website_form' : null,
      };
      if (isTest) { payload.is_archived = true; payload.archive_reason = 'is_test'; payload.archived_at = new Date().toISOString(); }
      if (type === 'seller') payload.business_city = city;
      else payload.requested_area = city;
      if (INTAKE_V2) {
        payload.business_id = business?.id ?? null;
        payload.source_page = page || null;
        payload.source_src = src || null;
        payload.website_inquiry_kind = kind;
      }

      const { data: lead, error } = await supabase.from('leads').insert(payload).select('id').single();
      if (error || !lead?.id) throw error ?? new Error('lead_not_created');
      const { data: verifiedLead, error: verifyError } = await supabase
        .from('leads').select('id').eq('id', lead.id).maybeSingle();
      if (verifyError || !verifiedLead?.id) throw verifyError ?? new Error('lead_not_verified');
      leadId = lead.id;
    }

    if (INTAKE_V2 && matchedNumbers.length) {
      const { data: cur } = await supabase.from('leads').select('matched_business_numbers').eq('id', leadId).maybeSingle();
      const merged = [...new Set([...((cur?.matched_business_numbers as string[] | null) ?? []), ...matchedNumbers])];
      const { error: mErr } = await supabase.from('leads').update({ matched_business_numbers: merged }).eq('id', leadId);
      if (mErr) console.error('matched_business_numbers not stored', mErr.message);
    }

    if (!isTest) {
      const task: Record<string, unknown> = {
        title: existing ? `פנייה חוזרת מהאתר: ${fullName}`
          : isTraining ? `מתעניין חדש בהכשרה ממתין לטיפול ${fullName}` : `צור קשר עם ליד חדש מהאתר ${fullName}`,
        description: `מטרה: ${purposes.join(', ') || 'לא נבחרה'}\nטלפון: ${phone}\nמייל: ${contactEmail}\nהודעה: ${message || 'לא נכתבה'}`,
        priority: 'רגילה',
        assigned_to: adminId,
        status: 'פתוחה',
        related_type: 'lead',
        related_id: leadId,
      };
      if (INTAKE_V2 && business?.id) task.business_id = business.id;
      const { error: taskError } = await supabase.from('tasks').insert(task);
      if (taskError) console.error('Task insert failed', taskError.message);
    }

    await supabase.from('audit_log').insert({
      table_name: 'leads', record_id: leadId, action: existing ? 'website_repeat_inquiry' : 'create', actor_id: adminId,
      details: { source: 'bsd_new_website', language, purposes, kind, is_test: isTest, business_number: businessNumber || null,
        matched_business_numbers: matchedNumbers.length ? matchedNumbers : null,
        business_id: business?.id ?? null, page: page || null, src: src || null },
    });

    const values: AlertValues = {
      fullName, phone, email: contactEmail, city, purposes: purposes.join(', '), kind,
      // Request text only. Context lines (business id, listing, source, referrer) stay in the CRM notes.
      message: ctx.original, preferredDate, businessNumber, listingTitle,
      businessUrl: await businessPageUrl(businessNumber), businessFound: !INTAKE_V2 || !businessNumber || !!business,
      source: sourceText, page, crmUrl: CRM_LEAD_URL + leadId, repeatOf: repeatOf || undefined, isTest,
      budget: alertBudget(body), registeredAt: new Date().toISOString(),
    };
    const emailDelivery = await sendAlert(isTest ? TEST_TO : BARUCH_TO, values);
    const status = emailDelivery.sent ? (isTest ? 'skipped_test' : 'sent') : 'failed';
    const at = new Date().toISOString();
    const { error: statusErr } = await supabase.from('leads').update({
      website_alert_email_status: status,
      website_alert_email_at: at,
      website_alert_email_error: emailDelivery.sent ? null : (emailDelivery.error ?? 'unknown'),
      website_alert_email_id: emailDelivery.id || null,
    }).eq('id', leadId);
    if (statusErr) console.error('email status not stored', statusErr.message);

    if (INTAKE_V2) {
      const { error: subErr } = await supabase.from('website_lead_submissions').insert({
        lead_id: leadId, attached_existing: !!existing, is_test: isTest, kind, purposes,
        business_id: business?.id ?? null, business_number: businessNumber || null, listing_title: listingTitle || null,
        page: page || null, src: src || null, utm: utm || null, referrer: referrer || null, language,
        email_status: status, email_at: at, email_error: emailDelivery.sent ? null : (emailDelivery.error ?? 'unknown'),
        email_id: emailDelivery.id || null,
      });
      if (subErr) console.error('submission log not stored', subErr.message);
    }

    return json({ ok: true, leadId, attachedExisting: !!existing, emailSent: emailDelivery.sent, emailError: emailDelivery.error ?? null }, 200, origin);
  } catch (error) {
    console.error('website-lead failed', error);
    return json({ ok: false, error: 'save_failed' }, 500, origin);
  }
});
