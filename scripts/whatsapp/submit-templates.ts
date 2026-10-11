// Submit the 12 BSD WhatsApp templates to Meta (Graph API POST /<WABA_ID>/message_templates).
// DRY-RUN BY DEFAULT: prints the payloads and writes docs/whatsapp/templates.json. Nothing is sent unless --submit.
//
//   deno run -A scripts/whatsapp/submit-templates.ts                       # dry run (no network)
//   deno run -A scripts/whatsapp/submit-templates.ts --submit [--only=bsd_portal_access]
//
// Needs for --submit (environment, never committed):
//   WHATSAPP_WABA_ID            WhatsApp Business Account id
//   WHATSAPP_TOKEN              permanent System User token (whatsapp_business_management)
//   WHATSAPP_APP_ID             Meta App id (only for DOCUMENT header examples via the Resumable Upload API)
//   WHATSAPP_SHORT_LINK_BASE    fixed URL-button prefix, MUST equal the secret used by whatsapp-send
//   WHATSAPP_HEADER_SAMPLE_PDF  path to a sample PDF used as the DOCUMENT header example (default BSD-training-brochure.pdf)
import { DISPLAY_NAME, lintTemplate, submissionPayload, TEMPLATES } from '../../supabase/functions/_shared/whatsapp-templates.ts';

const args = new Set(Deno.args);
const submit = args.has('--submit');
const only = Deno.args.find(a => a.startsWith('--only='))?.slice(7).split(',');
const env = (k: string) => (Deno.env.get(k) || '').trim();
const ver = env('WHATSAPP_GRAPH_VERSION') || 'v23.0';
let base = env('WHATSAPP_SHORT_LINK_BASE') || 'https://zcdlegcvfirwzitfxjcs.supabase.co/functions/v1/go/';
if (!base.endsWith('/')) base += '/';

const defs = Object.values(TEMPLATES).filter(t => !only || only.includes(t.name));
const problems = defs.flatMap(t => lintTemplate(t).map(e => `${t.name}: ${e}`));
if (problems.length) { console.error(problems.join('\n')); Deno.exit(1); }

async function headerHandle(): Promise<string> {
  const appId = env('WHATSAPP_APP_ID'), token = env('WHATSAPP_TOKEN');
  if (!appId) throw new Error('WHATSAPP_APP_ID is required for DOCUMENT header templates');
  const file = await Deno.readFile(env('WHATSAPP_HEADER_SAMPLE_PDF') || 'BSD-training-brochure.pdf');
  const s = await fetch(`https://graph.facebook.com/${ver}/${appId}/uploads?file_name=sample.pdf&file_length=${file.length}&file_type=application/pdf&access_token=${encodeURIComponent(token)}`, { method: 'POST' });
  const sj = await s.json(); if (!sj.id) throw new Error('upload session failed: ' + JSON.stringify(sj));
  const u = await fetch(`https://graph.facebook.com/${ver}/${sj.id}`, { method: 'POST', headers: { Authorization: 'OAuth ' + token, file_offset: '0' }, body: file });
  const uj = await u.json(); if (!uj.h) throw new Error('upload failed: ' + JSON.stringify(uj));
  return uj.h;
}

const needsDoc = defs.some(t => t.header === 'DOCUMENT');
const handle = submit && needsDoc ? await headerHandle() : undefined;
const payloads = defs.map(t => submissionPayload(t, base, handle));

if (!submit) {
  await Deno.writeTextFile('docs/whatsapp/templates.json', JSON.stringify({ generated_from: 'supabase/functions/_shared/whatsapp-templates.ts', display_name: DISPLAY_NAME, short_link_base: base, templates: payloads }, null, 2) + '\n');
  console.log(`DRY RUN: ${payloads.length} templates linted OK, payloads written to docs/whatsapp/templates.json (nothing sent).`);
  Deno.exit(0);
}
const waba = env('WHATSAPP_WABA_ID'), token = env('WHATSAPP_TOKEN');
if (!waba || !token) { console.error('WHATSAPP_WABA_ID and WHATSAPP_TOKEN are required for --submit'); Deno.exit(1); }
for (const p of payloads) {
  const r = await fetch(`https://graph.facebook.com/${ver}/${waba}/message_templates`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(p) });
  const j = await r.json();
  console.log(p.name, r.status, j.id ? `id=${j.id} status=${j.status} category=${j.category}` : JSON.stringify(j.error || j));
}
