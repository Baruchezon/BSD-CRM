// Short BSD links for subscriber emails (Baruch, 13.11.2026 12:43): every link sits
// behind a text button and points to www.bsd-bbi.co.il/s/<code>. No storage URLs,
// no long tokens. The site routes /s/<code> to business-alert-go.
// Until short_links_live is true the button keeps the working long link.

export const SHORT_LINK_ORIGIN = "https://www.bsd-bbi.co.il";
export const SHORT_LINK_PATH = "/s/";
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
export const CODE_LENGTH = 7;

export function shortLinkUrl(code) {
  return `${SHORT_LINK_ORIGIN}${SHORT_LINK_PATH}${code}`;
}

export function isShortCode(value) {
  return /^[A-Za-z0-9]{6,10}$/.test(String(value || ""));
}

export function newShortCode(random = n => crypto.getRandomValues(new Uint8Array(n))) {
  const bytes = random(CODE_LENGTH * 2);
  let code = "";
  for (let index = 0; index < bytes.length && code.length < CODE_LENGTH; index += 1) {
    const value = bytes[index];
    if (value >= ALPHABET.length * Math.floor(256 / ALPHABET.length)) continue;
    code += ALPHABET[value % ALPHABET.length];
  }
  while (code.length < CODE_LENGTH) code += ALPHABET[random(1)[0] % ALPHABET.length];
  return code;
}

// One code per (kind, subscriber, business, channel); the same email always reuses it.
export async function shortCodeFor(supabase, { kind, subscriberId, businessNumber = "", channel = "" }) {
  const key = { kind, subscriber_id: subscriberId, business_number: businessNumber || "", channel: channel || "" };
  const find = async () => {
    const { data, error } = await supabase.from("business_alert_short_links").select("code")
      .eq("kind", key.kind).eq("subscriber_id", key.subscriber_id)
      .eq("business_number", key.business_number).eq("channel", key.channel).maybeSingle();
    if (error) throw error;
    return data?.code || null;
  };
  const existing = await find();
  if (existing) return existing;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = newShortCode();
    const { error } = await supabase.from("business_alert_short_links").insert({ code, ...key });
    if (!error) return code;
    if (error.code !== "23505") throw error;
    const raced = await find();
    if (raced) return raced;
  }
  throw new Error("short_code_unavailable");
}

export async function shortLinksLive(supabase) {
  const { data } = await supabase.from("business_alert_match_settings").select("short_links_live").eq("id", true).maybeSingle();
  return data?.short_links_live === true;
}

// Returns the URL that goes behind a button: the short BSD link when live (or forced),
// otherwise the existing working link.
export async function buttonLink(supabase, { live, kind, subscriberId, businessNumber = "", channel = "", fallback = "" }) {
  if (!live || !subscriberId) return fallback;
  const code = await shortCodeFor(supabase, { kind, subscriberId, businessNumber, channel });
  return shortLinkUrl(code);
}

// Plain-text part: no URLs. Removal by replying works for every subscriber.
export const TEXT_REMOVAL_LINE = "להסרה מרשימת העדכונים אפשר להשיב למייל הזה במילה «הסרה».";
