// Token link from an alert letter. Sends the latest file flagged
// document_type = anonymous_summary, or a short note plus an alert to Baruch.
// verify_jwt is false. The subscriber token is the credential.
// request_details_enabled stays false. A test subscriber can still use the link.

import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { SUBSCRIBER_FROM, BSD_SLOGAN } from "../_shared/business-alert-mail.mjs";
import { chooseAnonymousFile, detailAccess, gentleDetailsCopy, recentDetailRequest } from "./logic.mjs";

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
if (!supabaseUrl || !serviceRoleKey) throw new Error("Supabase configuration is missing");
const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
const BARUCH = "baruch.ezon@gmail.com";

function page(text: string, status = 200) {
  const body = `<!doctype html><html lang="he" dir="rtl"><body style="font-family:Arial,sans-serif;padding:24px"><p>${text}</p><p>${BSD_SLOGAN}</p></body></html>`;
  return new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

async function sendMail(to: string, subject: string, text: string) {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) return { sent: false, error: "missing_email_configuration" };
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ from: SUBSCRIBER_FROM, to: [to], subject, text })
  });
  return { sent: response.ok, error: response.ok ? null : `resend_${response.status}` };
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
    const signed = await supabase.storage.from("business-files").createSignedUrl(file.storage_path, 60 * 30);
    const link = signed.data?.signedUrl || "";
    const mail = await sendMail(
      subscriber.email,
      "פרסומת: הפרטים המורחבים שביקשת",
      link ? `הקובץ האנונימי מוכן:\n${link}` : "הקובץ האנונימי סומן, אבל הקישור לא נוצר."
    );
    await supabase.from("business_alert_detail_requests").insert({
      subscriber_id: subscriber.id,
      business_number: businessNumber,
      file_id: file.id,
      outcome: mail.sent ? "sent_file" : "file_failed"
    });
    return page(mail.sent ? "שלחנו אליך את הקובץ האנונימי." : "הבקשה נרשמה. המייל לא יצא.");
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
