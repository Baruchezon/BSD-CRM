// גרסת CRM: המודולים נטענים כתגי <script> רגילים לפני קובץ זה. בניגוד
// לגרסה העצמאית, האחוזים נטענים כאן מ-Supabase (א-סינכרוני) ולא מ-
// localStorage, ולכן כל האתחול קורה בתוך main() בתחתית הקובץ, אחרי
// requireAuth() ואחרי טעינת האחוזים בפועל — לא ברמת המודול כמו קודם.
const { calculateDeal, computeUserEarnings } = BSDEngine;
const { renderFlowDiagram, fmtILS } = BSDMap;

let rules; // מוקצה בתוך main(), אחרי טעינה מוצלחת מ-Supabase
let CURRENT_USER_PROFILE = null; // מוקצה בתוך main(), מה-requireAuth() המשותף

/**
 * חמשת סוגי המשתמשים (userType) — נקבעים בשלב הראשון, לפני כל דבר אחר.
 * לכל סוג משתמש: track+role פנימיים (למנוע החישוב), תווית לכרטיס, תווית
 * לצפייה ("אתה צופה כ..."), ופועל-המילה המתאים ("עמלה" לסוכנים, "הכנסה" לבעלים).
 * זהו המיפוי היחיד בין userType לבין track/role — לא מוסק משום מקום אחר.
 */
const USER_TYPES = [
  {
    key: "authorizedAgent",
    track: "authorizedAgent",
    role: "agent",
    label: "סוכן מורשה",
    sub: "פועל ישירות מול BSD",
    earningsNoun: "עמלה",
  },
  {
    key: "officeOwner",
    track: "regional",
    role: "owner",
    label: "בעל נציגות BSD",
    sub: "רואה את חלק הנציגות בעסקה",
    earningsNoun: "הכנסה",
  },
  {
    key: "franchiseOwner",
    track: "franchise",
    role: "owner",
    label: "בעל זכיינות BSD",
    sub: "רואה את חלק הזכיינות בעסקה",
    earningsNoun: "הכנסה",
  },
  {
    key: "officeAgent",
    track: "regional",
    role: "agent",
    label: "סוכן תחת נציגות BSD",
    sub: "רואה את העמלה האישית שלו",
    earningsNoun: "עמלה",
  },
  {
    key: "franchiseAgent",
    track: "franchise",
    role: "agent",
    label: "סוכן תחת זכיינות BSD",
    sub: "רואה את העמלה האישית שלו",
    earningsNoun: "עמלה",
  },
  {
    key: "referrer",
    track: null, // המפנה אינו קשור למסלול קבוע — נבחר בנפרד (state.referrerTrack)
    role: "referrer",
    label: "מפנה",
    sub: "הביא ליד או לקוח, לא בהכרח מטפל",
    earningsNoun: "עמלה",
  },
];

// מסלולים שהמפנה יכול לבחור מהם (מוצג רק כשנבחר userType='referrer')
const REFERRER_TRACK_OPTIONS = ["authorizedAgent", "regional", "franchise"];

function userTypeMeta(key) {
  return USER_TYPES.find((t) => t.key === key);
}

// ---------------------------------------------------------------------
// מצב נוכחי של הסימולטור
// ---------------------------------------------------------------------
const state = {
  userType: null, // null עד לבחירה מפורשת — הסימולטור מוסתר עד אז
  referrerTrack: "authorizedAgent", // רלוונטי רק כש-userType==='referrer'
  dealValue: 2000000,
  seller: { arrivedVia: "network", isUserTreatingAgent: true, hasReferral: false, isUserReferrer: false },
  buyer: { arrivedVia: "network", isUserTreatingAgent: true, hasReferral: false, isUserReferrer: false },
};

/** המסלול בפועל של העסקה: קבוע לפי userType, או נבחר בנפרד עבור מפנה */
function currentTrack() {
  const meta = userTypeMeta(state.userType);
  return meta.track || state.referrerTrack;
}

function resetSideConfigs() {
  state.seller = { arrivedVia: "network", isUserTreatingAgent: true, hasReferral: false, isUserReferrer: false };
  state.buyer = { arrivedVia: "network", isUserTreatingAgent: true, hasReferral: false, isUserReferrer: false };
}

