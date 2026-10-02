// Supabase Edge Function: match-suggestions-report (v5)
// 02.10.2026 security fix (approved by Baruch Ezon): caller must be a logged-in, active CRM user
// with role admin/manager, or with profiles.can_use_ai_match=true (same rule app.html uses to show
// the button). Previously the report (buyer names x business internal names) was returned to anyone
// holding the public key. Response format for authorized callers is unchanged.
// דוח הצעות התאמה - מציג את כל הצירופים (לא מסנן), עם צביעה לפי רמת התאמה:
// מתחת 50% לבן, 50-60% צהוב בהיר, מעל 60% כחול בהיר.
// השוואת מילים גמישה (מתעלמת מהבדלי כתיב עברי נפוצים).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;
const REPORT_KEY = 'match-suggestions-report';

const STOPWORDS = new Set(['של','עם','את','גם','לא','כן','זה','זו','אני','הוא','היא','יש','אין','על','אל','כל','או','אם','רק','כי','מה','עסק','קונה','מחפש','מחפשת','רוצה','רוצים']);

// נרמול מילה עברית - מתעלם מהבדלי כתיב נפוצים (יו"ד/וא"ו כפולה: מאפיה/מאפייה)
function normalizeWord(w: string): string {
  return w.replace(/(.)\1+/g, '$1');
}

