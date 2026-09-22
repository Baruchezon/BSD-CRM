import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = (Deno.env.get("RESEND_API_KEY") || "").trim();
const RESEND_FROM_EMAIL = (Deno.env.get("RESEND_FROM_EMAIL") || "onboarding@resend.dev").trim();
const INTERNAL_EMAIL = "baruch.ezon@gmail.com";
const BUCKET = "business-files";
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const ALLOWED_ORIGINS = new Set([
  "https://baruchezon.github.io",
  "https://bsd-crm.vercel.app",
]);

function corsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "https://baruchezon.github.io",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(req: Request, value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json; charset=utf-8" },
  });
}

function normalizePhone(value: unknown) {
  return String(value || "").replace(/\D/g, "");
}

function validUuid(value: unknown) {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function base64ToBytes(value: string) {
  const clean = value.includes(",") ? value.split(",").pop()! : value;
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function safeText(value: unknown, max = 500) {
  return String(value || "").trim().slice(0, max);
}

async function sendMail(opts: {
  subject: string;
  bodyText: string;
  filename: string;
  pdfBase64: string;
  replyTo?: string;
}) {
  if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY is not configured");
  const payload: Record<string, unknown> = {
    from: `BSD Business Brokers Israel <${RESEND_FROM_EMAIL}>`,
    to: [INTERNAL_EMAIL],
    subject: opts.subject,
    text: opts.bodyText,
    attachments: [{ filename: opts.filename, content: opts.pdfBase64 }],
  };
  if (opts.replyTo) payload.reply_to = opts.replyTo;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const responseBody = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(responseBody?.message || responseBody?.error || `HTTP ${response.status}`));
  }
  return responseBody?.id || null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(req, { error: "Invalid JSON", code: "invalid_json" }, 400);
  }

  const tableName = safeText(body.table_name, 30);
  const leadType = safeText(body.lead_type, 30) || null;
  const recordIdInput = safeText(body.record_id, 100);
  const phone = safeText(body.phone, 40);
  const agreementNumber = safeText(body.agreement_number, 80);
  const signerName = safeText(body.signer_name, 200);
  const signerEmail = safeText(body.signer_email, 250);
  const pdfBase64 = safeText(body.pdf_base64, 12_000_000);
  const filename = safeText(body.filename, 240) || `signed-agreement-${agreementNumber}.pdf`;
  const details = (body.details && typeof body.details === "object")
    ? body.details as Record<string, unknown>
    : {};

  if (!["businesses", "leads", "brokers"].includes(tableName)) {
    return json(req, { error: "Invalid agreement table", code: "invalid_table" }, 400);
  }
  if (tableName === "leads" && !["buyer", "partner", "seller"].includes(leadType || "")) {
    return json(req, { error: "Invalid lead type", code: "invalid_lead_type" }, 400);
  }
  if (!phone || !agreementNumber) {
    return json(req, { error: "Missing required agreement data", code: "missing_fields" }, 400);
  }

  let recordId = validUuid(recordIdInput) ? recordIdInput : "";
  if (!recordId) {
    if (tableName === "brokers") {
      const { data } = await supabase
        .from("brokers").select("id")
        .eq("phone", phone).limit(1).maybeSingle();
      recordId = data?.id || "";
    } else {
      const { data } = await supabase.rpc("find_agreement_record", {
        p_table_name: tableName,
        p_phone: phone,
        p_lead_type: leadType,
      });
      recordId = data || "";
    }
  }
  if (!recordId) {
    return json(req, { error: "Agreement record was not found", code: "record_not_found" }, 404);
  }

  const phoneColumn = tableName === "businesses" ? "owner_phone" : "phone";
  const selectColumns = [
    "id", phoneColumn, "agreement_status", "agreement_number",
    "agreement_pdf_path", "agreement_email_sent_at",
  ].join(",");
  const { data: record, error: recordError } = await supabase
    .from(tableName).select(selectColumns).eq("id", recordId).maybeSingle();

  if (recordError || !record) {
    return json(req, { error: "Agreement record was not found", code: "record_lookup_failed" }, 404);
  }
  if (normalizePhone(record[phoneColumn]) !== normalizePhone(phone)) {
    return json(req, { error: "Agreement link does not match this record", code: "record_mismatch" }, 403);
  }
  if (!["נשלח הסכם לחתימה", "יש הסכם חתום"].includes(record.agreement_status || "")) {
    return json(req, { error: "Agreement is not awaiting signature", code: "invalid_status" }, 409);
  }
  if (record.agreement_pdf_path && record.agreement_number &&
      record.agreement_number !== agreementNumber) {
    return json(req, { error: "A different signed agreement already exists", code: "agreement_conflict" }, 409);
  }

  let pdfBytes: Uint8Array;
  let pdfForEmail: string;
  let storagePath = record.agreement_pdf_path || `agreements/${tableName}/${recordId}.pdf`;

  if (pdfBase64) {
    try {
      pdfBytes = base64ToBytes(pdfBase64);
    } catch {
      return json(req, { error: "Invalid PDF data", code: "invalid_pdf" }, 400);
    }
    if (pdfBytes.length < 100 || pdfBytes.length > 10 * 1024 * 1024) {
      return json(req, { error: "PDF size is invalid", code: "invalid_pdf_size" }, 400);
    }
    pdfForEmail = pdfBase64.includes(",") ? pdfBase64.split(",").pop()! : pdfBase64;

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, pdfBytes, {
        upsert: true,
        contentType: "application/pdf",
        cacheControl: "no-cache",
      });
    if (uploadError) {
      return json(req, { error: "PDF storage failed", detail: uploadError.message, code: "upload_failed" }, 500);
    }
  } else {
    if (!record.agreement_pdf_path) {
      return json(req, { error: "Missing PDF data", code: "missing_pdf" }, 400);
    }
    const { data: storedPdf, error: downloadError } = await supabase.storage
      .from(BUCKET).download(record.agreement_pdf_path);
    if (downloadError || !storedPdf) {
      return json(req, { error: "Stored PDF could not be loaded", detail: downloadError?.message, code: "download_failed" }, 500);
    }
    pdfBytes = new Uint8Array(await storedPdf.arrayBuffer());
    pdfForEmail = bytesToBase64(pdfBytes);
  }

  const now = new Date().toISOString();
  const update: Record<string, unknown> = {
    agreement_status: "יש הסכם חתום",
    agreement_number: agreementNumber,
    agreement_pdf_path: storagePath,
    agreement_pdf_uploaded_at: pdfBase64 ? now : undefined,
    agreement_email_last_error: null,
  };

  if (tableName === "leads") {
    update.agreement_sent = true;
    update.agreement_signed = true;
    update.agreement_signed_date = now.slice(0, 10);
    update.full_name = signerName || undefined;
    update.id_number = safeText(details.id_number, 80) || undefined;
    update.company = safeText(details.entity, 200) || undefined;
    update.email = signerEmail || undefined;
    update.address = safeText(details.address, 500) || undefined;
    update.city = safeText(details.city, 120) || undefined;
  } else if (tableName === "businesses") {
    update.owner_name = signerName || undefined;
    update.internal_name = safeText(details.business_name, 250) || undefined;
    update.id_number = safeText(details.id_number, 80) || undefined;
    update.entity_type = safeText(details.entity, 120) || undefined;
    update.owner_email = signerEmail || undefined;
    update.address = safeText(details.address, 500) || undefined;
    update.city = safeText(details.city, 120) || undefined;
  } else {
    update.full_name = signerName || undefined;
    update.email = signerEmail || undefined;
    update.address = safeText(details.address, 500) || undefined;
    update.city = safeText(details.city, 120) || undefined;
  }
  for (const key of Object.keys(update)) {
    if (update[key] === undefined) delete update[key];
  }

  const { error: updateError } = await supabase.from(tableName).update(update).eq("id", recordId);
  if (updateError) {
    return json(req, { error: "CRM update failed", detail: updateError.message, code: "crm_update_failed" }, 500);
  }

  let emailSent = Boolean(record.agreement_email_sent_at);
  let emailWarning: string | null = null;
  if (!emailSent) {
    const typeLabel = tableName === "businesses"
      ? "מוכר עסק"
      : tableName === "brokers"
      ? "מתווך"
      : leadType === "buyer" ? "קונה פוטנציאלי" : "לקוח";
    const lines = [
      `הסכם חתום חדש: ${typeLabel}`,
      `שם: ${signerName}`,
      `טלפון: ${phone}`,
      signerEmail ? `אימייל: ${signerEmail}` : "",
      `מספר הסכם: ${agreementNumber}`,
      `תאריך חתימה: ${new Date().toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" })}`,
      "",
      "קובץ ה PDF החתום מצורף למייל זה ונשמר גם בכרטיס הלקוח במערכת BSD CRM.",
    ].filter(Boolean);
    try {
      await sendMail({
        subject: `הסכם חתום (${typeLabel}) – ${signerName}`,
        bodyText: lines.join("\n"),
        filename,
        pdfBase64: pdfForEmail,
        replyTo: signerEmail || undefined,
      });
      emailSent = true;
      await supabase.from(tableName).update({
        agreement_email_sent_at: new Date().toISOString(),
        agreement_email_last_error: null,
      }).eq("id", recordId);
    } catch (error) {
      emailWarning = error instanceof Error ? error.message : String(error);
      await supabase.from(tableName).update({
        agreement_email_last_error: emailWarning.slice(0, 1000),
      }).eq("id", recordId);
    }
  }

  return json(req, {
    ok: true,
    saved: true,
    email_sent: emailSent,
    warning: emailWarning,
    record_id: recordId,
    storage_path: storagePath,
  });
});
