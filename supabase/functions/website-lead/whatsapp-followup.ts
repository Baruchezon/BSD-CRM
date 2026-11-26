// Automatic WhatsApp opening message (template bsd_lead_followup, from 077-444-6707) to a website lead.
// Rules (Baruch, 26.11.2026 + the consent rules set in Aug 2026):
//  * Only when the visitor ticked the dedicated, NOT pre-checked consent box on the website form
//    (payload field whatsapp_consent === true). Consent is never inferred from a phone number.
//  * Fail-closed flag WHATSAPP_LEAD_AUTOSEND must be exactly "true"; WHATSAPP_MODE still applies
//    (off = nothing is sent, dry_run = only the test numbers, live = real send).
//  * One opening message per lead per 30 days; an opted-out / suppressed phone is never messaged
//    (deliver() checks the removal list and the card's opt-out).
//  * Never breaks lead intake: every error is caught and only logged.
import { deliver, readConfig, toE164 } from '../_shared/whatsapp.ts';
import { createStore } from '../_shared/whatsapp-store.ts';
import { TEMPLATES } from '../_shared/whatsapp-templates.ts';
import type { InquiryKind } from './logic.ts';

export const LEAD_TEMPLATE = 'bsd_lead_followup';

export function wantsWhatsApp(body: Record<string, unknown> | null | undefined): boolean {
  const v = body?.whatsapp_consent;
  return v === true || v === 'true' || v === 'on' || v === '1' || v === 1;
}

export function autosendEnabled(env: (k: string) => string | undefined): boolean {
  return (env('WHATSAPP_LEAD_AUTOSEND') || '').trim() === 'true';
}

// {{2}} of bsd_lead_followup: «קיבלנו את הפנייה שלך בנושא {{2}}» (max 40 chars).
export function leadTopic(kind: InquiryKind): string {
  switch (kind) {
    case 'seller': return 'מכירת עסק';
    case 'buyer': return 'רכישת עסק';
    case 'mixed': return 'קנייה ומכירה של עסקים';
    case 'partner': return 'שותפות והשקעה בעסקים';
    case 'training': return 'הכשרת מתווכי עסקים';
    default: return 'עסקים למכירה';
  }
}

export function leadFirstName(fullName: string): string {
  const f = String(fullName || '').replace(/[\u0000-\u001f{}<>]/g, ' ').trim().split(/\s+/)[0] || '';
  return /\p{L}/u.test(f) ? f.slice(0, 30) : 'לקוח';
}

// deps are injectable for tests
export async function sendLeadFollowup(
  supabase: any, leadId: string, fullName: string, phone: string, kind: InquiryKind,
  deps: { env?: (k: string) => string | undefined; fetch?: typeof fetch; now?: Date; store?: any } = {},
): Promise<{ sent: boolean; reason: string }> {
  const env = deps.env || ((k: string) => Deno.env.get(k));
  try {
    if (!autosendEnabled(env)) return { sent: false, reason: 'autosend_off' };
    const cfg = readConfig(env);
    if (cfg.mode === 'off') return { sent: false, reason: 'mode_off' };
    const to = toE164(phone);
    if (!to) return { sent: false, reason: 'bad_phone' };

    // one opening message per lead per 30 days (any status except failed/refused)
    const since = new Date((deps.now || new Date()).getTime() - 30 * 86400_000).toISOString();
    const { data: prev } = await supabase.from('whatsapp_messages').select('id')
      .eq('lead_id', leadId).eq('template_name', LEAD_TEMPLATE).eq('direction', 'outbound')
      .not('status', 'in', '(failed,refused)').gte('created_at', since).limit(1);
    if (prev && prev.length) return { sent: false, reason: 'already_sent' };

    const store: any = deps.store || createStore(supabase);
    const record = await store.record('leads', leadId);
    if (!record) return { sent: false, reason: 'record_not_found' };
    const conversation = await store.conversation(to, { table: 'leads', id: leadId });
    const res = await deliver(cfg, store, deps.fetch || fetch, {
      kind: 'template', to, conversation, record, sentBy: null as any, requestId: crypto.randomUUID(),
      template: TEMPLATES[LEAD_TEMPLATE], values: [leadFirstName(fullName), leadTopic(kind)], purpose: 'website_lead_opening',
    } as any, deps.now || new Date());
    return { sent: !!res.ok, reason: res.ok ? 'sent' : String(res.error || 'not_sent') };
  } catch (e) {
    console.error('whatsapp lead followup failed', (e as Error).message);
    return { sent: false, reason: 'error' };
  }
}
