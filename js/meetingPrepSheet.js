// Printable two-page meeting sheet. Read-only: it never writes and never sends.
// Layout is the approved template (meeting-prep-sheet.template.html).
(function (root) {
  const UNK = "לבירור";
  const QUESTIONS = [
    "שם העסק המדויק, ח.פ./ע.מ. וכתובת מדויקת?",
    "האם הבעלים היחיד, ומה מעמד פעילות נוספת במקום?",
    "כמה עובדים — והאם ימשיכו אחרי המכירה?",
    "מחיר מבוקש, ומה כלול?",
    "רווח נקי, וחלוקה בין הפעילויות?",
    "חוזה השכירות: תקופה, העברה ואופציות?",
    "מתי המעבר, והאם העסק הוצע לאחרים?"
  ];
  const DOCUMENTS = [
    "דוחות 2–3 שנים ומחזורים",
    "חוזה שכירות",
    "רשימת ציוד",
    "רישיון עסק וביטוחים",
    "רשימת עובדים",
    "תעודת עוסק ות״ז",
    "תמונות לתיק אנונימי"
  ];
  const NOTE_SECTIONS = [
    { class: "amber", title: "נתונים כספיים שנשמעו" },
    { class: "green", title: "צוות ושכירות" },
    { class: "purple", title: "מוטיבציה ולוח זמנים" },
    { class: "teal", title: "צעדים הבאים / הסכם" }
  ];

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[character]));
  }
  function unk() {
    return '<span class="unk">לבירור</span>';
  }
  function present(value) {
    if (value == null) return "";
    const text = String(value).trim();
    return text;
  }
  function money(value) {
    if (value == null || value === "") return "";
    const number = Number(value);
    if (!Number.isFinite(number)) return present(value);
    return number.toLocaleString("he-IL") + " ₪";
  }
  function fact(label, value) {
    const text = present(value);
    if (!text || text === UNK) return { label, unknown: true };
    return { label, value: text };
  }
  function factRow(item) {
    const unknown = item.unknown || item.value == null || item.value === "" || item.value === UNK;
    const val = unknown ? unk() : esc(item.value);
    return `<div class="row"><div class="k">${esc(item.label)}</div><div class="v">${val}</div></div>`;
  }
  function questionsHtml(items, lines) {
    return items.map((question, index) => {
      const rows = Array.from({ length: lines }, () => '<div class="ln"></div>').join("");
      return `<div class="q"><div class="qn"><span class="n">${index + 1}</span> ${esc(question)}</div>${rows}</div>`;
    }).join("\n");
  }
  function documentsHtml(items) {
    return items.map(item => `<li><span class="box"></span><span>${esc(item)}</span></li>`).join("\n");
  }
  function notesHtml(sections) {
    return sections.map(section => {
      const lines = Array.from({ length: 12 }, () => '<div class="line"></div>').join("");
      return `<div class="note-sec"><h2 class="${esc(section.class)}">${esc(section.title)}</h2><div class="body">${lines}</div></div>`;
    }).join("\n");
  }
  function bulletsHtml(items) {
    const list = items && items.length ? items : [UNK];
    return list.map(item => `<li>${item === UNK ? unk() : esc(item)}</li>`).join("\n");
  }
  function htmlOrUnknown(value) {
    const text = present(value);
    return text ? esc(text) : unk();
  }
  function fill(template, data, questionLines) {
    const lines = questionLines == null ? 1 : questionLines;
    const lead = present(data.lead_code);
    const business = present(data.business_code);
    const repl = {
      LOGO_SRC: data.logo_src || "assets/meeting-prep-logo.png",
      PERSON_NAME: present(data.person_name) || UNK,
      MEETING_DATE: present(data.meeting_date) || UNK,
      MEETING_TIME: present(data.meeting_time) || UNK,
      MEETING_PLACE: present(data.meeting_place) || UNK,
      PHONE: present(data.phone) || UNK,
      LEAD_CODE: lead,
      BUSINESS_CODE: business,
      BUSINESS_CODE_SEP: lead && business ? " · " : "",
      PURPOSE: htmlOrUnknown(data.purpose),
      PREPARED_ON: present(data.prepared_on),
      MISSING_FIELDS: present(data.missing_fields) || UNK,
      FACTS_HTML: (data.facts || []).map(factRow).join("\n"),
      CALL_FACTS_HTML: bulletsHtml(data.call_facts),
      BUSINESS_BLURB: htmlOrUnknown(data.business_blurb),
      ONLINE_HTML: bulletsHtml(data.online_presence),
      MARKET_HTML: bulletsHtml(data.market_research),
      MARKET_SOURCES: htmlOrUnknown(data.market_sources),
      QUESTIONS_HTML: questionsHtml(data.questions || QUESTIONS, lines),
      DOCUMENTS_HTML: documentsHtml(data.documents || DOCUMENTS),
      NOTES_HTML: notesHtml(data.note_sections || NOTE_SECTIONS)
    };
    let out = String(template || "");
    Object.keys(repl).forEach(key => {
      out = out.split("{{" + key + "}}").join(repl[key]);
    });
    return out;
  }

  function dateLabel(iso) {
    if (!iso) return "";
    const date = new Date(String(iso).slice(0, 10) + "T12:00:00");
    if (Number.isNaN(date.getTime())) return "";
    const weekday = date.toLocaleDateString("he-IL", { weekday: "long" });
    const day = date.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "numeric" });
    return `${weekday} ${day}`;
  }
  function clock(value) {
    const text = present(value);
    if (!text) return "";
    return text.slice(0, 5);
  }
  function nextMeeting(meetings, now) {
    const today = (now || new Date()).toISOString().slice(0, 10);
    return (meetings || [])
      .filter(item => item && !item.deleted_at && String(item.meeting_date || "") >= today)
      .sort((a, b) => String(a.meeting_date).localeCompare(String(b.meeting_date)) || String(a.start_time || "").localeCompare(String(b.start_time || "")))[0] || null;
  }
  function historyText(notes, meetings) {
    const bits = [];
    const note = present(notes);
    if (note) bits.push(note.length > 700 ? note.slice(0, 700) + "…" : note);
    (meetings || []).filter(item => present(item && item.summary_text)).slice(0, 4).forEach(item => {
      bits.push(`${item.meeting_date || ""} — ${present(item.summary_text)}`);
    });
    return bits.join(" ");
  }
  function tenure(years) {
    if (years == null || years === "") return null;
    return `${years} שנים · שטח ${UNK}`;
  }
  function profit(record) {
    const net = money(record && record.net_profit);
    const operating = money(record && record.operating_profit);
    if (!net && !operating) return "";
    return [net ? "נקי " + net : "", operating ? "תפעולי " + operating : ""].filter(Boolean).join(" · ");
  }
  function legal(record) {
    const name = present(record && (record.legal_name || record.company));
    const id = present(record && record.id_number);
    return [name, id].filter(Boolean).join(" · ");
  }
  function distribution(record) {
    if (!record || (record.public_listing_active == null && !record.listing_status)) return "";
    const site = record.public_listing_active === true ? "מופץ באתר" : record.public_listing_active === false ? "לא מופץ באתר" : "";
    const listing = { active: "סטטוס מכירה: פעיל", removed: "עסקה לא פעילה", sold: "נמכר" }[record.listing_status] || "";
    return [site, listing].filter(Boolean).join(" · ");
  }
  function addressOf(record, lead) {
    const businessAddress = [present(record && record.address), present(record && record.city)].filter(Boolean).join(", ");
    if (businessAddress) return businessAddress;
    return [present(lead && lead.business_address), present(lead && lead.business_city), present(lead && lead.address), present(lead && lead.city)].filter(Boolean).join(", ");
  }

  function buildMeetingSheet({ business, lead, meetings, now, logoSrc }) {
    const biz = business || null;
    const seller = lead && lead.type === "seller" ? lead : (lead || null);
    const upcoming = nextMeeting(meetings, now);
    const start = clock(upcoming && upcoming.start_time);
    const end = clock(upcoming && upcoming.end_time);
    const when = start && end ? `${start}–${end}` : start;
    const place = present(upcoming && upcoming.location);
    const cardAddress = addressOf(biz, seller);
    const unverified = [];
    if (place && cardAddress && place !== cardAddress) {
      unverified.push(`מקום הפגישה ביומן (${place}) שונה מכתובת הכרטיס (${cardAddress}).`);
    }
    const person = present(biz && biz.owner_name) || present(seller && seller.full_name) || [present(seller && seller.first_name), present(seller && seller.last_name)].filter(Boolean).join(" ");
    const phone = present(biz && biz.owner_phone) || present(seller && seller.phone);
    const email = present(biz && biz.owner_email) || present(seller && seller.email);
    const leadCode = present(seller && seller.client_number);
    const businessCode = present(biz && biz.business_number);
    const sector = [present(biz && biz.field), present(biz && biz.category), present(biz && biz.subcategory), present(seller && seller.business_field)].filter(Boolean);
    const uniqueSector = [...new Set(sector)].join(", ");
    const prepared = (now || new Date()).toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Jerusalem" });
    const codes = [leadCode, businessCode].filter(Boolean).join(" / ");
    const agreement = present(biz && biz.agreement_status) || present(seller && seller.agreement_status);
    const spread = distribution(biz);
    const research = present(biz && biz.pre_research) || present(seller && seller.pre_research);
    const website = present(biz && biz.website) || present(seller && seller.website);
    const description = present(biz && biz.short_description);
    const callFacts = [];
    const pushCall = text => {
      const line = present(text);
      if (!line || callFacts.length >= 3) return;
      callFacts.push(line.length > 220 ? line.slice(0, 220) + "…" : line);
    };
    if (place && cardAddress && place !== cardAddress) pushCall(`מקום ביומן (${place}) שונה מכתובת הכרטיס (${cardAddress}).`);
    present((biz && biz.notes) || (seller && seller.notes)).split(/\n+/).forEach(pushCall);
    (meetings || []).forEach(item => pushCall(item && item.summary_text ? `${item.meeting_date || ""} — ${item.summary_text}` : ""));
    const blurbBits = [description ? description.replace(/\s+/g, " ") : "", uniqueSector, biz && biz.years_active ? biz.years_active + " שנים" : "", present(biz && biz.sale_reason) || present(seller && seller.sale_reason)].filter(Boolean);
    const missing = [];
    if (!money((biz && biz.asking_price) || (seller && seller.asking_price))) missing.push("מחיר מבוקש");
    if (!profit(biz)) missing.push("רווח");
    if (!(biz && biz.employees_count != null && biz.employees_count !== "")) missing.push("עובדים");
    if (!legal(biz || seller)) missing.push("ח.פ.");
    missing.push("עמלה", "חוזה שכירות");
    return {
      logo_src: logoSrc || "assets/meeting-prep-logo.png",
      person_name: person,
      meeting_date: upcoming ? dateLabel(upcoming.meeting_date) : "",
      meeting_time: when,
      meeting_place: place,
      phone,
      lead_code: leadCode,
      business_code: businessCode,
      prepared_on: "עודכן ב-" + prepared,
      purpose: "",
      missing_fields: missing.join(", "),
      call_facts: callFacts,
      business_blurb: blurbBits.join(", ").slice(0, 240),
      online_presence: website ? ["אתר בכרטיס: " + website] : [],
      market_research: research ? research.split(/\n+/).map(line => present(line)).filter(Boolean).slice(0, 3).map(line => line.length > 220 ? line.slice(0, 220) + "…" : line) : [],
      market_sources: research ? "מקור: חקר מקדים בכרטיס" : "",
      questions: QUESTIONS,
      documents: DOCUMENTS,
      note_sections: NOTE_SECTIONS,
      facts: [
        fact("איש קשר", person ? person + " · מוכר" : ""),
        fact("מייל", email),
        fact("ליד / עסק", codes),
        fact("כתובת CRM", cardAddress),
        fact("הסכם / הפצה", [agreement, spread].filter(Boolean).join(" · ")),
        fact("פתיחת תיק", "")
      ]
    };
  }

  function renderHtml(template, data) {
    return fill(template, data, 1);
  }

  function logoUrl() {
    if (typeof location === "undefined" || !location.href) return "assets/meeting-prep-logo.png";
    return new URL("assets/meeting-prep-logo.png", location.href).href;
  }

  async function templateText() {
    const url = new URL("meeting-prep-sheet.template.html", location.href);
    const response = await fetch(url);
    if (!response.ok) throw new Error("template");
    return response.text();
  }

  async function meetingsFor(column, id) {
    if (!id || !root.supabaseClient) return [];
    const { data, error } = await root.supabaseClient.from("match_meetings")
      .select("meeting_date,start_time,end_time,location,summary_text,meeting_type,notes,deleted_at")
      .eq(column, id)
      .is("deleted_at", null)
      .order("meeting_date", { ascending: true });
    if (error) return [];
    return data || [];
  }

  function printHtml(html) {
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const tab = window.open(url, "_blank");
    if (!tab) return;
    const start = () => {
      try { tab.focus(); tab.print(); } catch (ignore) { /* the sheet is still open to print */ }
    };
    tab.addEventListener ? tab.addEventListener("load", start) : setTimeout(start, 400);
  }

  async function openSheet(data) {
    const html = renderHtml(await templateText(), { ...data, logo_src: logoUrl() });
    printHtml(html);
  }

  async function openFromBusiness(business) {
    if (!business || !business.id) return;
    const meetings = await meetingsFor("business_id", business.id);
    await openSheet(buildMeetingSheet({ business, meetings, now: new Date(), logoSrc: logoUrl() }));
  }

  async function openFromSeller(lead) {
    if (!lead || !lead.id) return;
    const meetings = await meetingsFor("buyer_id", lead.id);
    await openSheet(buildMeetingSheet({ lead, meetings, now: new Date(), logoSrc: logoUrl() }));
  }

  const api = {
    UNK, QUESTIONS, DOCUMENTS, fill, buildMeetingSheet, renderHtml, openFromBusiness, openFromSeller
  };
  root.BSDMeetingSheet = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
