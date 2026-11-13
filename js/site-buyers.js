// קונים פוטנציאליים מהאתר. The screen reads business-alert-admin.
// Sample rows are used only on localhost, and they are not real people.
(function (root) {
  const REASONS = {
    pending_consent: "אין עדיין הסכמה. לא נשלח עדכון עד שתסומן הסכמה לערוץ.",
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

  const SECTORS = {
    food: "מזון ומסעדנות", grocery: "קמעונאות מזון", retail: "מסחר וקמעונאות",
    wholesale: "ייבוא, סיטונאות והפצה", beauty: "יופי וטיפוח", health: "בריאות וטיפול",
    auto: "רכב", construction: "בנייה, קבלנות ותעשייה", services: "שירותים לעסקים",
    education_leisure: "חינוך ופנאי"
  };
  const SUBS = {
    restaurant: "מסעדה", cafe: "בית קפה", fast_food: "מזון מהיר", bakery: "מאפייה",
    catering: "קייטרינג", pub_bar: "פאב / בר", juice_bar: "בר מיצים ושייקים",
    food_production: "ייצור מזון", supermarket: "סופרמרקט", minimarket: "מינימרקט",
    produce: "ירקות ופירות", deli: "מעדנייה", fashion: "הלבשה ואופנה",
    beauty_products: "מוצרי יופי וטיפוח", general_store: "חנות כללית", ecommerce: "מסחר מקוון",
    import: "ייבוא", wholesale: "סיטונאות", distribution: "הפצה", hair_salon: "מספרה",
    cosmetics: "קוסמטיקה", nails: "ציפורניים", medical_aesthetics: "אסתטיקה רפואית",
    clinic: "קליניקה / מרפאה", complementary: "טיפולים משלימים", fitness: "כושר וסטודיו",
    garage: "מוסך", car_accessories: "אבזור רכב", car_wash: "שטיפת רכב",
    contracting: "קבלנות", hvac_electric: "מיזוג אוויר וחשמל", manufacturing: "ייצור ותעשייה",
    marketing_digital: "שיווק ודיגיטל", software_web: "תוכנה ואתרים",
    cleaning_maintenance: "ניקיון ואחזקה", transport_tourism: "הסעות ותיירות",
    kindergarten: "גנים וצהרונים", classes: "חוגים", leisure: "פנאי ונופש"
  };
  const REGIONS = {
    north: "צפון", haifa: "חיפה והקריות", sharon: "שרון", tel_aviv: "תל אביב",
    center: "מרכז וגוש דן", shfela: "שפלה", jerusalem: "ירושלים והסביבה", south: "דרום", all: "כל הארץ"
  };
  const FLAGS = { franchise: "זכיינות" };
  const SOURCE_LABEL = {
    website: "אתר",
    our_link: "יזום שלנו",
    manual: "יזום שלנו",
    call: "יזום שלנו"
  };
  const CONSENT_METHODS = ["verbal_call", "whatsapp_reply", "written"];

  function statusLabel(status) {
    return {
      active: "פעיל",
      unsubscribed_email: "הוסר מאימייל",
      unsubscribed_whatsapp: "הוסר מוואטסאפ",
      unsubscribed_all: "הוסר מהכל",
      unsubscribed: "הוסר מהכל",
      pending_consent: "ממתין להסכמה"
    }[status] || status || "—";
  }

  function sourceKind(row) {
    if (row.manual_source === "call") return "call";
    if (row.manual_source === "manual") return "manual";
    return row.signup_channel === "our_link" ? "our_link" : "website";
  }

  function sourceBadge(row) {
    return SOURCE_LABEL[sourceKind(row)] || SOURCE_LABEL.website;
  }

  function sectorLabels(row) {
    const slugs = Array.isArray(row.categories) ? row.categories.filter(Boolean) : [];
    if (slugs.length) return slugs.map(slug => SECTORS[slug] || slug);
    return Array.isArray(row.interests) && row.interests.length ? row.interests : ["לא צוין"];
  }

  function subLabels(row) {
    const slugs = Array.isArray(row.subcategories) ? row.subcategories.filter(Boolean) : [];
    return slugs.map(slug => SUBS[slug] || slug);
  }

  function flagLabels(row) {
    const slugs = Array.isArray(row.flags) ? row.flags.filter(Boolean) : [];
    return slugs.map(slug => FLAGS[slug] || slug);
  }

  function regionLabels(row) {
    const slugs = Array.isArray(row.regions) ? row.regions.filter(Boolean) : [];
    if (slugs.length) return slugs.map(slug => REGIONS[slug] || slug);
    return [row.region || "לא צוין"];
  }

  function budgetLabel(row) {
    if (row.budget_open) return "פתוח להצעות";
    const min = row.budget_min == null ? null : Number(row.budget_min);
    const max = row.budget_max == null ? null : Number(row.budget_max);
    if (min == null && max == null) return "לא צוין";
    const text = value => {
      if (value == null || Number.isNaN(value)) return "";
      if (value >= 1000000) return (value / 1000000).toLocaleString("he-IL") + " מ׳";
      if (value >= 1000) return (value / 1000).toLocaleString("he-IL") + " אלף";
      return value.toLocaleString("he-IL");
    };
    if (min != null && max != null) return text(min) + "–" + text(max);
    if (max != null) return "עד " + text(max);
    return "מ-" + text(min);
  }

  function lookingLine(row) {
    const free = String(row.looking_for || "").trim();
    const bits = [sectorLabels(row).slice(0, 2).join(", "), regionLabels(row).slice(0, 2).join(", ")].filter(part => part && part !== "לא צוין");
    if (free) bits.push(free.length > 42 ? free.slice(0, 42) + "…" : free);
    return bits.join(" · ") || "לא צוין";
  }

  function liveInteractions(row) {
    return (Array.isArray(row.interactions) ? row.interactions : []).filter(item => !item.deleted_at);
  }

  function contactStats(row) {
    const items = liveInteractions(row);
    const hasLog = Array.isArray(row.interactions);
    const calls = hasLog
      ? items.filter(item => item.kind === "call")
      : [];
    const callCount = hasLog ? calls.length : Number(row.call_count || 0);
    const answered = hasLog
      ? calls.filter(item => item.outcome === "answered").length
      : Number(row.answered_count || 0);
    const noAnswer = hasLog
      ? calls.filter(item => item.outcome === "no_answer").length
      : Number(row.no_answer_count || 0);
    const decided = answered + noAnswer;
    const unknown = hasLog
      ? items.filter(item => item.outcome == null || item.outcome === "").length
      : Number(row.unknown_count ?? Math.max(0, callCount - answered - noAnswer));
    const times = items.map(item => item.at).filter(Boolean).sort();
    return {
      sends: Number(row.send_count || (Array.isArray(row.sends) ? row.sends.length : 0) || 0),
      calls: callCount,
      answered,
      noAnswer,
      unknown,
      answerRate: decided ? Math.round(answered / decided * 100) : null,
      lastContact: times.length ? times[times.length - 1] : (row.last_contact_at || null)
    };
  }

  function answerRateText(rate) {
    return rate == null ? "לא ידוע" : rate + "%";
  }

  function waDigits(phone) {
    let digits = String(phone || "").replace(/\D/g, "");
    if (digits.startsWith("00")) digits = digits.slice(2);
    if (digits.startsWith("0")) digits = "972" + digits.slice(1);
    return digits;
  }

  function waHref(phone, text) {
    const digits = waDigits(phone);
    const note = text || "שלום, כאן BSD - עסקים למכירה.\nיש עדכון קצר שעשוי להתאים לך, רק אם נוח.\nלהסרה השב/י הסר";
    return digits ? "https://wa.me/" + digits + "?text=" + encodeURIComponent(note) : "";
  }

  function splitName(name) {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    return { first_name: parts[0] || "", last_name: parts.slice(1).join(" ") || "—" };
  }

  function manualAdd(input) {
    const name = splitName(input && input.name);
    if (!name.first_name || !String(input && input.phone || "").trim()) return { ok: false, error: "missing_required_fields" };
    const emailOn = input.consent_email === true;
    const whatsappOn = input.consent_whatsapp === true;
    if (emailOn && !CONSENT_METHODS.includes(input.consent_email_method)) return { ok: false, error: "consent_method" };
    if (whatsappOn && !CONSENT_METHODS.includes(input.consent_whatsapp_method)) return { ok: false, error: "consent_method" };
    const consented = emailOn || whatsappOn;
    return {
      ok: true,
      row: {
        first_name: name.first_name,
        last_name: name.last_name,
        phone: String(input.phone).trim(),
        email: String(input.email || "").trim() || null,
        categories: input.categories || [],
        regions: input.regions || [],
        budget_min: input.budget_min ?? null,
        budget_max: input.budget_max ?? null,
        budget_open: input.budget_open === true,
        consent_email: emailOn,
        consent_whatsapp: whatsappOn,
        consent_email_method: emailOn ? input.consent_email_method : null,
        consent_whatsapp_method: whatsappOn ? input.consent_whatsapp_method : null,
        consent_email_note: emailOn ? (String(input.consent_email_note || "").trim() || null) : null,
        consent_whatsapp_note: whatsappOn ? (String(input.consent_whatsapp_note || "").trim() || null) : null,
        consent_general: consented,
        consent_method: null,
        consent_text: null,
        status: consented ? "active" : "pending_consent",
        legacy_no_consent: !consented,
        signup_channel: "our_link",
        manual_source: "call"
      }
    };
  }

  function sendSummary(row) {
    const count = Number(row.send_count || (Array.isArray(row.sends) ? row.sends.length : 0) || 0);
    if (!count) return "עדיין לא נשלח";
    const when = row.last_sent_at ? new Date(row.last_sent_at).toLocaleDateString("he-IL") : "";
    return count + " עסקים" + (when ? " · " + when : "");
  }

  function passesFilters(row, filters) {
    const source = (filters && (filters.source || filters.channel)) || "all";
    if (!inChannel(row, source)) return false;
    if (filters && filters.sector) {
      const labels = sectorLabels(row);
      const slugs = Array.isArray(row.categories) ? row.categories : [];
      const interests = Array.isArray(row.interests) ? row.interests : [];
      if (!labels.includes(filters.sector) && !slugs.includes(filters.sector) && !interests.includes(filters.sector)) return false;
    }
    if (filters && filters.region) {
      const labels = regionLabels(row);
      const slugs = Array.isArray(row.regions) ? row.regions : [];
      if (!labels.includes(filters.region) && !slugs.includes(filters.region) && row.region !== filters.region) return false;
    }
    const min = !filters || filters.budgetMin === "" || filters.budgetMin == null ? null : Number(filters.budgetMin);
    const max = !filters || filters.budgetMax === "" || filters.budgetMax == null ? null : Number(filters.budgetMax);
    if (min != null && !Number.isNaN(min) && row.budget_open !== true && row.budget_max != null && Number(row.budget_max) < min) return false;
    if (max != null && !Number.isNaN(max) && row.budget_open !== true && row.budget_min != null && Number(row.budget_min) > max) return false;
    const status = (filters && filters.status) || "";
    if (!status) return true;
    if (status === "legacy") return row.legacy_no_consent === true || row.consent_general !== true;
    if (status === "do_not_call") return row.do_not_call === true;
    if (status === "unsubscribed_all") return row.status === "unsubscribed_all" || row.status === "unsubscribed";
    return row.status === status;
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
      emailConsent: 0, whatsappConsent: 0, doNotCall: 0, awaitingConsent: 0, sends: 0,
      calls: 0, answered: 0, noAnswer: 0, unknown: 0, answerRate: null,
      regions: {}, sectors: {}, campaigns: {}, sources: {}, months: {}, bySourceMonth: {}
    };
    rows.forEach(row => {
      if (row.created_at && new Date(row.created_at).getTime() >= week) summary.newThisWeek += 1;
      if (row.status === "active") summary.active += 1;
      if (isClosed(row.status)) summary.unsubscribed += 1;
      if (row.do_not_call === true) summary.doNotCall += 1;
      const contact = contactStats(row);
      summary.sends += contact.sends;
      summary.calls += contact.calls;
      summary.answered += contact.answered;
      summary.noAnswer += contact.noAnswer;
      summary.unknown += contact.unknown;
      const marketed = row.legacy_no_consent !== true && row.consent_general === true;
      if (!marketed) summary.awaitingConsent += 1;
      const emailClosed = row.status === "unsubscribed_email" || row.status === "unsubscribed_all" || row.status === "unsubscribed" || !!row.email_unsubscribed_at;
      const whatsappClosed = row.status === "unsubscribed_whatsapp" || row.status === "unsubscribed_all" || row.status === "unsubscribed" || !!row.whatsapp_unsubscribed_at;
      if (marketed && row.consent_email === true && !emailClosed) summary.emailConsent += 1;
      if (marketed && row.consent_whatsapp === true && !whatsappClosed) summary.whatsappConsent += 1;
      regionLabels(row).forEach(region => { summary.regions[region] = (summary.regions[region] || 0) + 1; });
      sectorLabels(row).forEach(interest => { summary.sectors[interest] = (summary.sectors[interest] || 0) + 1; });
      const campaign = row.utm_campaign || "בלי קמפיין";
      summary.campaigns[campaign] = (summary.campaigns[campaign] || 0) + 1;
      const source = sourceBadge(row);
      summary.sources[source] = (summary.sources[source] || 0) + 1;
      const month = row.created_at ? String(row.created_at).slice(0, 7) : "—";
      summary.months[month] = (summary.months[month] || 0) + 1;
      const sourceMonth = month + " " + source;
      summary.bySourceMonth[sourceMonth] = (summary.bySourceMonth[sourceMonth] || 0) + 1;
    });
    const decided = summary.answered + summary.noAnswer;
    summary.answerRate = decided ? Math.round(summary.answered / decided * 100) : null;
    return summary;
  }

  function inChannel(row, channel) {
    if (!channel || channel === "all") return true;
    const kind = sourceKind(row);
    if (channel === "our_link") return kind !== "website";
    return kind === channel;
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
        categories: ["food"], subcategories: ["bakery"], flags: ["franchise"], regions: ["center"],
        taxonomy_version: "v1-2026-11-13", looking_for: "מאפייה קטנה במרכז",
        do_not_call: false, manager_notes: "", view_count: 2, handled_at: null, budget_open: true,
        send_count: 1, last_sent_at: today,
        interactions: [
          { id: "i1", at: today, kind: "call", direction: "out", outcome: "answered", note: "", deleted_at: null },
          { id: "i2", at: old, kind: "call", direction: "out", outcome: "no_answer", note: "", deleted_at: null },
          { id: "i3", at: today, kind: "whatsapp", direction: "out", outcome: null, note: "", deleted_at: null }
        ],
        sends: [{ business_number: "1042", internal_name: "מאפיית הדגמה הפנימית", sent_at: today, channel: "email", match_pct: 86, opened_at: null, replied_at: null }],
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
        signup_channel: "our_link", manual_source: "link", utm_campaign: "wa-baruch", utm_source: "whatsapp", utm_medium: "link",
        categories: ["construction"], regions: ["north"], looking_for: "נגרייה או ייצור", send_count: 0, sends: []
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
        signup_channel: "our_link", manual_source: "call", utm_campaign: "wa-baruch", send_count: 0, sends: []
      },
      {
        id: "sample-5", first_name: "אורי", last_name: "לדוגמה", phone: "050-0000005", email: "sample.uri@example.com",
        region: "שרון", interests: ["קמעונאות"], status: "active", created_at: today,
        consent_general: true, consent_email: true, consent_whatsapp: true, legacy_no_consent: false,
        consent_text: "אני מאשר/ת לקבל מ-BSD עדכונים ופרסומות על עסקים למכירה",
        consent_version: "v1-2026-11-13", consent_at: today, do_not_call: false,
        categories: ["retail"], regions: ["sharon"], looking_for: "חנות שכונתית",
        budget_open: false, budget_min: 500000, budget_max: 1000000,
        signup_channel: "our_link", manual_source: "manual", send_count: 0, sends: [], views: []
      },
      {
        id: "sample-6", first_name: "גל", last_name: "לדוגמה", phone: "050-0000006", email: null,
        region: "כל הארץ", interests: ["אחר"], status: "pending_consent", created_at: today,
        consent_general: false, consent_email: false, consent_whatsapp: false, legacy_no_consent: true,
        consent_text: null, consent_method: null, do_not_call: false,
        signup_channel: "our_link", manual_source: "call", send_count: 0, sends: [], interactions: [], views: []
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
    esc, statusLabel, summarize, filterRows, inChannel, sampleAllowed, sampleRows, bars, reasonText, startOfWeekJerusalem,
    sourceKind, sourceBadge, sectorLabels, subLabels, flagLabels, regionLabels, budgetLabel, lookingLine, sendSummary, passesFilters, SOURCE_LABEL,
    contactStats, answerRateText, waHref, manualAdd, CONSENT_METHODS
  };
})(typeof window !== "undefined" ? window : globalThis);