// ---------------------------------------------------------------------
// שלב 1: "מי אתה במודל BSD?" — 5 כרטיסים, ללא איחוד ביניהם
// ---------------------------------------------------------------------
function renderUserTypeSelector() {
  const wrap = document.getElementById("userTypeSelector");
  wrap.innerHTML = USER_TYPES.map((t) => {
    const trackRules = t.track ? rules[t.track] : null;
    const disabled = t.track ? (!trackRules || trackRules.enabled === false) : false;
    const active = state.userType === t.key && !disabled;
    return `
      <div class="user-type-card ${active ? "active" : ""} ${disabled ? "disabled" : ""}" data-usertype="${t.key}" title="${disabled ? (trackRules && trackRules.note) || "אינו זמין עדיין" : ""}">
        ${disabled ? '<span class="soon-badge">בקרוב</span>' : ""}
        <div class="ut-title">${t.label}</div>
        <div class="ut-sub">${t.sub}</div>
      </div>`;
  }).join("");

  wrap.querySelectorAll(".user-type-card").forEach((el) => {
    el.addEventListener("click", () => {
      const key = el.dataset.usertype;
      const meta = userTypeMeta(key);
      if (meta.track) {
        const trackRules = rules[meta.track];
        if (!trackRules || trackRules.enabled === false) return;
      }
      state.userType = key;
      resetSideConfigs();
      renderUserTypeSelector();
      renderReferrerTrackCard();
      renderSideConfig("seller");
      renderSideConfig("buyer");
      updateViewingAsBanner();
      document.getElementById("simulatorBody").style.display = "block";
      document.getElementById("noSelectionPlaceholder").style.display = "none";
      recompute();
    });
  });
}

/**
 * מסלול העסקה עבור מפנה — מוצג רק כש-userType==='referrer', כי המפנה אינו
 * קשור מראש למסלול קבוע (יכול להפנות עסקת סוכן מורשה, נציגות, או זכיינות).
 */
function renderReferrerTrackCard() {
  const card = document.getElementById("referrerTrackCard");
  const isReferrer = state.userType === "referrer";
  card.style.display = isReferrer ? "block" : "none";
  if (!isReferrer) return;

  const wrap = document.getElementById("referrerTrackSelector");
  wrap.innerHTML = REFERRER_TRACK_OPTIONS.map((key) => {
    const trackRules = rules[key];
    const disabled = !trackRules || trackRules.enabled === false;
    const active = state.referrerTrack === key && !disabled;
    return `
      <div class="pill ${active ? "active" : ""} ${disabled ? "disabled" : ""}" data-track="${key}" title="${disabled ? (trackRules && trackRules.note) || "אינו זמין עדיין" : ""}">
        ${disabled ? '<span class="soon-badge">בקרוב</span>' : ""}
        ${trackRules ? trackRules.label : key}
      </div>`;
  }).join("");

  wrap.querySelectorAll(".pill").forEach((el) => {
    el.addEventListener("click", () => {
      const key = el.dataset.track;
      if (rules[key] && rules[key].enabled === false) return;
      state.referrerTrack = key;
      renderReferrerTrackCard();
      recompute();
    });
  });
}

function updateViewingAsBanner() {
  const banner = document.getElementById("viewingAsBanner");
  if (!state.userType) {
    banner.style.display = "none";
    return;
  }
  const meta = userTypeMeta(state.userType);
  banner.style.display = "block";
  banner.textContent = `אתה צופה כ${meta.label}`;
}

