import assert from 'node:assert/strict';
import { lintTemplate, OPT_OUT_PAYLOAD, renderTemplateText, submissionPayload, TEMPLATE_FOOTER, TEMPLATES } from '../../supabase/functions/_shared/whatsapp-templates.ts';

Deno.test('templates: exactly the 12 planned Hebrew templates', () => {
  assert.equal(Object.keys(TEMPLATES).length, 12);
  for (const t of Object.values(TEMPLATES)) {
    assert.equal(t.language, 'he');
    assert.equal(t.footer, TEMPLATE_FOOTER);
    assert.equal(TEMPLATE_FOOTER, 'BSD Business Brokers Israel');
  }
});
Deno.test('templates: pass Meta lint (sequential vars, not at start/end, lengths, buttons)', () => {
  for (const t of Object.values(TEMPLATES)) assert.deepEqual(lintTemplate(t), [], t.name);
});
Deno.test('templates: no password, price, phone or raw URL in any body', () => {
  for (const t of Object.values(TEMPLATES)) {
    assert.ok(!/סיסמ|password/i.test(t.body), t.name);
    assert.ok(!/https?:\/\/|₪|\d{7,}/.test(t.body + t.params.map(p => p.example).join(' ')), t.name);
  }
});
Deno.test('templates: marketing = «פרסומת» first + removal button (spam law 30A)', () => {
  const mk = Object.values(TEMPLATES).filter(t => t.category === 'MARKETING');
  assert.deepEqual(mk.map(t => t.name).sort(), ['bsd_anon_offer', 'bsd_training_brochure']);
  for (const t of mk) { assert.ok(t.body.startsWith('פרסומת')); assert.ok(t.quickReplies.some(q => q.payload === OPT_OUT_PAYLOAD)); }
});
Deno.test('templates: agreement send uses a URL button (short link), never a long link', () => {
  const t = TEMPLATES.bsd_agreement_to_sign;
  assert.equal(t.urlButton?.text, 'לצפייה וחתימה');
  const p = submissionPayload(t, 'https://x.supabase.co/functions/v1/go/');
  const buttons = (p.components.find(c => c.type === 'BUTTONS') as any).buttons;
  assert.equal(buttons[0].url, 'https://x.supabase.co/functions/v1/go/{{1}}');
  assert.equal(buttons[0].example[0], 'https://x.supabase.co/functions/v1/go/Ab3kD9xQ');
});
Deno.test('templates: DOCUMENT header templates carry a header_handle example', () => {
  const p = submissionPayload(TEMPLATES.bsd_agreement_signed_copy, 'https://b/', '4::aGFuZGxl');
  assert.deepEqual(p.components[0], { type: 'HEADER', format: 'DOCUMENT', example: { header_handle: ['4::aGFuZGxl'] } });
  assert.equal(p.category, 'UTILITY');
  assert.equal(p.parameter_format, 'POSITIONAL');
});
Deno.test('templates: render text used for the CRM thread', () => {
  const s = renderTemplateText(TEMPLATES.bsd_agreement_to_sign, ['דני', 'מכירת עסק']);
  assert.ok(s.startsWith('שלום דני, הסכם ההתקשרות שלך עם BSD בנושא מכירת עסק'));
  assert.ok(s.endsWith('BSD Business Brokers Israel'));
});
