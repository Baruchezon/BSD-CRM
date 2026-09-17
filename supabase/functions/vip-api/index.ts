import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const SESSION_MAX_HOURS = 12;
const SESSION_IDLE_MINUTES = 60;
const PBKDF2_ITERATIONS = 210000;
const PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789abcdefghijkmnopqrstuvwxyz";

const allowedOrigins = new Set([
  "https://bsd-bbi.co.il",
  "https://www.bsd-bbi.co.il",
  "https://baruchezon.github.io"
]);

function corsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  const allow = allowedOrigins.has(origin) || /^https:\/\/[-a-z0-9]+\.(workers\.dev|pages\.dev)$/i.test(origin);
  return {
    "Access-Control-Allow-Origin": allow ? origin : "https://www.bsd-bbi.co.il",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-vip-token",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  };
}

function reply(req: Request, status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(req) });
}

function cleanText(value: unknown, max = 1000) {
  return String(value ?? "").trim().slice(0, max);
}

function randomString(length: number, alphabet = PASSWORD_ALPHABET) {
  const bytes = crypto.getRandomValues(new Uint8Array(length * 2));
  let out = "";
  for (const b of bytes) {
    out += alphabet[b % alphabet.length];
    if (out.length === length) break;
  }
  return out;
}

function toBase64Url(bytes: Uint8Array) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function fromBase64Url(value: string) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((value.length + 3) % 4);
  const raw = atob(normalized);
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return toBase64Url(new Uint8Array(digest));
}

async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const material = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS },
    material,
    256
  );
  return `${PBKDF2_ITERATIONS}.${toBase64Url(salt)}.${toBase64Url(new Uint8Array(bits))}`;
}

async function verifyPassword(password: string, stored: string) {
  try {
    const [iterationsRaw, saltRaw, expectedRaw] = stored.split(".");
    const iterations = Number(iterationsRaw);
    if (!iterations || !saltRaw || !expectedRaw) return false;
    const material = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]
    );
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt: fromBase64Url(saltRaw), iterations },
      material,
      256
    );
    const actual = new Uint8Array(bits);
    const expected = fromBase64Url(expectedRaw);
    if (actual.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
    return diff === 0;
  } catch {
    return false;
  }
}

function tokenFromRequest(req: Request) {
  const explicit = req.headers.get("x-vip-token");
  if (explicit) return explicit.trim();
  const auth = req.headers.get("authorization") || "";
  if (auth.startsWith("VIP ")) return auth.slice(4).trim();
  return "";
}

async function logVipEvent(accountId: string, sessionId: string | null, eventType: string, extra: Record<string, unknown> = {}) {
  const row: Record<string, unknown> = {
    vip_account_id: accountId,
    session_id: sessionId,
    event_type: eventType,
    metadata: extra.metadata || {}
  };
  if (extra.business_id) row.business_id = extra.business_id;
  if (extra.file_id) row.file_id = extra.file_id;
  if (extra.duration_seconds !== undefined) row.duration_seconds = extra.duration_seconds;
  await supabase.from("vip_activity_events").insert(row);
}

