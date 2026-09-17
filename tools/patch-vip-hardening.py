from pathlib import Path


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f"Expected block not found: {label}")
    return text.replace(old, new, 1)

# 1. Migration hardening and session-duration tracking
p = Path('migrations/2026-09-17_vip_clients.sql')
s = p.read_text()
s = replace_once(s,
"  user_agent text,\n  ip_hint text\n);",
"  user_agent text,\n  ip_hint text,\n  active_seconds integer not null default 0 check (active_seconds between 0 and 86400)\n);",
"vip_sessions active_seconds")
s = replace_once(s,
"create index if not exists vip_sessions_expiry_idx on public.vip_sessions(expires_at);\n\ncreate table if not exists public.vip_business_publications",
"create index if not exists vip_sessions_expiry_idx on public.vip_sessions(expires_at);\n\ncreate table if not exists public.vip_login_attempts (\n  id bigserial primary key,\n  username text not null,\n  ip_hash text not null,\n  success boolean not null default false,\n  attempted_at timestamptz not null default now()\n);\n\ncreate index if not exists vip_login_attempts_guard_idx\n  on public.vip_login_attempts(username, ip_hash, attempted_at desc);\n\ncreate index if not exists vip_login_attempts_cleanup_idx\n  on public.vip_login_attempts(attempted_at);\n\ncreate table if not exists public.vip_business_publications",
"vip_login_attempts table")
s = replace_once(s,
"alter table public.vip_sessions enable row level security;\nalter table public.vip_business_publications enable row level security;",
"alter table public.vip_sessions enable row level security;\nalter table public.vip_login_attempts enable row level security;\nalter table public.vip_business_publications enable row level security;",
"login attempts RLS")
s = replace_once(s,
"revoke all on public.vip_sessions from anon, authenticated;\nrevoke all on public.vip_business_publications from anon, authenticated;",
"revoke all on public.vip_sessions from anon, authenticated;\nrevoke all on public.vip_login_attempts from anon, authenticated;\nrevoke all on public.vip_business_publications from anon, authenticated;",
"login attempts revoke")
s = s.replace("comment on table public.vip_accounts is 'BSD VIP buyer accounts. Password hashes only; plaintext passwords are never stored.';",
"comment on table public.vip_accounts is 'BSD VIP buyer accounts. Password hashes only; plaintext passwords are never stored.';\ncomment on table public.vip_login_attempts is 'Rate-limit audit for VIP login. Stores username plus one-way hash of network address, never the raw address.';")
p.write_text(s)

