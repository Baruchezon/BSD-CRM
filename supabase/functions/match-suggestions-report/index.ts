// Supabase Edge Function: match-suggestions-report (v7)
// 05.10.2026 (בקשת ברוך) «התאמות AI חכמות»: המנוע עבר לקובץ engine.js (ניתוח מקומי, בלי שירות בתשלום).
//   * לומד את כל העסקים הפעילים ואת כל הקונים הפעילים (כולל הערות, תקציב מתוך טקסט, אזור, אונליין/מפעל)
//   * מחזיר רק צירופים חדשים (שאינם בטבלת matches) מעל 60%, עם הסבר בעברית פשוטה
//   * צירופים שכבר קיימים כהתאמה חוזרים בנפרד (already_matched) - לסימון "כבר הוצג" בלבד
//   * לא כותב שום דבר למסד הנתונים. פרטי קשר (טלפון/מייל) חוזרים רק למנהל/אדמין.
// 02.10.2026 security fix (approved by Baruch Ezon): caller must be a logged-in, active CRM user
// with role admin/manager, or with profiles.can_use_ai_match=true (same rule app.html uses to show
// the button). Previously the report (buyer names x business internal names) was returned to anyone
// holding the public key. Response format for authorized callers is unchanged.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { readAll, parseSelection, selectRecords, visiblePhones } from './selection.js';
import { buildSuggestions, decorateForClient, scopeBusinessesForAgent, ENGINE_VERSION, MIN_SCORE } from './engine.js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;
const REPORT_KEY = 'match-suggestions-report';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function jsonResponse(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
}