async function authenticateVip(req: Request) {
  const token = tokenFromRequest(req);
  if (!token) return { error: "not_authenticated" as const };
  const tokenHash = await sha256(token);
  const { data: session } = await supabase
    .from("vip_sessions")
    .select("id,vip_account_id,created_at,last_activity_at,expires_at,revoked_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (!session || session.revoked_at) return { error: "invalid_session" as const };

  const now = Date.now();
  const expiresAt = new Date(session.expires_at).getTime();
  const lastActivity = new Date(session.last_activity_at).getTime();
  if (expiresAt <= now || now - lastActivity > SESSION_IDLE_MINUTES * 60_000) {
    await supabase.from("vip_sessions").update({ revoked_at: new Date().toISOString() }).eq("id", session.id);
    return { error: "session_expired" as const };
  }

  const { data: account } = await supabase
    .from("vip_accounts")
    .select("id,buyer_id,username,status,must_change_password")
    .eq("id", session.vip_account_id)
    .maybeSingle();
  if (!account || account.status !== "active") return { error: "account_blocked" as const };

  await supabase.from("vip_sessions").update({ last_activity_at: new Date().toISOString() }).eq("id", session.id);
  return { token, session, account };
}

async function authenticateAdmin(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return { error: "not_authenticated" as const };
  const { data: userData, error } = await supabase.auth.getUser(token);
  if (error || !userData.user) return { error: "not_authenticated" as const };
  const { data: profile } = await supabase
    .from("profiles")
    .select("id,full_name,role,status")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (!profile || profile.status !== "active" || !["admin", "manager"].includes(profile.role)) {
    return { error: "forbidden" as const };
  }
  return { user: userData.user, profile };
}

async function isPublishedBusiness(businessId: string) {
  const { data } = await supabase
    .from("vip_business_publications")
    .select("business_id,enabled,anonymous_file_id")
    .eq("business_id", businessId)
    .eq("enabled", true)
    .maybeSingle();
  return data || null;
}

async function handleLogin(req: Request, body: any) {
  const username = cleanText(body.username, 64).toUpperCase();
  const password = String(body.password ?? "");
  if (!username || !password) return reply(req, 400, { ok: false, error: "missing_credentials" });

  const { data: account } = await supabase
    .from("vip_accounts")
    .select("id,buyer_id,username,password_hash,status,must_change_password,login_count")
    .eq("username", username)
    .maybeSingle();
  if (!account || account.status !== "active" || !(await verifyPassword(password, account.password_hash))) {
    await new Promise(r => setTimeout(r, 450));
    return reply(req, 401, { ok: false, error: "invalid_credentials", message: "שם משתמש או סיסמה אינם נכונים" });
  }

  const rawToken = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = await sha256(rawToken);
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_MAX_HOURS * 3600_000);
  const userAgent = cleanText(req.headers.get("user-agent"), 300);

  const { data: session, error: sessionError } = await supabase
    .from("vip_sessions")
    .insert({
      vip_account_id: account.id,
      token_hash: tokenHash,
      expires_at: expires.toISOString(),
      user_agent: userAgent
    })
    .select("id")
    .single();
  if (sessionError) return reply(req, 500, { ok: false, error: "session_create_failed" });

  await supabase.from("vip_accounts").update({
    last_login_at: now.toISOString(),
    login_count: (account.login_count || 0) + 1
  }).eq("id", account.id);

  const { data: buyer } = await supabase
    .from("leads")
    .select("full_name,first_name,last_name,phone,client_number")
    .eq("id", account.buyer_id)
    .maybeSingle();

  await logVipEvent(account.id, session.id, "login");
  return reply(req, 200, {
    ok: true,
    token: rawToken,
    expires_at: expires.toISOString(),
    must_change_password: account.must_change_password,
    buyer: {
      name: buyer?.full_name || [buyer?.first_name, buyer?.last_name].filter(Boolean).join(" ") || "לקוח VIP",
      phone: buyer?.phone || "",
      client_number: buyer?.client_number || ""
    }
  });
}

async function handleMe(req: Request, auth: any) {
  const { data: buyer } = await supabase
    .from("leads")
    .select("full_name,first_name,last_name,phone,client_number")
    .eq("id", auth.account.buyer_id)
    .maybeSingle();
  return reply(req, 200, {
    ok: true,
    username: auth.account.username,
    must_change_password: auth.account.must_change_password,
    buyer: {
      name: buyer?.full_name || [buyer?.first_name, buyer?.last_name].filter(Boolean).join(" ") || "לקוח VIP",
      phone: buyer?.phone || "",
      client_number: buyer?.client_number || ""
    }
  });
}

async function handleBusinesses(req: Request, auth: any) {
  const { data: pubs } = await supabase
    .from("vip_business_publications")
    .select("business_id,anonymous_file_id,published_at")
    .eq("enabled", true)
    .order("published_at", { ascending: false, nullsFirst: false });
  const ids = (pubs || []).map((p: any) => p.business_id);
  if (!ids.length) return reply(req, 200, { ok: true, businesses: [] });

  const { data: businesses } = await supabase
    .from("businesses")
    .select("id,anonymous_name,anon_display_name,anon_summary,field,category,created_at")
    .in("id", ids)
    .eq("is_archived", false);

  const { data: interests } = await supabase
    .from("vip_interests")
    .select("business_id,interested")
    .eq("vip_account_id", auth.account.id)
    .eq("interested", true);
  const interested = new Set((interests || []).map((x: any) => x.business_id));
  const pubById = new Map((pubs || []).map((p: any) => [p.business_id, p]));

  const safe = (businesses || []).map((b: any) => ({
    id: b.id,
    name: b.anon_display_name || b.anonymous_name || "הזדמנות עסקית",
    description: b.anon_summary || "",
    field: b.field || "",
    category: b.category || "",
    published_at: pubById.get(b.id)?.published_at || null,
    has_document: !!pubById.get(b.id)?.anonymous_file_id,
    interested: interested.has(b.id)
  }));
  safe.sort((a: any, b: any) => String(b.published_at || "").localeCompare(String(a.published_at || "")));
  return reply(req, 200, { ok: true, businesses: safe });
}