// ---------------------------------------------------------------------
// בניית בורר "מיקום בעסקה" לכל צד — טופס מצומצם לבעלים, מלא לסוכנים.
// כלל חשוב: גורם מטפל אינו יכול להיות גם גורם מפנה על אותו צד — אם המשתמש
// הוא הסוכן המטפל, אין לו אפשרות לסמן את עצמו גם כמפנה על אותו צד.
// ---------------------------------------------------------------------
function renderSideConfig(side) {
  const containerId = side === "seller" ? "sellerSideConfig" : "buyerSideConfig";
  const container = document.getElementById(containerId);
  const s = state[side];
  const sideLabel = side === "seller" ? "מוכר" : "קונה";
  const meta = state.userType ? userTypeMeta(state.userType) : null;
  const isOwnerView = meta && meta.role === "owner";
  const isReferrerView = meta && meta.role === "referrer";

  if (isReferrerView) {
    // המפנה לא צריך לדעת דבר על שאר מבנה הצד — רק האם הוא זה שהפנה אותו.
    // (אם לא, מניחים לצורך התצוגה שאין הפניה בצד זה — המפנה אינו אחראי לדעת
    // על הפניות של אחרים.)
    container.innerHTML = `
      <div class="side-title">${side === "seller" ? "🏪 צד המוכר" : "🤝 צד הקונה"}</div>
      <div class="field-label">האם הפנית את ה${sideLabel}?</div>
      <div class="radio-row">
        <label class="radio-option">
          <input type="radio" name="${side}-referred" value="yes" ${s.isUserReferrer ? "checked" : ""}/>
          כן, אני המפנה
        </label>
        <label class="radio-option">
          <input type="radio" name="${side}-referred" value="no" ${!s.isUserReferrer ? "checked" : ""}/>
          לא, לא הפניתי צד זה
        </label>
      </div>
    `;

    container.querySelectorAll(`input[name="${side}-referred"]`).forEach((el) => {
      el.addEventListener("change", () => {
        const referred = el.value === "yes";
        s.isUserReferrer = referred;
        s.hasReferral = referred;
        s.arrivedVia = "network";
        s.isUserTreatingAgent = false;
        recompute();
      });
    });
    return;
  }

  if (isOwnerView) {
    // בעל הרשת לא צריך לדעת מי בדיוק טיפל/הפנה — רק מה שמשפיע על גובה
    // חלק הרשת/BSD (איך הצד הגיע, והאם יש מפנה).
    container.innerHTML = `
      <div class="side-title">${side === "seller" ? "🏪 צד המוכר" : "🤝 צד הקונה"}</div>

      <div class="field-label">איך הצד הגיע?</div>
      <div class="radio-row">
        <label class="radio-option">
          <input type="radio" name="${side}-arrived" value="network" ${s.arrivedVia === "network" ? "checked" : ""}/>
          דרך גורם ברשת (סוכן כלשהו)
        </label>
        <label class="radio-option">
          <input type="radio" name="${side}-arrived" value="bsd" ${s.arrivedVia === "bsd" ? "checked" : ""}/>
          הגיע ישירות מ-BSD
        </label>
      </div>

      <div id="${side}-referral-wrap" style="${s.arrivedVia === "bsd" ? "display:none;" : ""}">
        <label class="checkbox-row" style="margin-top:12px;">
          <input type="checkbox" id="${side}-referral-toggle" ${s.hasReferral ? "checked" : ""}/>
          יש גורם מפנה לצד זה
        </label>
      </div>
    `;

    container.querySelectorAll(`input[name="${side}-arrived"]`).forEach((el) => {
      el.addEventListener("change", () => {
        s.arrivedVia = el.value;
        if (el.value === "bsd") s.hasReferral = false;
        renderSideConfig(side);
        recompute();
      });
    });
    const referralToggle = document.getElementById(`${side}-referral-toggle`);
    if (referralToggle) {
      referralToggle.addEventListener("change", () => {
        s.hasReferral = referralToggle.checked;
        recompute();
      });
    }
    return;
  }

  // תצוגת סוכן (סוכן מורשה / סוכן תחת נציגות / סוכן תחת זכיינות)
  const referralWho = s.isUserTreatingAgent
    ? // המשתמש כבר מטפל בצד זה — הוא לא יכול להיות גם המפנה שלו. אין בחירה, המפנה הוא תמיד "אחר".
      `<div class="field-label">מי המפנה?</div>
       <div class="radio-row">
         <label class="radio-option" style="opacity:0.6;">
           <input type="radio" checked disabled/>
           גורם אחר (אתה כבר הסוכן המטפל בצד זה — לא ניתן להיות גם המפנה שלו)
         </label>
       </div>`
    : `<div class="field-label">מי המפנה?</div>
       <div class="radio-row">
         <label class="radio-option">
           <input type="radio" name="${side}-referral-party" value="me" ${s.isUserReferrer ? "checked" : ""}/>
           אני המפנה
         </label>
         <label class="radio-option">
           <input type="radio" name="${side}-referral-party" value="other" ${!s.isUserReferrer ? "checked" : ""}/>
           גורם אחר (גם אם חיצוני לגמרי ל-BSD)
         </label>
       </div>`;

  container.innerHTML = `
    <div class="side-title">${side === "seller" ? "🏪 צד המוכר" : "🤝 צד הקונה"}</div>

    <div class="field-label">מי מטפל בצד ה${sideLabel}?</div>
    <div class="radio-row">
      <label class="radio-option">
        <input type="radio" name="${side}-treating" value="me" ${s.arrivedVia === "network" && s.isUserTreatingAgent ? "checked" : ""}/>
        אני מטפל בצד זה
      </label>
      <label class="radio-option">
        <input type="radio" name="${side}-treating" value="other" ${s.arrivedVia === "network" && !s.isUserTreatingAgent ? "checked" : ""}/>
        גורם אחר מטפל
      </label>
      <label class="radio-option">
        <input type="radio" name="${side}-treating" value="bsd" ${s.arrivedVia === "bsd" ? "checked" : ""}/>
        הצד הגיע ישירות מ-BSD
      </label>
    </div>

    <div id="${side}-referral-wrap" style="${s.arrivedVia === "bsd" ? "display:none;" : ""}">
      <label class="checkbox-row" style="margin-top:12px;">
        <input type="checkbox" id="${side}-referral-toggle" ${s.hasReferral ? "checked" : ""}/>
        יש גורם מפנה לצד זה
      </label>
      <div class="sub-block" id="${side}-referral-who" style="display:${s.hasReferral ? "block" : "none"};">
        ${referralWho}
      </div>
    </div>
  `;

  container.querySelectorAll(`input[name="${side}-treating"]`).forEach((el) => {
    el.addEventListener("change", () => {
      if (el.value === "bsd") {
        s.arrivedVia = "bsd";
        s.isUserTreatingAgent = false;
        s.hasReferral = false;
      } else {
        s.arrivedVia = "network";
        s.isUserTreatingAgent = el.value === "me";
        // כלל: אם המשתמש עכשיו הסוכן המטפל, הוא לא יכול להישאר מסומן כמפנה
        if (s.isUserTreatingAgent) s.isUserReferrer = false;
      }
      renderSideConfig(side);
      recompute();
    });
  });

  const referralToggle = document.getElementById(`${side}-referral-toggle`);
  if (referralToggle) {
    referralToggle.addEventListener("change", () => {
      s.hasReferral = referralToggle.checked;
      document.getElementById(`${side}-referral-who`).style.display = s.hasReferral ? "block" : "none";
      recompute();
    });
  }

  container.querySelectorAll(`input[name="${side}-referral-party"]`).forEach((el) => {
    el.addEventListener("change", () => {
      s.isUserReferrer = el.value === "me";
      recompute();
    });
  });
}

