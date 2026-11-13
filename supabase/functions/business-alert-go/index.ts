// Short-link resolver for subscriber emails: www.bsd-bbi.co.il/s/<code>.
// The site worker proxies /s/<code> here (?c=<code>). verify_jwt is false; the
// unguessable code is the credential, the same as the token it replaces.
// details     -> runs business-alert-request-details for that subscriber + business
// unsubscribe -> the site removal page (/הסרה/) for that subscriber
// page        -> the public business page on www.bsd-bbi.co.il
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { isShortCode } from "../_shared/short-links.mjs";
import { APPROVED_ALERT_BUSINESSES } from "../_shared/opportunity-email.mjs";

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
if (!supabaseUrl || !serviceRoleKey) throw new Error("Supabase configuration is missing");
const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
const SITE = "https://www.bsd-bbi.co.il";

function page(text: string, status = 200) {
  const body = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BSD - עסקים למכירה</title></head><body style="font-family:Arial,sans-serif;padding:24px;color:#102844"><p>${text}</p><p><a href="${SITE}/">www.bsd-bbi.co.il</a></p></body></html>`;
  return new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
}

function redirect(location: string) {
  return new Response(null, { status: 302, headers: { Location: location, "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
}

Deno.serve(async req => {
  if (req.method !== "GET" && req.method !== "HEAD") return new Response(null, { status: 405 });
  const url = new URL(req.url);
  const code = url.searchParams.get("c") || url.pathname.split("/").filter(Boolean).pop() || "";
  if (!isShortCode(code)) return page("הקישור אינו תקין.", 404);
  const { data: link, error } = await supabase.from("business_alert_short_links")
    .select("code, kind, subscriber_id, business_number, channel, use_count")
    .eq("code", code)
    .maybeSingle();
  if (error) {
    console.error("short link lookup failed", error.message);
    return page("אירעה תקלה. אפשר להשיב למייל שקיבלת ונחזור אליך.", 500);
  }
  if (!link) return page("הקישור אינו מוכר.", 404);
  // HEAD (link scanners) never triggers an action.
  if (req.method === "HEAD") return new Response(null, { status: 200 });
  await supabase.from("business_alert_short_links")
    .update({ last_used_at: new Date().toISOString(), use_count: Number(link.use_count || 0) + 1 })
    .eq("code", code);

  if (link.kind === "page") {
    const known = APPROVED_ALERT_BUSINESSES.find(item => item.number === link.business_number);
    return redirect(known?.url || `${SITE}/עסקים-למכירה/${encodeURIComponent(link.business_number)}`);
  }

  const { data: subscriber } = await supabase.from("business_alert_subscribers")
    .select("unsubscribe_token")
    .eq("id", link.subscriber_id)
    .maybeSingle();
  if (!subscriber?.unsubscribe_token) return page("הקישור אינו מוכר.", 404);

  if (link.kind === "unsubscribe") {
    const channel = ["email", "whatsapp", "all"].includes(link.channel) ? link.channel : "email";
    const params = new URLSearchParams({ token: subscriber.unsubscribe_token, channel });
    return redirect(`${SITE}/${encodeURIComponent("הסרה")}/?${params.toString()}`);
  }

  if (link.kind === "details") {
    const params = new URLSearchParams({ token: subscriber.unsubscribe_token, business: link.business_number });
    const response = await fetch(`${supabaseUrl}/functions/v1/business-alert-request-details?${params.toString()}`);
    const html = await response.text();
    return new Response(html, { status: response.status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
  }
  return page("הקישור אינו מוכר.", 404);
});