async function handleBusinessView(req: Request, auth: any, body: any) {
  const businessId = cleanText(body.business_id, 80);
  if (!(await isPublishedBusiness(businessId))) return reply(req, 404, { ok: false, error: "business_not_available" });
  await logVipEvent(auth.account.id, auth.session.id, "business_view", { business_id: businessId });
  return reply(req, 200, { ok: true });
}

async function handleInterest(req: Request, auth: any, body: any) {
  const businessId = cleanText(body.business_id, 80);
  const interested = body.interested !== false;
  if (!(await isPublishedBusiness(businessId))) return reply(req, 404, { ok: false, error: "business_not_available" });

  await supabase.from("vip_interests").upsert({
    vip_account_id: auth.account.id,
    business_id: businessId,
    interested,
    first_marked_at: new Date().toISOString()
  }, { onConflict: "vip_account_id,business_id" });

  await logVipEvent(auth.account.id, auth.session.id, interested ? "interest_marked" : "interest_removed", { business_id: businessId });

  if (interested) {
    const { data: existing } = await supabase
      .from("matches")
      .select("id")
      .eq("buyer_id", auth.account.buyer_id)
      .eq("business_id", businessId)
      .maybeSingle();
    if (!existing) {
      await supabase.from("matches").insert({
        buyer_id: auth.account.buyer_id,
        business_id: businessId,
        status: "מתעניין",
        buyer_response: "מעניין אותי דרך אזור BSD VIP",
        match_source: "BSD VIP",
        disclosure_level: 1,
        last_action: "סימון מעניין אותי באזור VIP",
        last_action_at: new Date().toISOString()
      });
    }
  }
  return reply(req, 200, { ok: true, interested });
}

async function handleInquiry(req: Request, auth: any, body: any) {
  const businessId = cleanText(body.business_id, 80);
  if (!(await isPublishedBusiness(businessId))) return reply(req, 404, { ok: false, error: "business_not_available" });

  const name = cleanText(body.name, 120);
  const phone = cleanText(body.phone, 40);
  const message = cleanText(body.message, 2000);
  if (!name || !phone) return reply(req, 400, { ok: false, error: "name_phone_required" });

  const { data: inquiry, error } = await supabase.from("vip_inquiries").insert({
    vip_account_id: auth.account.id,
    buyer_id: auth.account.buyer_id,
    business_id: businessId,
    name_snapshot: name,
    phone_snapshot: phone,
    message,
    source: "BSD VIP"
  }).select("id").single();
  if (error) return reply(req, 500, { ok: false, error: "inquiry_failed" });

  const { data: buyer } = await supabase
    .from("leads")
    .select("handled_by,created_by")
    .eq("id", auth.account.buyer_id)
    .maybeSingle();

  let { data: match } = await supabase
    .from("matches")
    .select("id")
    .eq("buyer_id", auth.account.buyer_id)
    .eq("business_id", businessId)
    .maybeSingle();
  if (!match) {
    const created = await supabase.from("matches").insert({
      buyer_id: auth.account.buyer_id,
      business_id: businessId,
      status: "מתעניין",
      buyer_response: message || "בקשת פרטים נוספים דרך BSD VIP",
      match_source: "BSD VIP",
      disclosure_level: 1,
      last_action: "פניית VIP לקבלת פרטים נוספים",
      last_action_at: new Date().toISOString()
    }).select("id").single();
    match = created.data;
  }

  if (match?.id) {
    await supabase.from("match_activity_log").insert({
      match_id: match.id,
      action_type: "vip_inquiry",
      description: `פניית VIP לקבלת פרטים נוספים${message ? `: ${message}` : ""}`,
      buyer_response: message || null
    });
  }

  await supabase.from("tasks").insert({
    title: "פניית VIP חדשה",
    description: `לקוח VIP ביקש פרטים נוספים על עסק. ${message || ""}`.trim(),
    related_type: "buyer",
    related_id: auth.account.buyer_id,
    buyer_id: auth.account.buyer_id,
    business_id: businessId,
    match_id: match?.id || null,
    assigned_to: buyer?.handled_by || buyer?.created_by || null,
    due_date: new Date().toISOString().slice(0, 10),
    priority: "גבוהה",
    source: "vip"
  });

  await logVipEvent(auth.account.id, auth.session.id, "inquiry_sent", {
    business_id: businessId,
    metadata: { inquiry_id: inquiry.id }
  });
  return reply(req, 200, { ok: true, inquiry_id: inquiry.id });
}