// ---------------------------------------------------------------------
// שדה שווי עסקה — עיצוב מספר עם פסיקים בזמן אמת
// ---------------------------------------------------------------------
const dealValueInput = document.getElementById("dealValueInput");

function parseDealValue(raw) {
  const digits = raw.replace(/[^\d]/g, "");
  return digits ? parseInt(digits, 10) : 0;
}

function formatDealValueInput(num) {
  return num.toLocaleString("en-US");
}

function numberToHebrewWords(num) {
  if (num >= 1000000) {
    const millions = num / 1000000;
    return `${millions % 1 === 0 ? millions : millions.toFixed(1)} מיליון ₪`;
  }
  if (num >= 1000) {
    return `${Math.round(num / 1000)} אלף ₪`;
  }
  return "";
}

dealValueInput.addEventListener("input", () => {
  const num = parseDealValue(dealValueInput.value);
  state.dealValue = num;
  dealValueInput.value = formatDealValueInput(num);
  document.getElementById("dealValueWords").textContent = numberToHebrewWords(num);
  recompute();
});

// ---------------------------------------------------------------------
// בניית "עובדות העסקה" (dealFacts) ו"זיהוי המשתמש" (attribution) מתוך ה-state
// ---------------------------------------------------------------------
function buildDealFacts(side) {
  const s = state[side];
  return { track: currentTrack(), arrivedVia: s.arrivedVia, hasReferral: s.hasReferral };
}

function buildAttribution(side) {
  const meta = userTypeMeta(state.userType);
  if (meta.role === "owner") return { role: "owner" };
  const s = state[side];
  if (meta.role === "referrer") {
    return { role: "agent", isUserTreatingAgent: false, isUserReferrer: s.isUserReferrer };
  }
  return {
    role: "agent",
    // הגנה כפולה: גם אם משום מה שני הדגלים נדלקו, אף פעם לא סופרים את אותו
    // אדם פעמיים באותו צד (מטפל ומפנה הם תמיד גורמים שונים).
    isUserTreatingAgent: s.arrivedVia === "network" && s.isUserTreatingAgent,
    isUserReferrer: s.hasReferral && s.isUserReferrer && !s.isUserTreatingAgent,
  };
}

function earningsCardTitle() {
  const meta = userTypeMeta(state.userType);
  if (meta.role === "referrer") return "עמלת ההפניה שלך";
  return `ה${meta.earningsNoun} שלך כ${meta.label}`;
}

function earningsBreakdownNoun() {
  return userTypeMeta(state.userType).earningsNoun;
}

