// BSD – summarise an answered EXM recording into an RTL PDF on the lead.
// verify_jwt = false. Auth is the same shared token as exm-sync (X-BSD-Token
// or the service-role bearer). EXM_API_KEY is read from vault via bsd_exm_secret.
// OPENAI_API_KEY and ANTHROPIC_API_KEY are the project secrets already used by
// analyze-meeting-audio (whisper-1, language=he, model claude-sonnet-5).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { buildSummaryPdf } from './pdf.ts';

const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(Deno.env.get('SUPABASE_URL')!, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });
const OPENAI_API_KEY = (Deno.env.get('OPENAI_API_KEY') || '').trim();
const ANTHROPIC_API_KEY = (Deno.env.get('ANTHROPIC_API_KEY') || '').trim();
const MODEL = 'claude-sonnet-5';
const WHISPER_USD_PER_MIN = 0.006;
const SONNET_IN_PER_M = 2;
const SONNET_OUT_PER_M = 10;
const MAX_AUDIO_BYTES = 24 * 1024 * 1024;

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

async function secret(name: string) {
  const env = Deno.env.get(name);
  if (env) return env;
  const { data } = await supabase.rpc('bsd_exm_secret', { p_name: name });
  return (data as string) ?? null;
}

function extractJson(raw: string): { points: string[] } {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  const parsed = JSON.parse(text) as { points?: unknown };
  const points = Array.isArray(parsed.points) ? parsed.points.map(p => String(p).trim()).filter(Boolean) : [];
  return { points };
}

function ilDate(iso: string | null): string {
  const d = iso ? new Date(iso) : new Date();
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(d);
  const get = (t: string) => parts.find(p => p.type === t)?.value || '';
  return `${get('day')}.${get('month')}.${get('year')}`;
}

async function recordingUrl(key: string, externalId: string): Promise<string> {
  const r = await fetch('https://api.exm.co.il/v1/calls/get-recording-urls/', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: [externalId], config: { ttl: 10 } }),
  });
  const body = await r.json().catch(() => null);
  const hit = body?.urls?.find((x: { id?: string }) => x.id === externalId);
  if (!hit || hit.code !== 0 || !hit.url) throw new Error('recording_not_ready');
  return hit.url as string;
}

async function transcribe(bytes: Uint8Array, filename: string): Promise<string> {
  const form = new FormData();
  form.append('file', new Blob([bytes]), filename);
  form.append('model', 'whisper-1');
  form.append('language', 'he');
  form.append('response_format', 'text');
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: form,
  });
  if (!res.ok) throw new Error(`whisper ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.text()).trim();
}

async function summarise(transcript: string): Promise<{ points: string[]; usage: { input_tokens: number; output_tokens: number } }> {
  const system = `אתה מסכם שיחת טלפון עבור משרד תיווך עסקים (BSD).
החזר אך ורק אובייקט JSON תקני, בלי טקסט לפניו או אחריו ובלי סימוני קוד, במבנה המדויק:
{"points":["נקודה","נקודה"]}

כללים:
- עברית מקצועית. רק עיקרי הדברים.
- רק מה שנאמר במפורש בתמלול. אסור להמציא שמות, מספרים, סכומים, כוונות או עובדות.
- אם פרט לא ברור, דלג עליו. בלי שיחת חולין ובלי להעתיק את התמלול.
- אם אין עיקרי דברים, החזר {"points":[]}.`;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1200,
      system,
      messages: [{ role: 'user', content: `תמלול השיחה:\n"""\n${transcript.slice(0, 80000)}\n"""` }],
    }),
  });
  if (!res.ok) throw new Error(`claude ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const text = (data.content || []).find((b: { type: string }) => b.type === 'text')?.text;
  if (!text) throw new Error('claude_empty');
  const usage = data.usage || {};
  return {
    points: extractJson(text).points,
    usage: { input_tokens: usage.input_tokens || 0, output_tokens: usage.output_tokens || 0 },
  };
}

async function fail(call: { id: string; summary_attempts: number }, message: string) {
  const status = (call.summary_attempts || 0) >= 3 ? 'error' : 'queued';
  await supabase.from('phone_calls').update({
    summary_status: status,
    last_error: message.slice(0, 500),
    updated_at: new Date().toISOString(),
  }).eq('id', call.id);
  await supabase.from('phone_call_audit').insert({
    phone_call_id: call.id, action: 'call_summary_error', details: { status, message: message.slice(0, 300) },
  });
  return { id: call.id, ok: false, status, error: message.slice(0, 300) };
}

