// קונים פוטנציאליים מהאתר. The screen reads business-alert-admin.
// Sample rows are used only on localhost, and they are not real people.
(function (root) {
  const REASONS = {
    legacy_no_consent: "אין עדיין הסכמה שיווקית. צריך הרשמה מחדש בטופס החדש.",
    no_general_consent: "חסרה ההסכמה הכללית לקבל עדכונים ופרסומות.",
    no_email_consent: "אין הסכמה לאימייל.",
    no_whatsapp_consent: "אין הסכמה לוואטסאפ.",
    unsubscribed_email: "הוסר מרשימת האימייל.",
    unsubscribed_whatsapp: "הוסר מרשימת הוואטסאפ.",
    not_found: "הרשומה לא נמצאה.",
    blocked: "אי אפשר לשלוח."
  };

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[character]));
  }

  function statusLabel(status) {
    return {
      active: "פעיל",
      unsubscribed_email: "הוסר מאימייל",
      unsubscribed_whatsapp: "הוסר מוואטסאפ",
      unsubscribed_all: "הוסר מהכל",
      unsubscribed: "הוסר מהכל"
    }[status] || status || "—";
  }

  function isClosed(status) {
    return ["unsubscribed", "unsubscribed_email", "unsubscribed_whatsapp", "unsubscribed_all"].includes(status);
  }

  function startOfWeekJerusalem(now) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Jerusalem",
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    }).formatToParts(now);
    const get = type => parts.find(part => part.type === type)?.value;
    const weekday = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[get("weekday")] || 0;
    const y = Number(get("year"));
    const m = Number(get("month"));
    const d = Number(get("day"));
    const utcGuess = Date.UTC(y, m - 1, d, Number(get("hour")), Number(get("minute")), Number(get("second")));
    const offset = utcGuess - now.getTime();
    return new Date(Date.UTC(y, m - 1, d) - offset - weekday * 86400000);
  }

  function summarize(rows, now) {
    const week = startOfWeekJerusalem(now || new Date()).getTime();
    const summary = {
      total: rows.length, newThisWeek: 0, active: 0, unsubscribed: 0,
      emailConsent: 0, whatsappConsent: 0, doNotCall: 0, awaitingConsent: 0,
      regions: {}, sectors: {}, campaigns: {}
    };
    rows.forEach(row => {
      if (row.created_at && new Date(row.created_at).getTime() >= week) summary.newThisWeek += 1;
      if (row.status === "active") summary.active += 1;
      if (isClosed(row.status)) summary.unsubscribed += 1;
      if (row.do_not_call === true) summary.doNotCall += 1;
      const marketed = row.legacy_no_consent !== true && row.consent_general === true;
      if (!marketed) summary.awaitingConsent += 1;
      const emailClosed = row.status === "unsubscribed_email" || row.status === "unsubscribed_all" || row.status === "unsubscribed" || !!row.email_unsubscribed_at;
      const whatsappClosed = row.status === "unsubscribed_whatsapp" || row.status === "unsubscribed_all" || row.status === "unsubscribed" || !!row.whatsapp_unsubscribed_at;
      if (marketed && row.consent_email === true && !emailClosed) summary.emailConsent += 1;
      if (marketed && row.consent_whatsapp === true && !whatsappClosed) summary.whatsappConsent += 1;
      const region = row.region || "לא צוין";
      summary.regions[region] = (summary.regions[region] || 0) + 1;
      const interests = Array.isArray(row.interests) && row.interests.length ? row.interests : ["לא צוין"];
      interests.forEach(interest => { summary.sectors[interest] = (summary.sectors[interest] || 0) + 1; });
      const campaign = row.utm_campaign || "בלי קמפיין";
      summary.campaigns[campaign] = (summary.campaigns[campaign] || 0) + 1;
    });
    return summary;
  }

  function inChannel(row, channel) {
    const value = row.signup_channel === "our_link" ? "our_link" : "website";
    return value === channel;
  }

  function filterRows(rows, query) {
    const needle = String(query || "").trim().toLowerCase();
    if (!needle) return rows.slice();
    return rows.filter(row => [
      row.first_name, row.last_name, row.phone, row.email, row.region,
      ...(Array.isArray(row.interests) ? row.interests : []),
      row.manager_notes, row.status, row.source_url, row.consent_text
    ].join(" ").toLowerCase().includes(needle));
  }

  function sampleAllowed() {
    if (typeof location === "undefined") return false;
    return location.protocol === "file:" || location.hostname === "localhost" || location.hostname === "127.0.0.1";
  }

  function sampleRows(now) {
    const today = (now || new Date()).toISOString();
    const old = new Date(Date.now() - 20 * 86400000).toISOString();
    return [
      {
        id: "sample-1", first_name: "דנה", last_name: "לדוגמה", phone: "050-0000001", email: "sample.dana@example.com",
        region: "מרכז", interests: ["מזון", "קמעונאות"], status: "active", created_at: today,
        consent_general: true, consent_email: true, consent_whatsapp: true, legacy_no_consent: false,
        consent_text: "אני מאשר/ת לקבל מ-BSD עדכונים ופרסומות על עסקים למכירה",
        consent_version: "v1-2026-11-13", consent_at: today, source_url: "https://www.bsd-bbi.co.il/עסקים-למכירה/",
        signup_channel: "website", utm_campaign: "catalog-nov", utm_source: "site", utm_medium: "organic",
        do_not_call: false, manager_notes: "", view_count: 2, handled_at: null, budget_open: true,
        views: [
          { page_path: "/עסקים-למכירה/", via: "email_link", viewed_at: today },
          { page_path: "/עסקים-למכירה/listing-sample", via: "cookie", viewed_at: today }
        ],
        sampleMatches: [
          { business_id: "sample-biz", score: 86, sector_points: 38, budget_points: 30, location_points: 18, sendable: true, block_reason: null, public_card: { title: "מאפייה לדוגמה" }, breakdown: { sector: { points: 38, text: "תחום: מאפייה באותה ליגה של מזון." }, budget: { points: 30, text: "המחיר 1.1 מיליון בתוך הטווח." }, location: { points: 18, text: "אזור: חיפה והקריות." } } },
          { business_id: "sample-biz-2", score: 30, sector_points: 38, budget_points: 0, location_points: 8, sendable: false, block_reason: "budget_out_of_range", public_card: { title: "מסעדה לדוגמה" }, breakdown: { sector: { points: 38, text: "תחום: מסעדה באותה ליגה של מזון." }, budget: { points: 0, text: "המחיר 3 מיליון מחוץ לטווח." }, location: { points: 8, text: "אזור סמוך." } } }
        ]
      },
      {
        id: "sample-2", first_name: "יוסי", last_name: "לדוגמה", phone: "050-0000002", email: "sample.yossi@example.com",
        region: "צפון", interests: ["תעשייה"], status: "active", created_at: old,
        consent_general: null, consent_email: true, consent_whatsapp: false, legacy_no_consent: true,
        consent_text: null, consent_version: null, source_url: null, do_not_call: false,
        manager_notes: "נרשם בטופס הישן. עדיין בלי הסכמה שיווקית.", view_count: 0, views: [], handled_at: null, budget_open: false, budget_min: 250000, budget_max: 500000,
        signup_channel: "our_link", utm_campaign: "wa-baruch", utm_source: "whatsapp", utm_medium: "link"
      },
      {
        id: "sample-3", first_name: "מיכל", last_name: "לדוגמה", phone: "050-0000003", email: "sample.michal@example.com",
        region: "דרום", interests: ["שירותים"], status: "unsubscribed_email", created_at: today,
        consent_general: true, consent_email: true, consent_whatsapp: true, legacy_no_consent: false,
        email_unsubscribed_at: today, do_not_call: true, manager_notes: "", view_count: 0, views: [], handled_at: null,
        consent_text: "אני מאשר/ת לקבל מ-BSD עדכונים ופרסומות על עסקים למכירה", consent_version: "v1-2026-11-13", source_url: "https://www.bsd-bbi.co.il/עסקים-למכירה/"
      },
      {
        id: "sample-4", first_name: "רונית", last_name: "לדוגמה", phone: "050-0000004", email: "sample.ronit@example.com",
        region: "תל אביב וגוש דן", interests: ["כל התחומים"], status: "unsubscribed_all", created_at: old,
        consent_general: true, consent_email: true, consent_whatsapp: false, legacy_no_consent: false,
        do_not_call: false, manager_notes: "", view_count: 0, views: [], handled_at: today, budget_open: true,
        consent_text: "אני מאשר/ת לקבל מ-BSD עדכונים ופרסומות על עסקים למכירה", source_url: "https://www.bsd-bbi.co.il/",
        signup_channel: "our_link", utm_campaign: "wa-baruch"
      }
    ];
  }

  function bars(map) {
    const entries = Object.entries(map).sort((a, b) => b[1] - a[1]);
    if (!entries.length) return "<p class='muted'>אין נתונים</p>";
    const max = entries[0][1] || 1;
    return entries.map(([label, count]) =>
      `<div class="bar"><span>${esc(label)}</span><i style="width:${Math.max(8, Math.round(count / max * 100))}%"></i><b>${count}</b></div>`
    ).join("");
  }

  function reasonText(code) {
    return REASONS[code] || "אי אפשר לשלוח את ההודעה.";
  }

  root.BSDSiteBuyers = {
    esc, statusLabel, summarize, filterRows, inChannel, sampleAllowed, sampleRows, bars, reasonText, startOfWeekJerusalem
  };
})(typeof window !== "undefined" ? window : globalThis);