// ---------------------------------------------------------------------
// חישוב מחדש + רינדור מלא
// ---------------------------------------------------------------------
function recompute() {
  if (!state.userType) return;
  const errorEl = document.getElementById("validationBanner");

  let dealResult;
  try {
    dealResult = calculateDeal(
      {
        dealValue: state.dealValue,
        sellerFacts: buildDealFacts("seller"),
        buyerFacts: buildDealFacts("buyer"),
      },
      rules
    );
  } catch (e) {
    errorEl.className = "validation-banner error";
    errorEl.textContent = "שגיאת חישוב: " + e.message;
    return;
  }

  const { dealSummary, distributionValidation } = dealResult;

  if (!distributionValidation.isValid) {
    errorEl.className = "validation-banner error";
    errorEl.textContent = "⚠ שגיאת חישוב — סכום החלוקה אינו תואם לעמלה שנגבתה. יש לבדוק את הגדרות האחוזים.";
    document.getElementById("userEarningsAmount").textContent = "—";
    document.getElementById("flowDiagramContainer").innerHTML = "";
    document.getElementById("summaryGrid").innerHTML = "";
    document.getElementById("personalSummaryGrid").innerHTML = "";
    return;
  }
  errorEl.className = "validation-banner ok";
  errorEl.textContent = "✓ החישוב תקין";

  // --- שלב 2: זיהוי "מי אני" מתוך התוצאה שכבר חושבה ---
  let userEarnings;
  try {
    userEarnings = computeUserEarnings(dealResult, buildAttribution("seller"), buildAttribution("buyer"));
  } catch (e) {
    errorEl.className = "validation-banner error";
    errorEl.textContent = "שגיאת קלט: " + e.message;
    return;
  }
  const noun = earningsBreakdownNoun();

  // --- העמלה/ההכנסה שלך ---
  document.getElementById("userEarningsLabel").textContent = earningsCardTitle();
  document.getElementById("userEarningsAmount").textContent = fmtILS(userEarnings.total);
  const parts = [];
  if (userEarnings.sellerAmount > 0) parts.push(`${fmtILS(userEarnings.sellerAmount)} מהמוכר`);
  if (userEarnings.buyerAmount > 0) parts.push(`${fmtILS(userEarnings.buyerAmount)} מהקונה`);
  document.getElementById("userEarningsBreakdown").textContent = parts.length ? parts.join(" + ") : `אין לך חלק ב${noun} בעסקה זו`;

  // --- מפת הזרימה (מקבלת הדגשות מוכנות משלב הזיהוי, לא מחשבת בעצמה) ---
  const flowContainer = document.getElementById("flowDiagramContainer");
  renderFlowDiagram(flowContainer, dealResult, userEarnings);

  renderLegend();

  // --- הסיכום שלך ---
  const meta = userTypeMeta(state.userType);
  const personalItems = [
    { label: "התפקיד שלך", value: meta.label },
    { label: "שווי העסקה", value: fmtILS(dealSummary.dealValue) },
  ];
  if (meta.role === "referrer") {
    personalItems.push({ label: "אחוז הפניה", value: `${Math.round(rules.global.referralRate * 1000) / 10}%` });
    if (userEarnings.sellerAmount > 0) personalItems.push({ label: "עמלת צד מוכר (סה\"כ)", value: fmtILS(dealSummary.sellerCommission) });
    if (userEarnings.buyerAmount > 0) personalItems.push({ label: "עמלת צד קונה (סה\"כ)", value: fmtILS(dealSummary.buyerCommission) });
  }
  if (userEarnings.sellerAmount > 0) personalItems.push({ label: `${noun} מצד מוכר (שלך)`, value: fmtILS(userEarnings.sellerAmount) });
  if (userEarnings.buyerAmount > 0) personalItems.push({ label: `${noun} מצד קונה (שלך)`, value: fmtILS(userEarnings.buyerAmount) });
  personalItems.push({ label: `סה"כ ה${noun} שלך`, value: fmtILS(userEarnings.total) });
  personalItems.push({ label: "אחוז אפקטיבי מכלל העמלות", value: `${userEarnings.effectivePct}%` });

  document.getElementById("personalSummaryGrid").innerHTML = personalItems
    .map((it) => `<div class="summary-item"><div class="s-label">${it.label}</div><div class="s-value">${it.value}</div></div>`)
    .join("");

  // --- חלוקת העסקה המלאה ---
  const summaryItems = [
    { label: "עמלה מצד מוכר", value: fmtILS(dealSummary.sellerCommission) },
    { label: "עמלה מצד קונה", value: fmtILS(dealSummary.buyerCommission) },
    { label: "סה\"כ עמלות", value: fmtILS(dealSummary.totalCommission) },
    { label: "חלק הסוכן/ים", value: fmtILS(dealSummary.agentShare) },
    { label: "חלק הנציגות", value: fmtILS(dealSummary.regionalShare) },
    { label: "חלק הזכיינות", value: fmtILS(dealSummary.franchiseShare) },
    { label: "חלק מפנים", value: fmtILS(dealSummary.referralShare) },
    { label: "חלק BSD", value: fmtILS(dealSummary.bsdShare) },
  ];
  if (dealSummary.developmentManagerShare > 0) {
    summaryItems.push({ label: "חלק מנהל פיתוח", value: fmtILS(dealSummary.developmentManagerShare) });
  }

  document.getElementById("summaryGrid").innerHTML = summaryItems
    .map((it) => `<div class="summary-item"><div class="s-label">${it.label}</div><div class="s-value">${it.value}</div></div>`)
    .join("");
}

