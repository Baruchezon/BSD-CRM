import { createClient } from 'npm:@supabase/supabase-js@2';

// The AI is shown only generic industry terms. Real identities and contact details
// are never sent to the image provider. BSD branding is added locally by the CRM.
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
};
function reply(value: unknown, code = 200) {
  return new Response(JSON.stringify(value), { headers, status: code });
}
function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
function safeIndustry(value: unknown) {
  return String(value || '').trim().slice(0, 85)
    .replace(/https?:\/\/\S+|www\.\S+|[\w.+-]+@[\w.-]+\.\w+|0\d{1,2}[-\s]?\d{7}/gi, '');
}
const scenes = [
  'wide documentary view of the workspace and real equipment',
  'a different wide angle showing the practical daily operation and atmosphere',
  'authentic team at work with non-identifiable people photographed from a distance',
  'distinctive close-to-mid-range professional details and tools with spatial context',
];

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return reply({ error: 'POST required' }, 405);
  try {
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!token) return reply({ error: 'נדרשת התחברות' }, 401);
    const { data: auth, error: authError } = await db.auth.getUser(token);
    if (authError || !auth.user) return reply({ error: 'נדרשת התחברות תקינה' }, 401);
    const { data: profile, error: profileError } = await db.from('profiles')
      .select('role,status').eq('id', auth.user.id).single();
    if (profileError || !profile || profile.status !== 'active' || !['admin', 'manager'].includes(profile.role)) {
      return reply({ error: 'אין הרשאת יצירת תמונות ציבוריות' }, 403);
    }

    const body = await req.json().catch(() => ({}));
    if (!isUuid(body.business_id)) return reply({ error: 'מזהה עסק לא תקין' }, 400);
    const variant = Number(body.variant_index);
    if (!Number.isInteger(variant) || variant < 0 || variant > 3) {
      return reply({ error: 'מספר וריאציה לא תקין' }, 400);
    }
    const { data: biz, error: bizError } = await db.from('businesses')
      .select('id,field,category,anon_display_name,listing_status,is_archived')
      .eq('id', body.business_id).maybeSingle();
    if (bizError || !biz) return reply({ error: 'העסק לא נמצא' }, 404);
    if (biz.listing_status !== 'active' || biz.is_archived) {
      return reply({ error: 'אפשר ליצור תמונת פרסום רק לעסק פעיל' }, 409);
    }
    const industry = safeIndustry((biz.field && biz.field !== 'עסק' ? biz.field : '') || (biz.category && biz.category !== 'עסק' ? biz.category : '') || 'עסק');
    if (!industry) return reply({ error: 'יש למלא תחום פעילות לפני יצירת תמונה' }, 400);
    const key = (Deno.env.get('OPENAI_API_KEY') || '').trim();
    if (!key) return reply({ error: 'מפתח OpenAI API אינו מוגדר בשרת. יצירת התמונות אינה זמינה כרגע.' }, 503);

    const userHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(auth.user.id));
    const identifier = Array.from(new Uint8Array(userHash)).map(v => v.toString(16).padStart(2, '0')).join('').slice(0, 64);
    const prompt = [
      'Produce ONE striking high-resolution, photorealistic landscape commercial photo that represents an',
      'anonymous Israeli small or medium business in this general sector: ' + industry + '.',
      'Show ' + scenes[variant] + '.',
      'Use authentic business surroundings, cinematic natural light, subtle navy and gold tonal accents.',
      'No fabricated branded products, no business identification, no identifiable people, no exact location.',
      'Absolutely NO logos, NO signs, NO captions, NO text, NO digits, NO watermarks and NO borders.',
      'No posing with suits. Avoid luxury stereotypes. Make it believable and attractive for a real business buyer.',
      'Keep ALL photo content contained in the frame. Composition should work in a landscape advert.'
    ].join(' ');
    const abort = AbortSignal.timeout(100000);
    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: (Deno.env.get('BSD_SITE_IMAGE_MODEL') || 'gpt-image-2.6-flare').trim(),
        prompt,
        n: 1,
        size: '1536x1024',
        quality: 'medium',
        output_format: 'jpeg',
        output_compression: 78,
        background: 'opaque',
        safety_identifier: identifier
      }),
      signal: abort,
    });
    if (!response.ok) {
      const errorText = (await response.text()).slice(0, 400);
      console.error('BSD image service error', response.status, errorText.replace(/[A-Za-z0-9_-]{40,}/g, '[redacted]'));
      return reply({ error: 'שירות יצירת התמונה אינו זמין כרגע', code: response.status }, 502);
    }
    const result = await response.json();
    const b64 = result?.data?.[0]?.b64_json;
    if (!b64 || typeof b64 !== 'string') {
      return reply({ error: 'לא התקבלה תמונה משירות היצירה' }, 502);
    }
    return reply({ ok: true, image_base64: b64, mime_type: 'image/jpeg', variant_index: variant });
  } catch (err) {
    console.error('BSD image generation failed:', (err instanceof Error ? err.message : String(err)).slice(0, 200));
    return reply({ error: 'יצירת התמונה נכשלה. ניתן לנסות שוב.' }, 500);
  }
});
