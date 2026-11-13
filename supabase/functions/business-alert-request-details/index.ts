// Token link from an alert letter. Sends the latest file flagged
// document_type = anonymous_summary, or a short note plus an alert to Baruch.
// verify_jwt is false. The subscriber token is the credential.
// request_details_enabled stays false. A test subscriber can still use the link.

import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { Buffer } from "node:buffer";
import { SUBSCRIBER_FROM, BSD_SLOGAN, listUnsubscribeHeaders, subscriberFromHeader, unsubscribeHttpsUrl } from "../_shared/business-alert-mail.mjs";
import { buttonLink, shortLinksLive } from "../_shared/short-links.mjs";
import { attachmentName, chooseAnonymousFile, detailAccess, duplicateRequestPage, fileDetailsCopy, gentleDetailsCopy, isPdfBytes, missingFileAlert, recentDetailRequest } from "./logic.mjs";

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
if (!supabaseUrl || !serviceRoleKey) throw new Error("Supabase configuration is missing");
const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
const BARUCH = "baruch.ezon@gmail.com";
const INTERNAL_FROM = subscriberFromHeader("עדכון מאלדד מנהל המערכת");
const SITE = "https://www.bsd-bbi.co.il";

function removalPageUrl(token: string) {
  const params = new URLSearchParams({ token, channel: "email" });
  return `${SITE}/${encodeURIComponent("הסרה")}/?${params.toString()}`;
}

function page(text: string, status = 200) {
  const body = `<!doctype html><html lang="he" dir="rtl"><body style="font-family:Arial,sans-serif;padding:24px"><p>${text}</p><p>${BSD_SLOGAN}</p></body></html>`;
  return new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

type Attachment = { filename: string; content: string; content_type?: string };

async function sendMail(to: string, subject: string, text: string, html?: string, attachments?: Attachment[], extra: { from?: string; headers?: Record<string, string> } = {}) {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) return { sent: false, error: "missing_email_configuration", id: null };
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      from: extra.from || SUBSCRIBER_FROM,
      reply_to: "info@bsd-bbi.co.il",
      to: [to],
      subject,
      text,
      ...(html ? { html } : {}),
      ...(attachments?.length ? { attachments } : {}),
      ...(extra.headers ? { headers: extra.headers } : {})
    })
  });
  const payload = await response.json().catch(() => ({}));
  return { sent: response.ok, error: response.ok ? null : `resend_${response.status}`, id: payload?.id || null };
}

// One email per subscriber + business per Israel day: the row is claimed before sending.
async function claimRequest(subscriberId: string, businessNumber: string) {
  const { data, error } = await supabase.from("business_alert_detail_requests")
    .insert({ subscriber_id: subscriberId, business_number: businessNumber, outcome: "pending" })
    .select("id")
    .single();
  if (error?.code === "23505") return null;
  if (error) throw error;
  return data.id as string;
}

async function finishRequest(id: string, outcome: string, fileId?: string) {
  const { error } = await supabase.from("business_alert_detail_requests")
    .update({ outcome, ...(fileId ? { file_id: fileId } : {}) })
    .eq("id", id);
  if (error) console.error("detail request outcome was not stored", error.message);
}

// Baruch, 13.11 11:32: attach the anonymous summary as a PDF, no long signed link.
async function anonymousPdf(storagePath: string) {
  const { data, error } = await supabase.storage.from("business-files").download(storagePath);
  if (error || !data) return null;
  const bytes = new Uint8Array(await data.arrayBuffer());
  if (!isPdfBytes(bytes)) return null;
  return Buffer.from(bytes).toString("base64");
}

Deno.serve(async req => {
  if (req.method !== "GET") return page("הקישור אינו שלם.", 405);
  const url = new URL(req.url);
  const token = url.searchParams.get("token") || "";
  const businessNumber = url.searchParams.get("business") || "";
  if (!token || !businessNumber) return page("הקישור אינו שלם.", 400);

  const { data: subscriber, error: subscriberError } = await supabase.from("business_alert_subscribers")
    .select("id, email, first_name, last_name, phone, address_form, is_test, status")
    .eq("unsubscribe_token", token)
    .maybeSingle();
  if (subscriberError) throw subscriberError;
  if (!subscriber?.id) return page("הקישור אינו מוכר.", 404);

  const { data: settings } = await supabase.from("business_alert_match_settings")
    .select("request_details_enabled, request_details_allowlist")
    .eq("id", true)
    .maybeSingle();
  const allowed = detailAccess({
    enabled: settings?.request_details_enabled === true,
    allowlist: settings?.request_details_allowlist || [],
    subscriber
  });

  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data: recent } = await supabase.from("business_alert_detail_requests")
    .select("created_at")
    .eq("subscriber_id", subscriber.id)
    .eq("business_number", businessNumber)
    .gte("created_at", since);
  if (recentDetailRequest(recent || [], Date.now())) return page("הבקשה כבר נקלטה.");

  if (!allowed) {
    await supabase.from("business_alert_detail_requests").insert({
      subscriber_id: subscriber.id,
      business_number: businessNumber,
      outcome: "disabled"
    });
    return page("הבקשה נרשמה. השליחה עדיין כבויה.");
  }

  const claimId = await claimRequest(subscriber.id, businessNumber);
  if (!claimId) return page(duplicateRequestPage());

  try {
    const { data: business } = await supabase.from("businesses")
      .select("id, business_number, internal_name, anon_display_name, category")
      .eq("business_number", businessNumber)
      .maybeSingle();
    const { data: files } = business?.id
      ? await supabase.from("business_sale_files")
        .select("id, document_type, status, deleted_at, version_number, created_at, storage_path, file_name")
        .eq("business_id", business.id)
        .eq("document_type", "anonymous_summary")
        .eq("status", "active")
        .is("deleted_at", null)
      : { data: [] };
    const file = chooseAnonymousFile(files || []);

    if (file?.storage_path && subscriber.email) {
      const pdf = await anonymousPdf(file.storage_path);
      if (pdf) {
        const live = await shortLinksLive(supabase);
        const removal = await buttonLink(supabase, {
          live, kind: "unsubscribe", subscriberId: subscriber.id, channel: "email", fallback: removalPageUrl(token)
        });
        const copy = fileDetailsCopy({ firstName: subscriber.first_name, addressForm: subscriber.address_form, unsubscribeUrl: removal, slogan: BSD_SLOGAN });
        const mail = await sendMail(subscriber.email, copy.subject, copy.text, copy.html, [
          { filename: attachmentName(businessNumber), content: pdf, content_type: "application/pdf" }
        ], { headers: listUnsubscribeHeaders(unsubscribeHttpsUrl(supabaseUrl, token, "email")) });
        await finishRequest(claimId, mail.sent ? "sent_file" : "file_failed", file.id);
        return page(mail.sent ? "שלחנו אליך את התקציר האנונימי כקובץ PDF מצורף." : "הבקשה נרשמה. המייל לא יצא.");
      }
      console.error("anonymous summary is not a downloadable PDF", file.id);
    }

    const gentle = gentleDetailsCopy(subscriber.address_form);
    if (subscriber.email) await sendMail(subscriber.email, gentle.subject, `${gentle.text}\n\n${BSD_SLOGAN}`);
    const note = missingFileAlert({ subscriber, business, businessNumber });
    await sendMail(BARUCH, note.subject, note.text, note.html, undefined, { from: INTERNAL_FROM });
    await finishRequest(claimId, "gentle");
    return page(gentle.text);
  } catch (error) {
    await finishRequest(claimId, "file_failed");
    throw error;
  }
});