async function processCall(call: Record<string, any>, key: string) {
  try {
    const titleDate = ilDate(call.started_at);
    const title = `סיכום הקלטת שיחה – ${titleDate}`;
    let transcript = (call.transcript || '').trim();
    let whisperUsd = 0;
    if (!transcript) {
      const url = await recordingUrl(key, call.external_call_id);
      const audio = await fetch(url);
      if (!audio.ok) throw new Error(`download ${audio.status}`);
      const buf = new Uint8Array(await audio.arrayBuffer());
      if (!buf.byteLength || buf.byteLength > MAX_AUDIO_BYTES) throw new Error(`audio_size ${buf.byteLength}`);
      const type = audio.headers.get('content-type') || '';
      const filename = /mpeg|mp3/i.test(type) ? 'call.mp3' : /wav/i.test(type) ? 'call.wav' : 'call.m4a';
      transcript = await transcribe(buf, filename);
      whisperUsd = ((call.duration_sec || 0) / 60) * WHISPER_USD_PER_MIN;
      await supabase.from('phone_calls').update({ transcript, updated_at: new Date().toISOString() }).eq('id', call.id);
    }
    if (!transcript) throw new Error('empty_transcript');
    const { points, usage } = await summarise(transcript);
    const pdf = await buildSummaryPdf(title, points);
    const docId = crypto.randomUUID();
    const storagePath = `leads/${call.lead_id}/${docId}.pdf`;
    const up = await supabase.storage.from('business-files').upload(storagePath, pdf, { contentType: 'application/pdf', upsert: false });
    if (up.error) throw new Error('upload ' + up.error.message);
    const displayName = `${title}.pdf`;
    const inserted = await supabase.from('lead_documents').insert({
      id: docId,
      lead_id: call.lead_id,
      phone_call_id: call.id,
      category: 'קובץ הקלטה',
      display_name: displayName,
      storage_path: storagePath,
      mime_type: 'application/pdf',
      file_size: pdf.byteLength,
    }).select('id').single();
    if (inserted.error) {
      await supabase.storage.from('business-files').remove([storagePath]);
      throw new Error('insert ' + inserted.error.message);
    }
    const anthropicUsd = (usage.input_tokens / 1e6) * SONNET_IN_PER_M + (usage.output_tokens / 1e6) * SONNET_OUT_PER_M;
    const costs = {
      whisper_seconds: call.duration_sec || 0,
      whisper_usd: Math.round(whisperUsd * 10000) / 10000,
      anthropic_model: MODEL,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      anthropic_usd: Math.round(anthropicUsd * 10000) / 10000,
      total_usd: Math.round((whisperUsd + anthropicUsd) * 10000) / 10000,
    };
    const saved = await supabase.from('phone_calls').update({
      summary_status: 'done',
      research_status: 'done',
      summary_doc_id: docId,
      last_error: null,
      updated_at: new Date().toISOString(),
    }).eq('id', call.id);
    if (saved.error) throw new Error('status ' + saved.error.message);
    await supabase.from('phone_call_audit').insert({
      phone_call_id: call.id, action: 'call_summary_done', details: { doc_id: docId, points, costs },
    });
    const signed = await supabase.storage.from('business-files').createSignedUrl(storagePath, 600);
    return { id: call.id, ok: true, status: 'done', title, points, costs, storage_path: storagePath, signed_url: signed.data?.signedUrl || null };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return await fail(call, message);
  }
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok');
  const token = await secret('EXM_WEBHOOK_TOKEN');
  const given = req.headers.get('x-bsd-token') ?? (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!given || !(given === token || given === SERVICE)) return json({ ok: false, error: 'unauthorized' }, 401);
  if (!OPENAI_API_KEY || !ANTHROPIC_API_KEY) return json({ ok: false, error: 'missing_model_keys' }, 500);
  const key = await secret('EXM_API_KEY');
  if (!key) return json({ ok: false, error: 'missing_api_key' }, 500);
  const opts = await req.json().catch(() => ({})) as { limit?: number };
  const limit = Math.max(1, Math.min(2, Number(opts.limit) || 1));
  const { data: claimed, error } = await supabase.rpc('bsd_claim_call_summary', { p_limit: limit });
  if (error) return json({ ok: false, error: error.message }, 500);
  const results = [];
  for (const call of claimed || []) results.push(await processCall(call, key));
  return json({ ok: results.every(r => r.ok), processed: results.length, results });
});
