// Website-only marketing copy for a public BSD business listing.
// This function never changes the shared anonymous summary used by other channels.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { localSafetyScan } from './lib.ts';

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
};
const reply = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return reply({ error: 'Only POST is supported' }, 405);

  try {
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!jwt) return reply({ error: 'נדרשת התחברות' }, 401);
    const { data: auth, error: authError } = await supabase.auth.getUser(jwt);
    if (authError || !auth.user) return reply({ error: 'אין התחברות תקינה' }, 401);

    const { data: profile, error: profileError } = await supabase.from('profiles')
      .select('role,status').eq('id', auth.user.id).single();
    if (profileError || !profile || profile.status !== 'active' || !['admin', 'manager'].includes(profile.role)) {
      return reply({ error: 'אין הרשאה לעריכת פרסום באתר' }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const businessId = typeof body.business_id === 'string' ? body.business_id.trim() : '';
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(businessId)) {
      return reply({ error: 'מספר עסק לא תקין' }, 400);
    }
    const action = body.action || 'save';
    if (!['save', 'reset', 'publish'].includes(action)) return reply({ error: 'פעולה לא מוכרת' }, 400);

    const { data: business, error: readError } = await supabase.from('businesses').select('*').eq('id', businessId).maybeSingle();
    if (readError || !business) return reply({ error: 'העסק לא נמצא' }, 404);
    let title: string | null = null;
    let marketingText: string | null = null;

    if (action === 'save' || action === 'publish') {
      title = typeof body.title === 'string' ? body.title.trim() : '';
      marketingText = typeof body.marketing_text === 'string' ? body.marketing_text.trim() : '';
      if (!title || !marketingText || title.length > 180 || marketingText.length > 6000) {
        return reply({ error: 'יש למלא כותרת ותיאור שיווקי באורך תקין' }, 400);
      }
      const issues = localSafetyScan(title + '\n' + marketingText, business);
      if (issues.length) {
        return reply({ error: 'זוהו פרטים שעלולים לחשוף את העסק. יש לערוך את המלל.', issues }, 422);
      }
    }

    if (action === 'publish') {
      if (business.listing_status !== 'active' || business.is_archived || business.crm_stage !== null) {
        return reply({ error: 'לא ניתן לפרסם עסק שאינו פעיל במאגר העסקים' }, 409);
      }
      if (!String(business.anon_summary || '').trim() || !String(business.anon_display_name || '').trim()) {
        return reply({ error: 'חסר תקציר אנונימי מאושר. יש לאשר אותו לפני הפרסום.' }, 409);
      }
      if (body.accepted_image_anonymity !== true) {
        return reply({ error: 'יש לאשר שהתמונה אינה מזהה את העסק לפני הפרסום' }, 400);
      }
      const path = String(business.public_listing_image_draft_path || business.public_listing_image_path || '');
      if (!/^public-listings\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(?:png|jpe?g|webp)$/i.test(path) ||
          !path.startsWith('public-listings/' + businessId + '/')) {
        return reply({ error: 'חסרה תמונה מאושרת עבור הפרסום באתר' }, 409);
      }
      if (typeof body.expected_image_path === 'string' && body.expected_image_path !== path) {
        return reply({ error: 'התמונה השתנתה מאז פתיחת הכרטיס. יש לפתוח אותו מחדש ולבדוק את התמונה לפני הפרסום.' }, 409);
      }
      const imageUrl = supabase.storage.from('site-content-images').getPublicUrl(path).data.publicUrl;
      try {
        const image = await fetch(imageUrl, { method: 'HEAD', signal: AbortSignal.timeout(6000) });
        if ([400, 404].includes(image.status) || (image.ok && !/^image\/(png|jpeg|webp)\b/i.test(image.headers.get('Content-Type') || ''))) {
          return reply({ error: 'התמונה שנבחרה חסרה או אינה תקינה. יש להעלות אותה מחדש וללחוץ על ״הפץ לאתר״.' }, 422);
        }
        if (!image.ok) throw new Error('Image check failed');
      } catch {
        return reply({ error: 'בדיקת התמונה לא זמינה כרגע. יש לנסות לפרסם שוב בעוד רגע.' }, 503);
      }
      // Promote only the image that was checked, even if another tab tries to replace it.
      let publication = supabase.from('businesses').update({
        public_listing_marketing_title: title,
        public_listing_marketing_text: marketingText,
        public_listing_image_path: path,
        public_listing_image_draft_path: null,
        anon_card_active: true,
        public_listing_active: true,
      }).eq('id', businessId);
      for (const column of ['public_listing_image_draft_path', 'public_listing_image_path']) {
        const savedPath = business[column];
        publication = savedPath === null ? publication.is(column, null) : publication.eq(column, savedPath);
      }
      const { data: published, error: publishError } = await publication.select('public_listing_active,public_listing_published_at').maybeSingle();
      if (publishError) return reply({ error: 'שמירת הפרסום נכשלה. אפשר לנסות שוב.' }, 500);
      if (!published) return reply({ error: 'התמונה השתנתה בזמן הפרסום. יש לפתוח את הכרטיס מחדש ולבדוק את התמונה.' }, 409);

      // The website is static. Dispatch an immediate safe rebuild if the secret is configured.
      // Never expose this token in the browser. Otherwise next scheduled refresh applies.
      let refresh = 'next_scheduled_refresh';
      const token = (Deno.env.get('BSD_WEBSITE_GITHUB_WORKFLOW_TOKEN') || '').trim();
      if (token) {
        try {
          const response = await fetch('https://api.github.com/repos/Baruchezon/bsd-bbi-website/actions/workflows/daily-public-listings.yml/dispatches', {
            method: 'POST',
            headers: {
              'Authorization': 'Bearer ' + token,
              'Accept': 'application/vnd.github+json',
              'X-GitHub-Api-Version': '2022-11-28',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ ref: 'main' }),
            signal: AbortSignal.timeout(10000),
          });
          refresh = response.ok ? 'workflow_queued' : 'next_scheduled_refresh';
        } catch (_e) {
          refresh = 'next_scheduled_refresh';
        }
      }
      return reply({ ok: true, published: true, refresh, published_at: published.public_listing_published_at });
    }

    const { data: saved, error: saveError } = await supabase.from('businesses')
      .update({ public_listing_marketing_title: title, public_listing_marketing_text: marketingText })
      .eq('id', businessId)
      .select('public_listing_marketing_title, public_listing_marketing_text')
      .single();
    if (saveError || !saved) return reply({ error: 'לא ניתן לשמור את המלל הציבורי' }, 500);
    return reply({ ok: true, title: saved.public_listing_marketing_title, marketing_text: saved.public_listing_marketing_text });
  } catch (err) {
    return reply({ error: 'שמירת הפרסום נכשלה' }, 500);
  }
});
