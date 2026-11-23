// vip-file-stage-upload: uploads Yossi-approved anonymous teasers from public.vip_file_staging into Storage.
// Auth = single-use run token (only its sha256 stored in vip_file_stage_run_tokens, 10 min), issued and posted from
// inside Postgres by vip_file_stage_dispatch(). Same pattern as the bsd-alert-digest run_token. verify_jwt=false
// (like bsd-alert-digest and vip-draft-send); without a valid token every call is 403. Sends no email.
// Per row: sha256 + %PDF re-checked on the bytes -> upload business-files/<business_id>/sale-file/anonymous_summary/<ms>_<rand>.pdf
// (upsert:false; an existing object is accepted only if its bytes hash to the approved sha256) -> vip_file_stage_finish
// (object size check, new version row, portal_visible=false, vip_file_approve). Idempotent: uploaded rows are never claimed again.
import { createClient } from "npm:@supabase/supabase-js@2";

const BUCKET = "business-files";
const MAX_ROWS = 10;
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
export function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64.replace(/\s+/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function isPdf(b: Uint8Array): boolean {
  return b.length > 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d;
}
export function isSafePath(p: string, businessId: string): boolean {
  return new RegExp(`^${businessId}/sale-file/anonymous_summary/[0-9]{13}_[0-9a-f]{6}\\.pdf$`).test(p);
}

// deno-lint-ignore no-explicit-any
type Db = any;
// deno-lint-ignore no-explicit-any
export async function processRow(db: Db, row: any): Promise<Record<string, unknown>> {
  const fail = async (error: string) => {
    await db.rpc("vip_file_stage_finish", { p_id: row.id, p_ok: false, p_error: error });
    return { id: row.id, ok: false, error };
  };
  if (!/^[0-9a-f-]{36}$/.test(String(row.business_id)) || !isSafePath(String(row.storage_path), String(row.business_id))) return await fail("bad_path");
  const bytes = b64ToBytes(String(row.b64 || ""));
  if (bytes.length !== Number(row.size) || !isPdf(bytes)) return await fail("bad_bytes");
  if ((await sha256Hex(bytes)) !== row.sha256) return await fail("sha_mismatch");
  const up = await db.storage.from(BUCKET).upload(row.storage_path, bytes, { contentType: "application/pdf", upsert: false, cacheControl: "no-cache" });
  if (up.error) {
    // retry after a crash: the object may already be there. Accept it only if it is byte-identical.
    const dl = await db.storage.from(BUCKET).download(row.storage_path);
    const got = dl.data ? new Uint8Array(await dl.data.arrayBuffer()) : null;
    if (!got || (await sha256Hex(got)) !== row.sha256) return await fail(`upload_failed:${String(up.error.message || up.error).slice(0, 160)}`);
  }
  const fin = await db.rpc("vip_file_stage_finish", { p_id: row.id, p_ok: true, p_error: null });
  if (fin.error) return { id: row.id, ok: false, error: `finish_rpc:${fin.error.message}` };
  return { id: row.id, business_id: row.business_id, storage_path: row.storage_path, ...(fin.data || {}) };
}

export async function handle(req: Request, makeDb: () => Db): Promise<Response> {
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
  let body: { run_token?: unknown } = {};
  try { body = await req.json(); } catch { return json({ ok: false, error: "forbidden" }, 403); }
  const token = typeof body.run_token === "string" ? body.run_token : "";
  if (!/^[0-9a-f]{64}$/.test(token)) return json({ ok: false, error: "forbidden" }, 403);
  const db = makeDb();
  const t = await db.rpc("vip_file_stage_use_token", { p_token: token });
  if (t.error || t.data?.ok !== true) return json({ ok: false, error: "forbidden" }, 403);
  const report: Record<string, unknown>[] = [];
  try {
    for (let i = 0; i < MAX_ROWS; i++) {
      const c = await db.rpc("vip_file_stage_claim_next");
      if (c.error) { report.push({ ok: false, error: `claim_rpc:${c.error.message}` }); break; }
      if (c.data?.done) break;
      if (c.data?.skipped) { report.push({ id: c.data.skipped, ok: false, error: "max_attempts" }); continue; }
      report.push(await processRow(db, c.data));
    }
  } catch (e) {
    report.push({ ok: false, error: String(e instanceof Error ? e.message : e).slice(0, 200) });
  }
  console.log("vip_file_stage_upload", JSON.stringify(report.map(({ id, ok, error }) => ({ id, ok, error }))));
  return json({ ok: report.every((r) => r.ok !== false), report });
}

if (import.meta.main) {
  Deno.serve((req) =>
    handle(req, () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } }))
  );
}