async function handleDocumentUrl(req: Request, auth: any, body: any) {
  const businessId = cleanText(body.business_id, 80);
  const mode = body.mode === "download" ? "download" : "view";
  const publication = await isPublishedBusiness(businessId);
  if (!publication?.anonymous_file_id) return reply(req, 404, { ok: false, error: "document_not_available" });

  const { data: file } = await supabase
    .from("business_sale_files")
    .select("id,business_id,storage_path,file_name,file_type,status,confidentiality_level,document_type")
    .eq("id", publication.anonymous_file_id)
    .maybeSingle();

  const safe = file && file.business_id === businessId && file.status === "active" &&
    file.confidentiality_level === 1 && file.document_type === "anonymous_summary";
  if (!safe) return reply(req, 403, { ok: false, error: "unsafe_document_blocked" });

  const { data, error } = await supabase.storage.from("business-files").createSignedUrl(file.storage_path, 300, {
    download: mode === "download" ? (file.file_name || true) : undefined
  });
  if (error || !data?.signedUrl) return reply(req, 500, { ok: false, error: "signed_url_failed" });

  await logVipEvent(auth.account.id, auth.session.id, mode === "download" ? "document_download" : "document_view", {
    business_id: businessId,
    file_id: file.id
  });
  return reply(req, 200, { ok: true, url: data.signedUrl, expires_in: 300 });
}

async function handleChangePassword(req: Request, auth: any, body: any) {
  const current = String(body.current_password ?? "");
  const next = String(body.new_password ?? "");
  if (next.length < 10 || next.length > 128) return reply(req, 400, { ok: false, error: "weak_password", message: "הסיסמה החדשה חייבת להכיל לפחות 10 תווים" });
  const { data: full } = await supabase.from("vip_accounts").select("password_hash").eq("id", auth.account.id).single();
  if (!full || !(await verifyPassword(current, full.password_hash))) return reply(req, 401, { ok: false, error: "wrong_current_password" });
  const passwordHash = await hashPassword(next);
  await supabase.from("vip_accounts").update({ password_hash: passwordHash, must_change_password: false }).eq("id", auth.account.id);
  await supabase.from("vip_sessions").update({ revoked_at: new Date().toISOString() }).eq("vip_account_id", auth.account.id).neq("id", auth.session.id).is("revoked_at", null);
  await logVipEvent(auth.account.id, auth.session.id, "password_changed");
  return reply(req, 200, { ok: true });
}

async function handleLogout(req: Request, auth: any) {
  await logVipEvent(auth.account.id, auth.session.id, "logout");
  await supabase.from("vip_sessions").update({ revoked_at: new Date().toISOString() }).eq("id", auth.session.id);
  return reply(req, 200, { ok: true });
}

function buyerUsername(lead: any) {
  const raw = lead.client_number_running ?? lead.client_number ?? "";
  const digits = String(raw).replace(/\D/g, "");
  if (!digits) return "";
  return `VIP${digits.slice(-4)}`.toUpperCase();
}

async function auditAdmin(action: string, profileId: string, refs: Record<string, unknown>) {
  await supabase.from("vip_admin_audit").insert({
    action,
    actor_id: profileId,
    vip_account_id: refs.vip_account_id || null,
    buyer_id: refs.buyer_id || null,
    business_id: refs.business_id || null,
    details: refs.details || {}
  });
}