function renderLegend() {
  const legend = document.getElementById("legendContainer");
  const items = [
    { key: "agent", label: "סוכן מטפל" },
    { key: "regional", label: "נציגות / זכיינות" },
    { key: "referral", label: "מפנה" },
    { key: "dev", label: "מנהל פיתוח" },
    { key: "bsd", label: "BSD" },
  ];
  legend.innerHTML = items
    .map((it) => `<div class="legend-item"><span class="legend-dot" style="background:var(--role-${it.key})"></span>${it.label}</div>`)
    .join("");
}

// ---------------------------------------------------------------------
// ניהול אחוזים מוטמע — מוצג ומורכב ל-DOM רק אם role==='admin' בפועל.
// למשתמש שאינו אדמין הרכיב הזה לא קיים בעמוד כלל, לא רק מוסתר ב-CSS.
// שים לב: זהו קו ההגנה הראשון (UX) בלבד — קו ההגנה האמיתי הוא ה-RLS
// שהוגדר ב-migrations/2026-09-01_commission_simulator_rules.sql, שדוחה
// כל ניסיון שמירה ממי שאינו admin גם אם עוקפים את הממשק לגמרי.
// ---------------------------------------------------------------------
function renderAdminSectionIfAllowed() {
  if (!CURRENT_USER_PROFILE || CURRENT_USER_PROFILE.role !== "admin") {
    return; // לא admin — שום דבר לא נוסף ל-DOM, האופציה לא קיימת עבורו
  }

  const host = document.getElementById("adminSectionHost");
  if (!host) return;

  host.innerHTML = buildAdminSectionHtml();
  wireAdminSection();
}

function buildAdminSectionHtml() {
  return `
    <div class="cs-card" id="adminRulesCard">
      <h2>⚙️ ניהול אחוזים <span style="font-size:.72rem;font-weight:400;color:#8a8f9d;">(אדמין בלבד — אתה מחובר כאדמין, לא נדרשת סיסמה נוספת)</span></h2>
      <div id="adminRulesBody"></div>
      <div class="admin-error" id="adminSaveError"></div>
      <div class="admin-actions">
        <button class="cs-btn cs-btn-gold" id="adminSaveBtn">שמור שינויים</button>
        <button class="cs-btn cs-btn-ghost" id="adminResetBtn">אפס לברירת מחדל</button>
      </div>
    </div>
  `;
}

// עותק עבודה של האחוזים לשם עריכה — לא נוגע ב-rules החי עד לשמירה מוצלחת
let workingRules = null;
let adminFormValid = true;

function wireAdminSection() {
  workingRules = JSON.parse(JSON.stringify(rules));
  renderAdminFields();

  document.getElementById("adminSaveBtn").addEventListener("click", async () => {
    if (!adminFormValid) return;
    const btn = document.getElementById("adminSaveBtn");
    btn.disabled = true;
    btn.textContent = "שומר…";
    try {
      await BSDCommissionRules.saveCommissionRules(workingRules);
      rules = JSON.parse(JSON.stringify(workingRules)); // מיד משפיע על הסימולטור באותו עמוד
      recompute();
      renderUserTypeSelector(); // תלוי ב-rules (למשל מסלול זכיין מופעל/מבוטל)
      document.getElementById("adminSaveError").textContent = "";
      btn.textContent = "נשמר ✓";
      setTimeout(() => { btn.textContent = "שמור שינויים"; btn.disabled = false; }, 1500);
    } catch (e) {
      document.getElementById("adminSaveError").textContent = e.message;
      btn.textContent = "שמור שינויים";
      btn.disabled = false;
    }
  });

  document.getElementById("adminResetBtn").addEventListener("click", () => {
    if (!confirm("לאפס את הטופס לערכים שנטענו בתחילת הכניסה למסך? (לא משפיע על מה שכבר נשמר)")) return;
    wireAdminSection();
  });
}