async function latestCallGists(supabase: any, buyerIds: string[]) {
  const gist = new Map<string, { gist: string, at: string }>();
  if (!buyerIds.length) return gist;
  try {
    for (let offset = 0; offset < buyerIds.length; offset += 80) {
      const chunk = buyerIds.slice(offset, offset + 80);
      const res = await readAll(() => supabase.from('phone_calls')
        .select('lead_id, started_at, ai_gist')
        .in('lead_id', chunk)
        .eq('is_test', false));
      if (res.error) return gist;
      for (const row of res.data || []) {
        const text = String(row.ai_gist || '').trim();
        if (!row.lead_id || !text) continue;
        const at = row.started_at || '';
        const prev = gist.get(row.lead_id);
        if (!prev || at > prev.at) gist.set(row.lead_id, { gist: text, at });
      }
    }
  } catch (_e) { /* ההתאמות מוצגות גם בלי תקציר שיחה */ }
  return gist;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // --- הרשאה: משתמש מחובר + פעיל + (admin/manager או can_use_ai_match) ---
  const authHeader = req.headers.get('Authorization') || '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwt || jwt.startsWith('sb_')) {
    return jsonResponse({ error: 'לא מחובר - נדרשת התחברות למערכת (רענן את הדף והתחבר מחדש)' }, 401);
  }
  const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
  if (userErr || !userData?.user) {
    return jsonResponse({ error: 'לא מחובר - נדרשת התחברות למערכת (רענן את הדף והתחבר מחדש)' }, 401);
  }
  const { data: callerProfile } = await supabase
    .from('profiles')
    .select('role, status, can_use_ai_match')
    .eq('id', userData.user.id)
    .maybeSingle();
  const fullAccess = !!callerProfile && ['admin', 'manager'].includes(callerProfile.role);
  const allowed = !!callerProfile && callerProfile.status === 'active' && (fullAccess || callerProfile.can_use_ai_match === true);
  if (!allowed) {
    return jsonResponse({ error: 'אין לך הרשאה להפיק הצעות התאמה' }, 403);
  }

  let sendEmail = false;
  let body: any = {};
  try {
    body = await req.json();
    sendEmail = body?.send_email === true;
  } catch (_e) { /* no/empty body */ }

  const selection = parseSelection(body);
  if (selection.error) return jsonResponse({ error: selection.error }, 400);

  const { data: cfg } = await supabase
    .from('reports_config')
    .select('enabled, recipient_email')
    .eq('report_key', REPORT_KEY)
    .maybeSingle();

  if (sendEmail && cfg && cfg.enabled === false) {
    return jsonResponse({ skipped: true, reason: 'הדוח כבוי (enabled=false)' });
  }
  const reportToEmail = cfg?.recipient_email || 'baruch.ezon@gmail.com';

  // --- קריאה בלבד: קונים פעילים, עסקים פעילים, התאמות קיימות, הפצות, הערות ---
  const [buyersRes, bizRes, matchesRes, distRes] = await Promise.all([
    readAll(() => supabase.from('leads')
      .select('id, client_number, full_name, phone, phone2, email, city, address, status, agreement_status, buyer_type, requested_field, requested_categories, requested_area, budget, equity, financing_capacity, requested_revenue, requested_profit, involvement_level, partnership_willingness, notes, meeting_summary, intake_customer_wants, intake_important_details, intake_conversation_summary')
      .eq('type', 'buyer')
      .or('status.is.null,status.neq.סגור')
      .or('is_archived.is.null,is_archived.eq.false')
      .is('crm_stage', null)), // 22.10.2026: לא כולל לקוחות בטיפול / שהוחזרו ללידים
    readAll(() => supabase.from('businesses')
      .select('id, business_number, id_number, internal_name, anon_display_name, field, category, subcategory, city, region, address, asking_price, annual_revenue, operating_profit, net_profit, employees_count, years_active, short_description, sale_reason, notes, anon_summary, internal_business_summary, website, owner_phone, anon_card_show_price, created_at, status, agreement_status')
      .eq('listing_status', 'active')
      .or('is_archived.is.null,is_archived.eq.false')
      .is('crm_stage', null)), // 22.10.2026: לא כולל לקוחות בטיפול / שהוחזרו ללידים
    readAll(() => supabase.from('matches').select('id, buyer_id, business_id, status, created_at')),
    readAll(() => supabase.from('anon_distributions').select('buyer_id, business_id, sent_at, created_at').not('buyer_id', 'is', null)),
  ]);
  const firstErr = buyersRes.error || bizRes.error || matchesRes.error || distRes.error;
  if (firstErr) return jsonResponse({ error: 'שגיאה בקריאת הנתונים: ' + firstErr.message }, 500);
  let buyers = buyersRes.data ?? [];
  let businesses = bizRes.data ?? [];
  // 06.10.2026: סוכן (לא אדמין/מנהל) - רק עסקים ששוחררו אליו, ובעסק אנונימי רק שדות אנונימיים.
  if (!fullAccess) {
    const levels: Record<string, string> = {};
    await Promise.all(businesses.map(async (b: any) => {
      const { data: lvl, error: lvlErr } = await supabase.rpc('get_business_access_level', { biz_id: b.id, uid: userData.user.id });
      levels[b.id] = lvlErr ? 'none' : String(lvl || 'none');
    }));
    businesses = scopeBusinessesForAgent(businesses, levels);
  }
  if (body?.action === 'options') {
    const matchCounts: Record<string, number> = {};
    for (const m of matchesRes.data ?? []) {
      if (m?.business_id) matchCounts[m.business_id] = (matchCounts[m.business_id] || 0) + 1;
    }
    return jsonResponse({ ok: true, engine_version: ENGINE_VERSION,
      buyers: buyers.map((b: any) => ({ id: b.id, name: b.full_name || 'קונה ללא שם', number: b.client_number || '', detail: [b.requested_field, b.requested_area].filter(Boolean).join(' · '), phones: visiblePhones(fullAccess, [b.phone, b.phone2]) })),
      businesses: businesses.map((b: any) => ({
        id: b.id, name: b.internal_name || b.anon_display_name || 'עסק ללא שם', number: b.business_number || '',
        id_number: b._anon_scope ? '' : (b.id_number || ''),
        detail: [b.field, b.city].filter(Boolean).join(' · '),
        field: String(b.field || b.category || '').trim(),
        created_at: b.created_at || '',
        status: b._anon_scope ? '' : (String(b.status || '').trim() || String(b.agreement_status || '').trim()),
        match_count: matchCounts[b.id] || 0,
        phones: visiblePhones(fullAccess && !b._anon_scope, [b.owner_phone]),
      })),
    });
  }
  const selected = selectRecords({ buyers, businesses }, selection);
  if (selected.error) return jsonResponse({ error: selected.error }, 404);
  buyers = selected.buyers;
  businesses = selected.businesses;
  // הערות פנימיות של עסק אנונימי לא נשלפות בכלל (ראו scopeBusinessesForAgent)
  const ids = [...buyers.map((b: any) => b.id), ...businesses.filter((b: any) => !b._anon_scope).map((b: any) => b.id)];
  let notes: any[] = [];
  if (ids.length) {
    for (let offset = 0; offset < ids.length; offset += 100) {
      const chunk = ids.slice(offset, offset + 100);
      const n = await readAll(() => supabase.from('record_notes').select('table_name, record_id, note_text, created_at').in('table_name', ['leads', 'businesses']).in('record_id', chunk));
      if (n.error) return jsonResponse({ error: 'שגיאה בקריאת הערות: ' + n.error.message }, 500);
      notes.push(...n.data);
    }
  }

  // כל הציון חוזר למסך, כדי שאפשר לסנן 75+ / 61–74 / 50–60 / מתחת ל-50 בלי קריאה נוספת.
  // המייל נשאר על הרף הקודם (61 ומעלה).
  const result = buildSuggestions({ buyers, businesses, matches: matchesRes.data ?? [], distributions: distRes.data ?? [], notes }, { minScore: 0 });
  const shownBuyerIds = [...new Set([...result.suggestions, ...result.already_matched].map((s: any) => s.buyer_id).filter(Boolean))];
  const callsByBuyer = fullAccess ? await latestCallGists(supabase, shownBuyerIds) : new Map();
  const suggestions = decorateForClient(result.suggestions, { buyers, businesses, fullAccess, notes, callsByBuyer });
  const alreadyMatched = decorateForClient(result.already_matched, { buyers, businesses, fullAccess, notes, callsByBuyer });

  const dateStr = new Date().toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem' });
  const mailSuggestions = suggestions.filter((s: any) => s.score >= MIN_SCORE);
  if (sendEmail) {
    const html = buildEmailHtml(mailSuggestions, result.stats, dateStr);
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'צוות BSD <info@bsd-bbi.co.il>', // 09.10.2026 (Baruch): all BSD system emails from info@
        reply_to: 'info@bsd-bbi.co.il',
        to: [reportToEmail],
        subject: `התאמות AI חכמות - ${dateStr} (${mailSuggestions.length} הצעות חדשות)`,
        html
      })
    });
    if (!emailRes.ok) {
      const errText = await emailRes.text();
      return jsonResponse({ error: errText, suggestions }, 500);
    }
  }

  return jsonResponse({
    ok: true, engine_version: ENGINE_VERSION, min_score: 0, generated_at: new Date().toISOString(),
    count: suggestions.length, stats: result.stats, suggestions, already_matched: alreadyMatched,
    contact_details: fullAccess, emailed: sendEmail, selection,
  });
});