function keywords(text: string | null): Set<string> {
  if (!text) return new Set();
  return new Set(
    text.toLowerCase().replace(/[^\u0590-\u05FFa-z0-9\s]/g, ' ').split(/\s+/)
      .filter(w => w.length > 2 && !STOPWORDS.has(w))
      .map(normalizeWord)
  );
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function jsonResponse(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
}

function tierColor(score: number): string {
  if (score > 60) return 'blue';
  if (score >= 50) return 'yellow';
  return 'white';
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
  try {
    const b = await req.json();
    sendEmail = b?.send_email === true;
  } catch (_e) { /* no/empty body */ }

  const { data: cfg } = await supabase
    .from('reports_config')
    .select('enabled, recipient_email')
    .eq('report_key', REPORT_KEY)
    .maybeSingle();

  if (sendEmail && cfg && cfg.enabled === false) {
    return jsonResponse({ skipped: true, reason: 'הדוח כבוי (enabled=false)' });
  }
  const reportToEmail = cfg?.recipient_email || 'baruch.ezon@gmail.com';

  const { data: buyers } = await supabase
    .from('leads')
    .select('id, full_name, city, requested_field, requested_area, requested_categories, budget, notes')
    .eq('type', 'buyer')
    .neq('status', 'סגור');

  const { data: businesses } = await supabase
    .from('businesses')
    .select('id, internal_name, field, category, subcategory, city, region, short_description, sale_reason, asking_price, notes')
    .eq('listing_status', 'active');

  const dateStr = new Date().toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem' });
  const suggestions: any[] = [];

  for (const b of buyers ?? []) {
    const buyerText = [b.requested_field, b.requested_categories, b.notes].filter(Boolean).join(' ');
    const buyerKw = keywords(buyerText);

    for (const biz of businesses ?? []) {
      let score = 0;
      const reasons: string[] = [];

      const bizText = [biz.field, biz.category, biz.subcategory, biz.short_description, biz.sale_reason, biz.notes].filter(Boolean).join(' ');
      const bizKw = keywords(bizText);

      const sharedWords = [...buyerKw].filter(w => bizKw.has(w));
      if (sharedWords.length > 0) {
        score += Math.min(sharedWords.length * 25, 65);
        reasons.push(`מילים זהות: ${sharedWords.slice(0,4).join(', ')}`);
      }

      if (b.requested_field && biz.field && normalizeWord(b.requested_field.trim().toLowerCase()) === normalizeWord(biz.field.trim().toLowerCase())) {
        score += 20; reasons.push('תחום זהה (שדה מובנה)');
      }

      if (b.city && biz.city) {
        if (normalizeWord(b.city.trim().toLowerCase()) === normalizeWord(biz.city.trim().toLowerCase())) {
          score += 15; reasons.push(`אותה עיר (${biz.city})`);
        } else {
          reasons.push(`ערים שונות (${b.city} מול ${biz.city})`);
        }
      }
      if (b.requested_area && biz.city && b.requested_area.includes(biz.city)) {
        score += 10; reasons.push('בתוך האזור המבוקש');
      }
      if (b.requested_area && biz.region && b.requested_area.includes(biz.region)) {
        score += 10; reasons.push('בתוך האזור המבוקש');
      }

      let financingNote = '';
      if (b.budget && biz.asking_price) {
        const ratio = biz.asking_price / b.budget;
        if (ratio <= 1.0) { score += 20; reasons.push('בתוך התקציב'); }
        else if (ratio <= 1.3) { score += 15; reasons.push('בטווח סטייה של 20-30% מהתקציב'); }
        else if (ratio <= 2.0) {
          score += 5;
          const gap = Math.round(biz.asking_price - b.budget);
          financingNote = `הפער מהתקציב (כ-${gap.toLocaleString('he-IL')} ₪) ניתן לבחינה מול אפשרות מימון/הלוואה`;
          reasons.push(financingNote);
        } else {
          reasons.push('מחוץ לתקציב באופן משמעותי');
        }
      }

      const finalScore = Math.min(score, 100);
      suggestions.push({
        buyer: b.full_name || '—',
        business: biz.internal_name || '—',
        score: finalScore,
        tier: tierColor(finalScore),
        reason: reasons.join(' | ') || 'אין נקודות התאמה משמעותיות',
        financing: !!financingNote
      });
    }
  }

  suggestions.sort((a, b) => b.score - a.score);

  const tierBg: Record<string,string> = { white: '#ffffff', yellow: '#fff8d6', blue: '#dbeeff' };
  const tierBadge: Record<string,string> = { white: '#e8e8e8;color:#666', yellow: '#f5d94e;color:#6b5a00', blue: '#8ec6f0;color:#0a3a5c' };

  const rows = suggestions.slice(0, 200).map(s => `
    <tr style="background:${tierBg[s.tier]};">
      <td style="padding:9px 12px;border-bottom:1px solid #eee;">${s.buyer}</td>
      <td style="padding:9px 12px;border-bottom:1px solid #eee;">${s.business}</td>
      <td style="padding:9px 12px;border-bottom:1px solid #eee;text-align:center;">
        <span style="display:inline-block;padding:3px 10px;border-radius:12px;font-weight:700;background:${tierBadge[s.tier]};">
          ${s.score}%
        </span>
        ${s.financing ? '<div style="font-size:10.5px;color:#8a5a10;margin-top:3px;">💰 אופציית מימון</div>' : ''}
      </td>
      <td style="padding:9px 12px;border-bottom:1px solid #eee;color:#555;font-size:12px;">${s.reason}</td>
    </tr>`).join('');

  const html = `
  <div dir="rtl" style="font-family:Arial,Helvetica,sans-serif;max-width:780px;margin:0 auto;">
    <div style="background:#0e1b34;color:#fff;padding:20px 24px;border-radius:10px 10px 0 0;">
      <div style="font-size:11px;letter-spacing:1px;color:#c9a24b;text-transform:uppercase;">BSD Business Brokers Israel</div>
      <h2 style="margin:6px 0 0;font-size:20px;">הצעות התאמה — ${dateStr}</h2>
    </div>
    <div style="border:1px solid #eee;border-top:none;border-radius:0 0 10px 10px;padding:20px 24px;">
      <p style="color:#555;font-size:14px;">${suggestions.length} צירופים נבדקו. צהוב = 50-60% התאמה, כחול = מעל 60%.</p>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead>
          <tr style="background:#f7f5ef;">
            <th style="padding:9px 12px;text-align:right;">קונה</th>
            <th style="padding:9px 12px;text-align:right;">עסק</th>
            <th style="padding:9px 12px;text-align:center;">אחוז התאמה</th>
            <th style="padding:9px 12px;text-align:right;">נימוק</th>
          </tr>
        </thead>
        <tbody>${rows || '<tr><td colspan="4" style="padding:14px;text-align:center;color:#999;">אין נתונים</td></tr>'}</tbody>
      </table>
      <p style="color:#999;font-size:11px;margin-top:24px;">ברוך איזון | BSD Business Brokers Israel | bsd-bbi.co.il</p>
    </div>
  </div>`;

  if (sendEmail) {
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'BSD CRM <onboarding@resend.dev>',
        to: [reportToEmail],
        subject: `הצעות התאמה - ${dateStr}`,
        html
      })
    });
    if (!emailRes.ok) {
      const errText = await emailRes.text();
      return jsonResponse({ error: errText, suggestions }, 500);
    }
  }

  return jsonResponse({ ok: true, count: suggestions.length, suggestions, emailed: sendEmail });
});
