// The only alert letter the CRM sends.
// Layout and wording follow the approved source of
// «3 עסקים שבחרנו בשבילך – BSD» (13.11.2026).
// The envelope From is the company mailbox, not a personal name.
// The manual copy said «השב הסרה»; this letter uses the person's unsubscribe link.

import {
  SUBSCRIBER_FROM,
  SUBSCRIBER_SITE,
  escapeHtml,
  subscriberSubject
} from "./business-alert-mail.mjs";

export const OPPORTUNITY_FROM = SUBSCRIBER_FROM;
export const OPPORTUNITY_LOGO = "https://www.bsd-bbi.co.il/assets/bsd-asset-01-logo.png";

export const APPROVED_ALERT_BUSINESSES = [
  {
    number: "BSD-B-2607-1014",
    title: "עסק בתחום התחבורה והשכרת רכבים",
    region: "אזור המרכז (סביבת ראשון לציון)",
    priceText: "9,000,000 ₪",
    summary: "עסק ותיק ורווחי, עם צי רכבים בשיטת ליסינג ויציבות תפעולית באזור המרכז.",
    url: "https://www.bsd-bbi.co.il/עסקים-למכירה/עסק-בתחום-התחבורה-והשכרת-רכבים-bsd-b-2607-1014/"
  },
  {
    number: "BSD-B-2607-1015",
    title: "עסק בתחום ניהול ואחזקת מבנים",
    region: "אזור השפלה",
    priceText: "750,000 ₪",
    summary: "מחיר כניסה נגיש יותר, עם בסיס לקוחות ותשתית תפעולית קיימים.",
    url: "https://www.bsd-bbi.co.il/עסקים-למכירה/עסק-בתחום-ניהול-ואחזקת-מבנים-bsd-b-2607-1015/"
  },
  {
    number: "BSD-B-2608-1021",
    title: "עסק בתחום ייבוא ושיווק סיטונאי מוצרי מתנות ופופ",
    region: "אזור תל אביב והמרכז",
    priceText: "2,000,000 ₪",
    summary: "עסק סיטונאי מבוסס, עם לקוחות בפריסה ארצית ופוטנציאל להרחבת המכירות.",
    url: "https://www.bsd-bbi.co.il/עסקים-למכירה/עסק-בתחום-ייבוא-ושיווק-סיטונאי-מוצרי-מתנות-ופופ-bsd-b-2608-1021/"
  }
];

function button(label, href, background, color) {
  return `<td style="background:${background};border-radius:8px;">
    <a href="${escapeHtml(href)}" style="display:inline-block;padding:10px 18px;font-size:14px;line-height:1.4;color:${color};text-decoration:none;font-weight:700;" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>
  </td>`;
}

function businessCard(business) {
  const details = business.detailsUrl
    ? `<td style="width:8px;"></td>${button("לקבלת פרטים מורחבים", business.detailsUrl, "#d4a941", "#0a1d42")}`
    : "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 16px 0;background:#ffffff;border:1px solid #dce4ef;border-radius:12px;">
    <tr>
      <td style="padding:20px 20px 18px 20px;text-align:right;border-top:4px solid #d4a941;">
        <p style="margin:0 0 6px 0;font-size:12px;line-height:1.5;color:#647087;">מספר עסק ${escapeHtml(business.number)}</p>
        <h2 style="margin:0 0 12px 0;font-size:18px;line-height:1.45;color:#0a1d42;font-weight:700;">${escapeHtml(business.title)}</h2>
        <p style="margin:0 0 4px 0;font-size:14px;line-height:1.6;color:#111c31;">אזור: ${escapeHtml(business.region)}</p>
        <p style="margin:0 0 12px 0;font-size:14px;line-height:1.6;color:#111c31;">מחיר מבוקש: <strong style="color:#102d61;">${escapeHtml(business.priceText)}</strong></p>
        <p style="margin:0 0 16px 0;font-size:14px;line-height:1.7;color:#111c31;">${escapeHtml(business.summary)}</p>
        <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
          <tr>
            ${button("לכל פרטי העסק", business.url, "#102d61", "#ffffff")}
            ${details}
          </tr>
        </table>
      </td>
    </tr>
  </table>`;
}

function businessText(business, index) {
  const lines = [
    `${index + 1}) ${business.title}`,
    `מספר עסק ${business.number}`,
    `אזור: ${business.region}`,
    `מחיר מבוקש: ${business.priceText}`,
    business.summary,
    "לכל פרטי העסק:",
    business.url
  ];
  if (business.detailsUrl) {
    lines.push("לקבלת פרטים מורחבים:", business.detailsUrl);
  }
  return lines.join("\n");
}

export function threeBusinessEmail({ firstName, businesses, unsubscribeUrl }) {
  const cards = (businesses || []).slice(0, 3);
  const count = cards.length || 3;
  const name = String(firstName || "").trim();
  const hello = name ? `שלום ${name},` : "שלום,";
  const heading = `${count} עסקים שבחרנו בשבילך`;
  const removal = unsubscribeUrl
    ? `אם לא רוצים להמשיך לקבל עדכונים, אפשר להסיר את עצמך כאן: ${unsubscribeUrl}`
    : "אם לא רוצים להמשיך לקבל עדכונים, אפשר לפנות אלינו ונפסיק מיד.";
  const text = [
    hello,
    "",
    "תודה שנרשמת לעדכונים של BSD.",
    "",
    "משביחים עסקים · מחברים הזדמנויות · מובילים עסקאות",
    "",
    "בחרנו עבורך שלושה עסקים מהרשימה הציבורית, בתחומים ובסדרי גודל שונים, כדי להתחיל מכאן. אם משהו מהם מדבר אליך, נשמח לשמוע וללוות אותך הלאה.",
    "",
    cards.map(businessText).join("\n\n"),
    "",
    "אנחנו גם מסייעים במימון רכישת העסק, ומלווים אותך לאורך כל הדרך, מהשיחה הראשונה ועד שהעסק בידיים שלך.",
    "",
    "אפשר פשוט להשיב למייל הזה, או להתקשר אלינו בטלפון 077-4446707 או 054-2424999.",
    "",
    "ברוך איזון",
    "מנכ״ל | BSD מתווכי עסקים ישראל",
    "מגדל BSR 3, רח׳ מצדה 9, בני ברק",
    "טל׳: 077-4446707",
    "נייד / וואטסאפ: 054-2424999",
    "baruch@bsd-bbi.co.il",
    "www.bsd-bbi.co.il",
    "",
    removal
  ].join("\n");

  const html = `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="x-ua-compatible" content="ie=edge">
  <title>${escapeHtml(heading)} – BSD</title>