async function handleAdminEnableBuyer(req: Request, admin: any, body: any) {
  const buyerId = cleanText(body.buyer_id, 80);
  const { data: lead } = await supabase
    .from("leads")
    .select("id,type,full_name,phone,client_number,client_number_running,agreement_status,agreement_sent,agreement_signed")
    .eq("id", buyerId)
    .maybeSingle();
  if (!lead || lead.type !== "buyer") return reply(req, 404, { ok: false, error: "buyer_not_found" });
  const eligible = ["נשלח הסכם לחתימה", "יש הסכם חתום"].includes(lead.agreement_status) || lead.agreement_sent || lead.agreement_signed;
  if (!eligible) return reply(req, 409, { ok: false, error: "agreement_required", message: "ניתן לפתוח VIP רק לאחר שנשלח הסכם לקונה" });

  const { data: existing } = await supabase.from("vip_accounts").select("id,username,status").eq("buyer_id", buyerId).maybeSingle();
  if (existing && existing.status !== "deleted") return reply(req, 200, { ok: true, already_exists: true, account: existing });

  const username = buyerUsername(lead);
  if (!username) return reply(req, 409, { ok: false, error: "buyer_number_missing", message: "לא ניתן ליצור שם משתמש VIP ללא מספר קונה תקין" });
  const { data: sameUsername } = await supabase.from("vip_accounts").select("id,buyer_id").eq("username", username).neq("buyer_id", buyerId).maybeSingle();
  if (sameUsername) return reply(req, 409, { ok: false, error: "username_conflict", message: "שם המשתמש שנגזר ממספר הקונה כבר קיים. לא בוצע שינוי אוטומטי." });

  const temporaryPassword = randomString(10);
  const passwordHash = await hashPassword(temporaryPassword);
  let account: any;
  if (existing) {
    const res = await supabase.from("vip_accounts").update({
      username,
      password_hash: passwordHash,
      status: "active",
      must_change_password: true,
      blocked_at: null,
      blocked_by: null,
      deleted_at: null,
      deleted_by: null
    }).eq("id", existing.id).select("id,buyer_id,username,status,created_at").single();
    account = res.data;
  } else {
    const res = await supabase.from("vip_accounts").insert({
      buyer_id: buyerId,
      username,
      password_hash: passwordHash,
      status: "active",
      must_change_password: true,
      created_by: admin.profile.id
    }).select("id,buyer_id,username,status,created_at").single();
    account = res.data;
  }
  if (!account) return reply(req, 500, { ok: false, error: "account_create_failed" });
  await auditAdmin("vip_enable_buyer", admin.profile.id, { vip_account_id: account.id, buyer_id: buyerId });
  return reply(req, 200, {
    ok: true,
    account,
    temporary_password: temporaryPassword,
    buyer: { name: lead.full_name || "", phone: lead.phone || "" }
  });
}