const CRM_BASE = 'https://baruchezon.github.io/BSD-CRM/';
function escHtml(s: unknown) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c]);
}
function buildEmailHtml(list: any[], stats: any, dateStr: string) {
  const color = (lvl: string) => lvl === 'high' ? '#1e7b4f' : lvl === 'good' ? '#1d5fa8' : '#9a6a00';
  const rows = list.slice(0, 100).map(s => `
    <div style="border:1px solid #e8e3d4;border-radius:10px;padding:12px 14px;margin:10px 0;">
      <div style="font-weight:700;font-size:14px;">
        <span style="display:inline-block;min-width:44px;text-align:center;background:${color(s.level)};color:#fff;border-radius:12px;padding:2px 8px;margin-left:8px;">${s.score}%</span>
        <a href="${CRM_BASE}leads.html?open=${encodeURIComponent(s.buyer_id)}" style="color:#0e1b34;">${escHtml(s.buyer)}</a>
        ↔
        <a href="${CRM_BASE}businesses.html?open=${encodeURIComponent(s.business_id)}" style="color:#0e1b34;">${escHtml(s.business)}</a>
      </div>
      <div style="color:#333;font-size:13px;margin-top:6px;">${escHtml(s.summary)}</div>
      ${s.caveats.length ? `<div style="color:#8a5a10;font-size:12px;margin-top:6px;">לשים לב: ${s.caveats.slice(0, 3).map(escHtml).join(' · ')}</div>` : ''}
    </div>`).join('');
  return `
  <div dir="rtl" style="font-family:Arial,Helvetica,sans-serif;max-width:780px;margin:0 auto;">
    <div style="background:#0e1b34;color:#fff;padding:20px 24px;border-radius:10px 10px 0 0;">
      <div style="font-size:11px;letter-spacing:1px;color:#c9a24b;text-transform:uppercase;">BSD Business Brokers Israel</div>
      <h2 style="margin:6px 0 0;font-size:20px;">התאמות AI חכמות — ${dateStr}</h2>
    </div>
    <div style="border:1px solid #eee;border-top:none;border-radius:0 0 10px 10px;padding:20px 24px;">
      <p style="color:#555;font-size:14px;">נבדקו ${stats.buyers} קונים פעילים מול ${stats.businesses} עסקים פעילים. מוצגות רק הצעות חדשות (שעדיין אינן התאמה במערכת) מעל 60%: ${list.length} הצעות.</p>
      ${rows || '<p style="color:#999;">אין הצעות חדשות כרגע.</p>'}
      <div dir="rtl" style="margin-top:24px;padding-top:12px;border-top:1px solid #e3d9bf;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.6;color:#1f2d3d;text-align:right"><b>צוות BSD</b><br><span style="color:#8a6d1f">BSD Business Brokers Israel · מחברים עסקים להזדמנויות</span><br><span dir="ltr"><a href="mailto:info@bsd-bbi.co.il" style="color:#0f5ea8;text-decoration:none">info@bsd-bbi.co.il</a> | <a href="https://www.bsd-bbi.co.il/" style="color:#0f5ea8;text-decoration:none">www.bsd-bbi.co.il</a></span></div>
    </div>
  </div>`;
}