function renderAdminFields() {
  const body = document.getElementById("adminRulesBody");
  body.innerHTML = `
    <div class="field-label">פרמטרים גלובליים</div>
    <div class="rate-field-grid">
      <label>עמלת מוכר משווי העסקה</label>
      <div class="rate-input-wrap"><input class="rate-input" data-path="global.sellerCommissionRate" type="number" step="0.1"/><span class="rate-pct-sign">%</span></div>
      <label>עמלת קונה משווי העסקה</label>
      <div class="rate-input-wrap"><input class="rate-input" data-path="global.buyerCommissionRate" type="number" step="0.1"/><span class="rate-pct-sign">%</span></div>
      <label>עמלת מפנה</label>
      <div class="rate-input-wrap"><input class="rate-input" data-path="global.referralRate" type="number" step="0.1"/><span class="rate-pct-sign">%</span></div>
    </div>

    <div class="field-label" style="margin-top:16px;">סוכן מורשה — הביא וטיפל</div>
    <div class="rate-field-grid">
      <label>חלק הסוכן</label>
      <div class="rate-input-wrap"><input class="rate-input" data-path="authorizedAgent.soloRate" type="number" step="0.1"/><span class="rate-pct-sign">%</span></div>
      <label>חלק BSD</label>
      <div class="rate-input-wrap"><input class="rate-input" data-path="authorizedAgent.bsdSoloRate" type="number" step="0.1"/><span class="rate-pct-sign">%</span></div>
    </div>
    <div class="track-check-line" id="check-aa-solo"></div>

    <div class="field-label" style="margin-top:16px;">סוכן מורשה — עם מפנה</div>
    <div class="rate-field-grid">
      <label>חלק הסוכן המטפל</label>
      <div class="rate-input-wrap"><input class="rate-input" data-path="authorizedAgent.withReferralAgentRate" type="number" step="0.1"/><span class="rate-pct-sign">%</span></div>
      <label>חלק BSD</label>
      <div class="rate-input-wrap"><input class="rate-input" data-path="authorizedAgent.withReferralBsdRate" type="number" step="0.1"/><span class="rate-pct-sign">%</span></div>
    </div>
    <div class="track-check-line" id="check-aa-referral"></div>

    <div class="field-label" style="margin-top:16px;">נציגות BSD</div>
    <div class="rate-field-grid">
      <label>סוכן מטפל — ללא מפנה</label>
      <div class="rate-input-wrap"><input class="rate-input" data-path="regional.agentRateNoReferral" type="number" step="0.1"/><span class="rate-pct-sign">%</span></div>
      <label>סוכן מטפל — עם מפנה</label>
      <div class="rate-input-wrap"><input class="rate-input" data-path="regional.agentRateWithReferral" type="number" step="0.1"/><span class="rate-pct-sign">%</span></div>
      <label>חלק הנציגות מהיתרה</label>
      <div class="rate-input-wrap"><input class="rate-input" data-path="regional.regionalShareOfRemainder" type="number" step="0.1"/><span class="rate-pct-sign">%</span></div>
      <label>חלק BSD מהיתרה</label>
      <div class="rate-input-wrap"><input class="rate-input" data-path="regional.bsdShareOfRemainder" type="number" step="0.1"/><span class="rate-pct-sign">%</span></div>
    </div>
    <div class="track-check-line" id="check-regional"></div>
    <label class="checkbox-row" style="margin-top:10px;">
      <input type="checkbox" data-bool-path="regional.developmentManager.enabled" id="regDmEnabled"/>
      יש מנהל פיתוח לנציגויות
    </label>
    <div class="rate-field-grid" style="margin-top:8px;">
      <label>אחוז מחלק BSD בפועל</label>
      <div class="rate-input-wrap"><input class="rate-input" data-path="regional.developmentManager.rate" type="number" step="0.1"/><span class="rate-pct-sign">%</span></div>
    </div>

    <div class="field-label" style="margin-top:16px;">זכיין BSD</div>
    <label class="checkbox-row">
      <input type="checkbox" data-bool-path="franchise.enabled" id="franchiseEnabled"/>
      הפעל את מסלול הזכיינות בסימולטור
    </label>
    <div class="rate-field-grid" style="margin-top:8px;">
      <label>סוכן מטפל — ללא מפנה</label>
      <div class="rate-input-wrap"><input class="rate-input" data-path="franchise.agentRateNoReferral" type="number" step="0.1"/><span class="rate-pct-sign">%</span></div>
      <label>סוכן מטפל — עם מפנה</label>
      <div class="rate-input-wrap"><input class="rate-input" data-path="franchise.agentRateWithReferral" type="number" step="0.1"/><span class="rate-pct-sign">%</span></div>
      <label>חלק הזכיינות מהיתרה</label>
      <div class="rate-input-wrap"><input class="rate-input" data-path="franchise.franchiseShareOfRemainder" type="number" step="0.1"/><span class="rate-pct-sign">%</span></div>
      <label>חלק BSD מהיתרה</label>
      <div class="rate-input-wrap"><input class="rate-input" data-path="franchise.bsdShareOfRemainder" type="number" step="0.1"/><span class="rate-pct-sign">%</span></div>
    </div>
    <div class="track-check-line" id="check-franchise"></div>
  `;

  body.querySelectorAll(".rate-input").forEach((input) => {
    const val = getByPath(workingRules, input.dataset.path);
    input.value = val == null ? "" : Math.round(val * 1000) / 10;
    input.addEventListener("input", () => {
      const num = parseFloat(input.value);
      setByPath(workingRules, input.dataset.path, isNaN(num) ? null : num / 100);
      validateAdminForm();
    });
  });
  body.querySelectorAll("[data-bool-path]").forEach((input) => {
    input.checked = !!getByPath(workingRules, input.dataset.boolPath);
    input.addEventListener("change", () => {
      setByPath(workingRules, input.dataset.boolPath, input.checked);
      validateAdminForm();
    });
  });

  validateAdminForm();
}