async function handleAdminList(req: Request) {
  const { data: accounts } = await supabase
    .from("vip_accounts")
    .select("id,buyer_id,username,status,must_change_password,created_at,last_login_at,login_count,blocked_at")
    .neq("status", "deleted")
    .order("created_at", { ascending: false });
  const buyerIds = (accounts || []).map((a: any) => a.buyer_id);
  const { data: buyers } = buyerIds.length ? await supabase
    .from("leads")
    .select("id,full_name,phone,client_number,agreement_status")
    .in("id", buyerIds) : { data: [] as any[] };
  const buyerMap = new Map((buyers || []).map((b: any) => [b.id, b]));

  const accountIds = (accounts || []).map((a: any) => a.id);
  const { data: events } = accountIds.length ? await supabase
    .from("vip_activity_events")
    .select("vip_account_id,event_type,duration_seconds,created_at,business_id,file_id")
    .in("vip_account_id", accountIds)
    .order("created_at", { ascending: false })
    .limit(3000) : { data: [] as any[] };
  const { data: interests } = accountIds.length ? await supabase
    .from("vip_interests")
    .select("vip_account_id,business_id,interested")
    .in("vip_account_id", accountIds)
    .eq("interested", true) : { data: [] as any[] };
  const { data: inquiries } = accountIds.length ? await supabase
    .from("vip_inquiries")
    .select("id,vip_account_id,business_id,message,status,created_at,name_snapshot,phone_snapshot")
    .in("vip_account_id", accountIds)
    .order("created_at", { ascending: false })
    .limit(500) : { data: [] as any[] };

  const eventMap = new Map<string, any[]>();
  for (const e of events || []) {
    if (!eventMap.has(e.vip_account_id)) eventMap.set(e.vip_account_id, []);
    eventMap.get(e.vip_account_id)!.push(e);
  }
  const interestCount = new Map<string, number>();
  for (const i of interests || []) interestCount.set(i.vip_account_id, (interestCount.get(i.vip_account_id) || 0) + 1);
  const inquiryMap = new Map<string, any[]>();
  for (const q of inquiries || []) {
    if (!inquiryMap.has(q.vip_account_id)) inquiryMap.set(q.vip_account_id, []);
    inquiryMap.get(q.vip_account_id)!.push(q);
  }

  const rows = (accounts || []).map((a: any) => {
    const ev = eventMap.get(a.id) || [];
    return {
      ...a,
      buyer: buyerMap.get(a.buyer_id) || null,
      stats: {
        business_views: ev.filter((x: any) => x.event_type === "business_view").length,
        document_views: ev.filter((x: any) => x.event_type === "document_view").length,
        document_downloads: ev.filter((x: any) => x.event_type === "document_download").length,
        interests: interestCount.get(a.id) || 0,
        inquiries: (inquiryMap.get(a.id) || []).length
      },
      recent_activity: ev.slice(0, 20),
      recent_inquiries: (inquiryMap.get(a.id) || []).slice(0, 10)
    };
  });
  return reply(req, 200, { ok: true, accounts: rows });
}

async function handleAdminAccountAction(req: Request, admin: any, body: any) {
  const accountId = cleanText(body.account_id, 80);
  const action = cleanText(body.account_action, 40);
  const { data: account } = await supabase.from("vip_accounts").select("id,buyer_id,username,status").eq("id", accountId).maybeSingle();
  if (!account) return reply(req, 404, { ok: false, error: "account_not_found" });

  if (action === "block") {
    await supabase.from("vip_accounts").update({ status: "blocked", blocked_at: new Date().toISOString(), blocked_by: admin.profile.id }).eq("id", accountId);
    await supabase.from("vip_sessions").update({ revoked_at: new Date().toISOString() }).eq("vip_account_id", accountId).is("revoked_at", null);
  } else if (action === "unblock") {
    await supabase.from("vip_accounts").update({ status: "active", blocked_at: null, blocked_by: null }).eq("id", accountId);
  } else if (action === "delete") {
    await supabase.from("vip_accounts").update({ status: "deleted", deleted_at: new Date().toISOString(), deleted_by: admin.profile.id }).eq("id", accountId);
    await supabase.from("vip_sessions").update({ revoked_at: new Date().toISOString() }).eq("vip_account_id", accountId).is("revoked_at", null);
  } else if (action === "reset_password") {
    const temporaryPassword = randomString(10);
    await supabase.from("vip_accounts").update({ password_hash: await hashPassword(temporaryPassword), must_change_password: true }).eq("id", accountId);
    await supabase.from("vip_sessions").update({ revoked_at: new Date().toISOString() }).eq("vip_account_id", accountId).is("revoked_at", null);
    await auditAdmin("vip_reset_password", admin.profile.id, { vip_account_id: accountId, buyer_id: account.buyer_id });
    return reply(req, 200, { ok: true, username: account.username, temporary_password: temporaryPassword });
  } else if (action === "rename") {
    const username = cleanText(body.username, 40).toUpperCase();
    if (!/^VIP[A-Z0-9]{2,36}$/.test(username)) return reply(req, 400, { ok: false, error: "invalid_username" });
    const { data: conflict } = await supabase.from("vip_accounts").select("id").eq("username", username).neq("id", accountId).maybeSingle();
    if (conflict) return reply(req, 409, { ok: false, error: "username_conflict" });
    await supabase.from("vip_accounts").update({ username }).eq("id", accountId);
  } else {
    return reply(req, 400, { ok: false, error: "unknown_action" });
  }

  await auditAdmin(`vip_${action}`, admin.profile.id, { vip_account_id: accountId, buyer_id: account.buyer_id });
  return reply(req, 200, { ok: true });
}