# 2. Edge API hardening, rate limiting, active time and richer activity labels
p = Path('supabase/functions/vip-api/index.ts')
s = p.read_text()
s = replace_once(s,
"const SESSION_IDLE_MINUTES = 60;\nconst PBKDF2_ITERATIONS = 210000;",
"const SESSION_IDLE_MINUTES = 60;\nconst LOGIN_WINDOW_MINUTES = 15;\nconst LOGIN_MAX_FAILURES = 8;\nconst PBKDF2_ITERATIONS = 210000;",
"login constants")
s = replace_once(s,
"function toBase64Url(bytes: Uint8Array) {",
"function makeTemporaryPassword() {\n  const upper = \"ABCDEFGHJKLMNPQRSTUVWXYZ\";\n  const lower = \"abcdefghijkmnopqrstuvwxyz\";\n  const digits = \"23456789\";\n  const chars = [randomString(1, upper), randomString(1, lower), randomString(1, digits)];\n  while (chars.length < 10) chars.push(randomString(1));\n  for (let i = chars.length - 1; i > 0; i--) {\n    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);\n    [chars[i], chars[j]] = [chars[j], chars[i]];\n  }\n  return chars.join(\"\");\n}\n\nfunction toBase64Url(bytes: Uint8Array) {",
"temporary password")
s = replace_once(s,
"async function hashPassword(password: string) {",
"async function clientIpHash(req: Request) {\n  const forwarded = req.headers.get(\"cf-connecting-ip\") || req.headers.get(\"x-forwarded-for\") || req.headers.get(\"x-real-ip\") || \"unknown\";\n  const raw = forwarded.split(\",\")[0].trim() || \"unknown\";\n  return sha256(raw);\n}\n\nasync function hashPassword(password: string) {",
"client IP hash")
s = replace_once(s,
'.select("id,vip_account_id,created_at,last_activity_at,expires_at,revoked_at")',
'.select("id,vip_account_id,created_at,last_activity_at,expires_at,revoked_at,active_seconds")',
"session active_seconds select")
s = replace_once(s,
"  if (!username || !password) return reply(req, 400, { ok: false, error: \"missing_credentials\" });\n\n  const { data: account }",
"  if (!username || !password) return reply(req, 400, { ok: false, error: \"missing_credentials\" });\n\n  const ipHash = await clientIpHash(req);\n  const cutoff = new Date(Date.now() - LOGIN_WINDOW_MINUTES * 60_000).toISOString();\n  const { count: recentFailures } = await supabase\n    .from(\"vip_login_attempts\")\n    .select(\"id\", { count: \"exact\", head: true })\n    .eq(\"username\", username)\n    .eq(\"ip_hash\", ipHash)\n    .eq(\"success\", false)\n    .gte(\"attempted_at\", cutoff);\n  if ((recentFailures || 0) >= LOGIN_MAX_FAILURES) {\n    await new Promise(r => setTimeout(r, 700));\n    return reply(req, 429, { ok: false, error: \"too_many_attempts\", message: \"בוצעו ניסיונות התחברות רבים מדי. נסה שוב מאוחר יותר או פנה ל BSD.\" });\n  }\n\n  const { data: account }",
"login rate limit precheck")
s = replace_once(s,
"  if (!account || account.status !== \"active\" || !(await verifyPassword(password, account.password_hash))) {\n    await new Promise(r => setTimeout(r, 450));\n    return reply(req, 401, { ok: false, error: \"invalid_credentials\", message: \"שם משתמש או סיסמה אינם נכונים\" });\n  }",
"  if (!account || account.status !== \"active\" || !(await verifyPassword(password, account.password_hash))) {\n    await supabase.from(\"vip_login_attempts\").insert({ username, ip_hash: ipHash, success: false });\n    await new Promise(r => setTimeout(r, 450));\n    return reply(req, 401, { ok: false, error: \"invalid_credentials\", message: \"שם משתמש או סיסמה אינם נכונים\" });\n  }\n\n  await supabase.from(\"vip_login_attempts\")\n    .delete()\n    .eq(\"username\", username)\n    .eq(\"ip_hash\", ipHash)\n    .eq(\"success\", false);",
"failed login audit")
s = s.replace("const temporaryPassword = randomString(10);", "const temporaryPassword = makeTemporaryPassword();")
s = replace_once(s,
"  if (next.length < 10 || next.length > 128) return reply(req, 400, { ok: false, error: \"weak_password\", message: \"הסיסמה החדשה חייבת להכיל לפחות 10 תווים\" });",
"  if (next.length < 10 || next.length > 128 || !/[A-Za-z]/.test(next) || !/[0-9]/.test(next)) return reply(req, 400, { ok: false, error: \"weak_password\", message: \"הסיסמה החדשה חייבת להכיל לפחות 10 תווים, אותיות ומספרים\" });",
"password strength")
s = replace_once(s,
"async function handleLogout(req: Request, auth: any) {",
"async function handleSessionTime(req: Request, auth: any, body: any) {\n  const delta = Math.floor(Number(body.duration_seconds || 0));\n  if (!Number.isFinite(delta) || delta < 1 || delta > 300) {\n    return reply(req, 400, { ok: false, error: \"invalid_duration\" });\n  }\n  const current = Math.max(0, Number(auth.session.active_seconds || 0));\n  const next = Math.min(86400, current + delta);\n  const { error } = await supabase.from(\"vip_sessions\").update({ active_seconds: next }).eq(\"id\", auth.session.id);\n  if (error) return reply(req, 500, { ok: false, error: \"session_time_failed\" });\n  return reply(req, 200, { ok: true, active_seconds: next });\n}\n\nasync function handleLogout(req: Request, auth: any) {",
"session time handler")
s = replace_once(s,
"  const { data: inquiries } = accountIds.length ? await supabase\n    .from(\"vip_inquiries\")\n    .select(\"id,vip_account_id,business_id,message,status,created_at,name_snapshot,phone_snapshot\")\n    .in(\"vip_account_id\", accountIds)\n    .order(\"created_at\", { ascending: false })\n    .limit(500) : { data: [] as any[] };",
"  const { data: inquiries } = accountIds.length ? await supabase\n    .from(\"vip_inquiries\")\n    .select(\"id,vip_account_id,business_id,message,status,created_at,name_snapshot,phone_snapshot\")\n    .in(\"vip_account_id\", accountIds)\n    .order(\"created_at\", { ascending: false })\n    .limit(500) : { data: [] as any[] };\n  const { data: sessions } = accountIds.length ? await supabase\n    .from(\"vip_sessions\")\n    .select(\"vip_account_id,active_seconds\")\n    .in(\"vip_account_id\", accountIds) : { data: [] as any[] };\n  const activityBusinessIds = [...new Set((events || []).map((e: any) => e.business_id).filter(Boolean))];\n  const { data: activityBusinesses } = activityBusinessIds.length ? await supabase\n    .from(\"businesses\")\n    .select(\"id,business_number,anon_display_name,anonymous_name\")\n    .in(\"id\", activityBusinessIds) : { data: [] as any[] };\n  const activityBusinessMap = new Map((activityBusinesses || []).map((b: any) => [b.id, b.anon_display_name || b.anonymous_name || b.business_number || \"עסק\"]));",
"admin sessions/business labels")
s = replace_once(s,
"  const inquiryMap = new Map<string, any[]>();\n  for (const q of inquiries || []) {",
"  const activeSeconds = new Map<string, number>();\n  for (const sess of sessions || []) activeSeconds.set(sess.vip_account_id, (activeSeconds.get(sess.vip_account_id) || 0) + Number(sess.active_seconds || 0));\n  const inquiryMap = new Map<string, any[]>();\n  for (const q of inquiries || []) {",
"admin active time map")
s = replace_once(s,
"        inquiries: (inquiryMap.get(a.id) || []).length\n      },\n      recent_activity: ev.slice(0, 20),",
"        inquiries: (inquiryMap.get(a.id) || []).length,\n        active_seconds: activeSeconds.get(a.id) || 0\n      },\n      recent_activity: ev.slice(0, 20).map((x: any) => ({ ...x, business_label: x.business_id ? activityBusinessMap.get(x.business_id) || null : null })),",
"admin stats active time")
s = replace_once(s,
"    if (action === \"change_password\") return await handleChangePassword(req, auth, body);\n    if (action === \"logout\") return await handleLogout(req, auth);",
"    if (action === \"change_password\") return await handleChangePassword(req, auth, body);\n    if (action === \"session_time\") return await handleSessionTime(req, auth, body);\n    if (action === \"logout\") return await handleLogout(req, auth);",
"session time route")
p.write_text(s)

# 3. VIP client active-time tracking
p = Path('../bsd-bbi-website/dist/assets/vip-client.js') if Path('../bsd-bbi-website/dist/assets/vip-client.js').exists() else None
# Website patching is intentionally handled in its own repository workflow.

# 4. Update isolated migration test expectations
p = Path('.github/scripts/test-vip-migration.sql')
s = p.read_text()
s = s.replace("'vip_accounts','vip_sessions','vip_business_publications','vip_interests','vip_inquiries','vip_activity_events','vip_admin_audit')", "'vip_accounts','vip_sessions','vip_login_attempts','vip_business_publications','vip_interests','vip_inquiries','vip_activity_events','vip_admin_audit')")
s = s.replace("if rls_count <> 7 then", "if rls_count <> 8 then")
s = s.replace("authenticated unexpectedly has SELECT on vip_accounts'; end if;", "authenticated unexpectedly has SELECT on vip_accounts'; end if;\n  select has_table_privilege('anon','public.vip_login_attempts','SELECT') into anon_priv;\n  if anon_priv then raise exception 'anon unexpectedly has SELECT on vip_login_attempts'; end if;")
p.write_text(s)