function getByPath(obj, path) {
  return path.split(".").reduce((acc, k) => (acc == null ? acc : acc[k]), obj);
}
function setByPath(obj, path, value) {
  const keys = path.split(".");
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) cur = cur[keys[i]];
  cur[keys[keys.length - 1]] = value;
}
function pctSum100(...vals) {
  if (vals.some((v) => v == null || isNaN(v))) return { ok: false, sum: null };
  const sum = vals.reduce((a, b) => a + b, 0);
  return { ok: Math.abs(sum - 1) < 0.0005, sum };
}
function setCheckLine(id, result) {
  const el = document.getElementById(id);
  if (!el) return;
  if (result.sum == null) { el.className = "track-check-line error"; el.textContent = "יש למלא את כל השדות"; return; }
  const pct = Math.round(result.sum * 1000) / 10;
  if (result.ok) { el.className = "track-check-line ok"; el.textContent = `✓ מסתכם ל-100% (${pct}%)`; }
  else { el.className = "track-check-line error"; el.textContent = `✗ מסתכם ל-${pct}% במקום 100%`; }
}

function validateAdminForm() {
  adminFormValid = true;

  const r1 = pctSum100(workingRules.authorizedAgent.soloRate, workingRules.authorizedAgent.bsdSoloRate);
  setCheckLine("check-aa-solo", r1);
  if (!r1.ok) adminFormValid = false;

  const r2 = pctSum100(workingRules.global.referralRate, workingRules.authorizedAgent.withReferralAgentRate, workingRules.authorizedAgent.withReferralBsdRate);
  setCheckLine("check-aa-referral", r2);
  if (!r2.ok) adminFormValid = false;

  const r3 = pctSum100(workingRules.regional.regionalShareOfRemainder, workingRules.regional.bsdShareOfRemainder);
  setCheckLine("check-regional", r3);
  if (!r3.ok) adminFormValid = false;

  if (workingRules.franchise.enabled) {
    const r4 = pctSum100(workingRules.franchise.franchiseShareOfRemainder, workingRules.franchise.bsdShareOfRemainder);
    setCheckLine("check-franchise", r4);
    if (!r4.ok) adminFormValid = false;
    if (workingRules.franchise.agentRateNoReferral == null || workingRules.franchise.agentRateWithReferral == null) adminFormValid = false;
  } else {
    const el = document.getElementById("check-franchise");
    if (el) { el.className = "track-check-line"; el.textContent = "מסלול הזכיינות כבוי — לא נבדק כעת"; }
  }

  document.querySelectorAll(".rate-input").forEach((input) => {
    const v = parseFloat(input.value);
    const invalid = input.value !== "" && (isNaN(v) || v < 0 || v > 100);
    input.classList.toggle("invalid", invalid);
    if (invalid) adminFormValid = false;
  });

  const saveBtn = document.getElementById("adminSaveBtn");
  if (saveBtn) saveBtn.disabled = !adminFormValid;
  const errEl = document.getElementById("adminSaveError");
  if (errEl) errEl.textContent = adminFormValid ? "" : "יש לתקן את השדות המסומנים באדום לפני השמירה";
}

// ---------------------------------------------------------------------
// אתחול אמיתי של הדף: קודם requireAuth (מזהה מי מחובר ומה תפקידו),
// ואז טעינת האחוזים מ-Supabase, ורק אז בניית הסימולטור עצמו.
// ---------------------------------------------------------------------
(async function main() {
  const profile = await requireAuth(); // מוגדר ב-js/auth.js המשותף לכל ה-CRM
  if (!profile) return; // requireAuth כבר הפנה ל-login.html במידת הצורך

  CURRENT_USER_PROFILE = profile;
  const headerEl = document.getElementById("headerUserInfo");
  if (headerEl) {
    headerEl.textContent = ((profile.full_name && profile.full_name.trim()) ? profile.full_name : profile.email) + " · " + new Date().toLocaleDateString("he-IL");
  }
  if (typeof refreshNavMsgBadge === "function") refreshNavMsgBadge();

  rules = await BSDCommissionRules.loadCommissionRules();

  renderUserTypeSelector();
  renderReferrerTrackCard();
  document.getElementById("dealValueWords").textContent = numberToHebrewWords(state.dealValue);
  renderAdminSectionIfAllowed();
})();