async function handleAdminBusinessStatus(req: Request, body: any) {
  const businessId = cleanText(body.business_id, 80);
  const { data: business } = await supabase
    .from("businesses")
    .select("id,anonymous_name,anon_display_name,anon_summary,is_archived")
    .eq("id", businessId)
    .maybeSingle();
  if (!business) return reply(req, 404, { ok: false, error: "business_not_found" });
  const { data: publication } = await supabase.from("vip_business_publications").select("*").eq("business_id", businessId).maybeSingle();
  const { data: files } = await supabase
    .from("business_sale_files")
    .select("id,file_name,created_at,version_number,storage_path")
    .eq("business_id", businessId)
    .eq("status", "active")
    .eq("confidentiality_level", 1)
    .eq("document_type", "anonymous_summary")
    .order("created_at", { ascending: false });
  return reply(req, 200, { ok: true, business, publication, eligible_files: files || [] });
}

async function handleAdminPublishBusiness(req: Request, admin: any, body: any) {
  const businessId = cleanText(body.business_id, 80);
  const enabled = body.enabled === true;
  const fileId = cleanText(body.anonymous_file_id, 80) || null;

  if (enabled) {
    const { data: file } = await supabase
      .from("business_sale_files")
      .select("id,business_id,status,confidentiality_level,document_type")
      .eq("id", fileId)
      .maybeSingle();
    const safe = file && file.business_id === businessId && file.status === "active" && file.confidentiality_level === 1 && file.document_type === "anonymous_summary";
    if (!safe) return reply(req, 409, { ok: false, error: "unsafe_document_blocked", message: "הפרסום נחסם. ניתן לפרסם רק תקציר אנונימי מאושר." });
  }

  const { error } = await supabase.from("vip_business_publications").upsert({
    business_id: businessId,
    enabled,
    anonymous_file_id: enabled ? fileId : null,
    published_by: admin.profile.id,
    published_at: enabled ? new Date().toISOString() : null
  }, { onConflict: "business_id" });
  if (error) return reply(req, 409, { ok: false, error: "publication_failed", message: error.message });
  await auditAdmin(enabled ? "vip_publish_business" : "vip_unpublish_business", admin.profile.id, {
    business_id: businessId,
    details: { anonymous_file_id: enabled ? fileId : null }
  });
  return reply(req, 200, { ok: true });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req) });
  if (req.method !== "POST") return reply(req, 405, { ok: false, error: "method_not_allowed" });
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return reply(req, 500, { ok: false, error: "server_not_configured" });

  let body: any;
  try { body = await req.json(); } catch { return reply(req, 400, { ok: false, error: "invalid_json" }); }
  const action = cleanText(body.action, 80);

  try {
    if (action === "login") return await handleLogin(req, body);

    if (action.startsWith("admin_")) {
      const admin = await authenticateAdmin(req);
      if ("error" in admin) return reply(req, admin.error === "forbidden" ? 403 : 401, { ok: false, error: admin.error });
      if (action === "admin_enable_buyer") return await handleAdminEnableBuyer(req, admin, body);
      if (action === "admin_list") return await handleAdminList(req);
      if (action === "admin_account_action") return await handleAdminAccountAction(req, admin, body);
      if (action === "admin_business_status") return await handleAdminBusinessStatus(req, body);
      if (action === "admin_publish_business") return await handleAdminPublishBusiness(req, admin, body);
      return reply(req, 400, { ok: false, error: "unknown_admin_action" });
    }

    const auth = await authenticateVip(req);
    if ("error" in auth) return reply(req, 401, { ok: false, error: auth.error });
    if (action === "me") return await handleMe(req, auth);
    if (action === "businesses") return await handleBusinesses(req, auth);
    if (action === "business_view") return await handleBusinessView(req, auth, body);
    if (action === "interest") return await handleInterest(req, auth, body);
    if (action === "inquiry") return await handleInquiry(req, auth, body);
    if (action === "document_url") return await handleDocumentUrl(req, auth, body);
    if (action === "change_password") return await handleChangePassword(req, auth, body);
    if (action === "logout") return await handleLogout(req, auth);
    return reply(req, 400, { ok: false, error: "unknown_action" });
  } catch (error) {
    console.error("vip-api error", error);
    return reply(req, 500, { ok: false, error: "internal_error" });
  }
});