</head>
<body style="margin:0;padding:0;background:#f4f7fb;direction:rtl;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">שלושה עסקים מהרשימה הציבורית של BSD, שנבחרו בשבילך.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#f4f7fb;">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;max-width:600px;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#111c31;text-align:right;">
          <tr>
            <td style="background:#0a1d42;padding:28px 28px 24px 28px;text-align:right;">
              <p style="margin:0 0 6px 0;font-size:13px;letter-spacing:0.08em;color:#f0d48a;font-weight:700;">BSD - עסקים למכירה</p>
              <p style="margin:0;font-size:16px;line-height:1.6;color:#ffffff;font-weight:700;">משביחים עסקים · מחברים הזדמנויות · מובילים עסקאות</p>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 28px 8px 28px;">
              <h1 style="margin:0 0 16px 0;font-size:22px;line-height:1.4;color:#0a1d42;font-weight:700;">${escapeHtml(heading)}</h1>
              <p style="margin:0 0 12px 0;font-size:16px;line-height:1.7;color:#111c31;">${escapeHtml(hello)}</p>
              <p style="margin:0 0 12px 0;font-size:16px;line-height:1.7;color:#111c31;">תודה שנרשמת לעדכונים של BSD.</p>
              <p style="margin:0 0 22px 0;font-size:16px;line-height:1.7;color:#111c31;">בחרנו עבורך שלושה עסקים מהרשימה הציבורית, בתחומים ובסדרי גודל שונים, כדי להתחיל מכאן. אם משהו מהם מדבר אליך, נשמח לשמוע וללוות אותך הלאה.</p>
              ${cards.map(businessCard).join("\n")}
              <p style="margin:8px 0 14px 0;font-size:15px;line-height:1.7;color:#111c31;">אנחנו גם מסייעים במימון רכישת העסק, ומלווים אותך לאורך כל הדרך, מהשיחה הראשונה ועד שהעסק בידיים שלך.</p>
              <p style="margin:0 0 8px 0;font-size:15px;line-height:1.7;color:#111c31;">אפשר פשוט להשיב למייל הזה, או להתקשר אלינו בטלפון <a href="tel:+972774446707" style="color:#102d61;text-decoration:none">077-4446707</a> או <a href="tel:+972542424999" style="color:#102d61;text-decoration:none">054-2424999</a>.</p>
              <table role="presentation" cellpadding="0" cellspacing="0" dir="rtl" style="border-top:1px solid #d9e2ed;margin-top:18px;border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;text-align:right">
                <tbody>
                  <tr>
                    <td style="vertical-align:middle;padding:16px 0 6px 16px">
                      <img src="${OPPORTUNITY_LOGO}" alt="BSD מתווכי עסקים ישראל" width="130" height="130" style="width:130px;height:auto;display:block;border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic">
                    </td>
                    <td style="vertical-align:middle;padding:16px 0 6px 0;font-size:12px;line-height:1.65;color:#243449;text-align:right">
                      <strong style="font-size:15px;color:#143b64">ברוך איזון</strong><br>
                      <strong>מנכ״ל | BSD מתווכי עסקים ישראל</strong><br>
                      מגדל BSR 3, רח׳ מצדה 9, בני ברק<br>
                      טל׳: <a href="tel:+972774446707" style="color:#0B2A5B;text-decoration:none">077-4446707</a><br>
                      נייד / וואטסאפ: <a href="tel:+972542424999" style="color:#0B2A5B;text-decoration:none">054-2424999</a><br>
                      <a href="mailto:baruch@bsd-bbi.co.il" style="color:#0B2A5B;text-decoration:none" target="_blank" rel="noreferrer">baruch@bsd-bbi.co.il</a><br>
                      <a href="${SUBSCRIBER_SITE}/" style="color:#185a9d;text-decoration:none" target="_blank" rel="noreferrer">www.bsd-bbi.co.il</a>
                    </td>
                  </tr>
                </tbody>
              </table>
              <p style="margin:18px 0 0 0;font-size:12px;line-height:1.6;color:#647087;">${unsubscribeUrl ? `אם לא רוצים להמשיך לקבל עדכונים, אפשר <a href="${escapeHtml(unsubscribeUrl)}" style="color:#102d61;">להסיר את עצמך כאן</a>.` : escapeHtml(removal)}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 28px 28px 28px;"></td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return {
    from: OPPORTUNITY_FROM,
    subject: subscriberSubject(heading),
    text,
    html
  };
}
