// Token link from an alert letter. Sends the latest file flagged
// document_type = anonymous_summary, or a short note plus an alert to Baruch.
// verify_jwt is false. The subscriber token is the credential.
// request_details_enabled stays false. A test subscriber can still use the link.

import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { Buffer } from "node:buffer";
import { SUBSCRIBER_FROM, BSD_SLOGAN, unsubscribeHttpsUrl } from "../_shared/business-alert-mail.mjs";
import { attachmentName, chooseAnonymousFile, detailAccess, fileDetailsCopy, gentleDetailsCopy, isPdfBytes, recentDetailRequest } from "./logic.mjs";

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
if (!supabaseUrl || !serviceRoleKey) throw new Error("Supabase configuration is missing");
const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
const BARUCH = "baruch.ezon@gmail.com";

function page(text: string, status = 200) {
  const body = `<!doctype html><html lang="he" dir="rtl"><body style="font-family:Arial,sans-serif;padding:24px"><p>${text}</p><p>${BSD_SLOGAN}</p></body></html>`;
  return new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

type Attachment = { filename: string; content: string; content_type?: string };

async function sendMail(to: string, subject: string, text: string, html?: string, attachments?: Attachment[]) {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) return { sent: false, error: "missing_email_configuration" };
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ from: SUBSCRIBER_FROM, to: [to], subject, text, ...(html ? { html } : {}), ...(attachments?.length ? { attachments } : {}) })
  });
  return { sent: response.ok, error: response.ok ? null : `resend_${response.status}` };
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
  const url = new URL(req.url);
  const token = url.searchParams.get("token") || "";
  const businessNumber = url.searchParams.get("business") || "";
  if (!token || !businessNumber) return page("הקישור אינו שלם.", 400);

  const { data: subscriber, error: subscriberError } = await supabase.from("business_alert_subscribers")
    .select("id, email, first_name, address_form, is_test, status")
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

  const { data: business } = await supabase.from("businesses")
    .select("id, business_number")
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
      const copy = fileDetailsCopy({
        firstName: subscriber.first_name,
        addressForm: subscriber.address_form,
        unsubscribeUrl: unsubscribeHttpsUrl(supabaseUrl, token, "email"),
        slogan: BSD_SLOGAN
      });
      const mail = await sendMail(subscriber.email, copy.subject, copy.text, copy.html, [
        { filename: attachmentName(businessNumber), content: pdf, content_type: "application/pdf" }
      ]);
      await supabase.from("business_alert_detail_requests").insert({
        subscriber_id: subscriber.id,
        business_number: businessNumber,
        file_id: file.id,
        outcome: mail.sent ? "sent_file" : "file_failed"
      });
      return page(mail.sent ? "שלחנו אליך את התקציר האנונימי כקובץ PDF מצורף." : "הבקשה נרשמה. המייל לא יצא.");
    }
    console.error("anonymous summary is not a downloadable PDF", file.id);
  }

  const gentle = gentleDetailsCopy(subscriber.address_form);
  if (subscriber.email) await sendMail(subscriber.email, gentle.subject, `${gentle.text}\n\n${BSD_SLOGAN}`);
  await sendMail(BARUCH, `אין קובץ אנונימי לעסק ${businessNumber}`, `נרשם ${subscriber.id} ביקש פרטים מורחבים לעסק ${businessNumber}, ואין קובץ שמסומן anonymous_summary.`);
  await supabase.from("business_alert_detail_requests").insert({
    subscriber_id: subscriber.id,
    business_number: businessNumber,
    outcome: "gentle"
  });
  return page(gentle.text);
});
