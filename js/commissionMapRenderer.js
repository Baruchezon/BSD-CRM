/**
 * BSD Commission Simulator — Map Renderer
 * ==========================================
 * אחראי אך ורק על הצגה גרפית. אינו מבצע שום חישוב עמלה ואינו מחליט בעצמו
 * "מי המשתמש" — הוא מקבל את הפלט המובנה ממנוע החישוב (calculationEngine.js),
 * כולל את רשימת ה-highlightRoles שכבר זוהתה שם (computeUserEarnings), ומצייר
 * אותה. זהו אותו רכיב בדיוק המשמש את כל מסלולי הרשת (סוכן מורשה / משרד /
 * נציגות / זכיין) — הוא קורא את ה-track מתוך side.track ומרנדר את הצ'יפים
 * המתאימים (סוכן/משרד/נציגות/זכיין/מפנה/BSD), ומדגיש ("אתה") לפי מה שנמסר לו.
 */

(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    root.BSDMap = factory();
  }
})(typeof window !== "undefined" ? window : globalThis, function () {

const ROLE_META = {
  bsd: { label: "BSD", cls: "role-bsd" },
  agent: { label: "סוכן מטפל", cls: "role-agent" },
  office: { label: "משרד", cls: "role-office" },
  regional: { label: "נציגות", cls: "role-regional" },
  franchise: { label: "זכיין", cls: "role-regional" },
  referral: { label: "מפנה", cls: "role-referral" },
  dev: { label: "מנהל פיתוח", cls: "role-dev" },
};

function fmtILS(num) {
  return "₪" + Math.round(num).toLocaleString("he-IL");
}

function fmtPct(part, whole) {
  if (!whole) return "0%";
  return Math.round((part / whole) * 100) + "%";
}

function arrowSVG() {
  return `<svg viewBox="0 0 20 26" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M10 2 V20 M10 20 L4 14 M10 20 L16 14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

/**
 * בונה צ'יפ חלוקה בודד (סוכן/משרד/נציגות/זכיין/מפנה/BSD)
 * @param {string} roleKey - מפתח מ-ROLE_META
 * @param {number} amount - סכום בש"ח
 * @param {number} whole - העמלה הגולמית של הצד (לחישוב אחוז)
 * @param {boolean} isUser - האם זהו החלק של המשתמש (מודגש) — נמסר מבחוץ, לא מחושב כאן
 * @param {string} [labelOverride] - תווית מותאמת (למשל "סוכן מטפל מהמשרד" לפי מסלול)
 */
function distChip(roleKey, amount, whole, isUser, labelOverride) {
  if (amount === 0 && roleKey !== "bsd") return ""; // לא מציגים רכיב אפס (חוץ מ-BSD שתמיד רלוונטי)
  const meta = ROLE_META[roleKey];
  const label = labelOverride || meta.label;
  return `
    <div class="dist-chip ${meta.cls} ${isUser ? "is-user" : ""}">
      <div class="chip-label">${label}${isUser ? " (אתה)" : ""}</div>
      <div class="chip-amount">${fmtILS(amount)}</div>
      <div class="chip-pct">${fmtPct(amount, whole)} מהעמלה</div>
    </div>`;
}

/**
 * תווית ברורה לסוכן המטפל, תלוית מסלול — כדי שהמפה תמיד תראה בבירור
 * "מי מבצע כל תפקיד" (למשל "סוכן מטפל מהמשרד" בעסקת נציגות).
 */
function agentLabelForTrack(track) {
  if (track === "regional") return "סוכן מטפל מהמשרד";
  if (track === "franchise") return "סוכן מטפל מהזכיינות";
  if (track === "office") return "סוכן מטפל מהמשרד";
  return "סוכן מטפל";
}

/**
 * בונה את שורת הצ'יפים של צד אחד, לפי תוצאת המנוע + רשימת ההדגשות שנמסרה.
 * אם רכיב מסוים הוא אפס (למשל אין מפנה), הוא פשוט לא מוצג — אין קופסה ריקה.
 * @param {object} sideResult - הפלט של calculateSideCommission
 * @param {string[]} highlightRoles - אילו roleKey-ים לסמן כ"אתה" (מ-computeUserEarnings)
 */
function buildChipsRow(sideResult, highlightRoles) {
  const { grossCommission, referralAmount, agentAmount, officeAmount, regionalAmount, franchiseAmount, developmentManagerAmount, bsdAmount, track, arrivedVia } = sideResult;
  const isHighlighted = (roleKey) => highlightRoles.includes(roleKey);

  if (arrivedVia === "bsd") {
    // הצד הגיע ישירות מ-BSD — הכל אצל BSD, אין מה להציג מעבר לזה
    return distChip("bsd", bsdAmount, grossCommission, isHighlighted("bsd"));
  }

  let chips = "";
  chips += distChip("referral", referralAmount, grossCommission, isHighlighted("referral"));
  chips += distChip("agent", agentAmount, grossCommission, isHighlighted("agent"), agentLabelForTrack(track));
  if (track === "office") chips += distChip("office", officeAmount, grossCommission, isHighlighted("office"));
  if (track === "regional") chips += distChip("regional", regionalAmount, grossCommission, isHighlighted("regional"));
  if (track === "franchise") chips += distChip("franchise", franchiseAmount, grossCommission, isHighlighted("franchise"));
  // מנהל פיתוח מוצג כתת-חלוקה של BSD — לכן מופיע מיד לפני צ'יפ ה-BSD (הנטו)
  chips += distChip("dev", developmentManagerAmount, grossCommission, isHighlighted("dev"));
  chips += distChip("bsd", bsdAmount, grossCommission, isHighlighted("bsd"));
  return chips;
}

/**
 * מרנדר את מפת המסלול המלאה (מוכר → עמלה → חלוקה → עסקה → חלוקה → עמלה → קונה)
 * לתוך אלמנט נתון. זהו רכיב חי — נקרא מחדש בכל שינוי קלט.
 *
 * @param {HTMLElement} container
 * @param {object} dealResult - הפלט של calculateDeal
 * @param {object} userEarnings - הפלט של computeUserEarnings (מכיל sellerHighlightRoles/buyerHighlightRoles)
 */
function renderFlowDiagram(container, dealResult, userEarnings) {
  const { sellerSide, buyerSide, dealSummary } = dealResult;
  const sellerHighlight = (userEarnings && userEarnings.sellerHighlightRoles) || [];
  const buyerHighlight = (userEarnings && userEarnings.buyerHighlightRoles) || [];

  container.innerHTML = `
    <div class="flow-diagram">
      <div class="flow-node side-node">
        <div class="node-label">צד מוכר</div>
        <div class="node-value">🏪 מוכר</div>
      </div>
      <div class="flow-arrow">${arrowSVG()}</div>
      <div class="flow-node commission-node">
        <div class="node-label">עמלת מוכר</div>
        <div class="node-value">${fmtILS(sellerSide.grossCommission)}</div>
      </div>
      <div class="distribution-row">${buildChipsRow(sellerSide, sellerHighlight)}</div>

      <div class="flow-arrow">${arrowSVG()}</div>
      <div class="flow-node deal-node">
        <div class="node-label">שווי העסקה</div>
        <div class="node-value">${fmtILS(dealSummary.dealValue)}</div>
      </div>
      <div class="flow-arrow" style="transform: rotate(180deg)">${arrowSVG()}</div>

      <div class="distribution-row">${buildChipsRow(buyerSide, buyerHighlight)}</div>
      <div class="flow-arrow" style="transform: rotate(180deg)">${arrowSVG()}</div>
      <div class="flow-node commission-node">
        <div class="node-label">עמלת קונה</div>
        <div class="node-value">${fmtILS(buyerSide.grossCommission)}</div>
      </div>
      <div class="flow-arrow" style="transform: rotate(180deg)">${arrowSVG()}</div>
      <div class="flow-node side-node">
        <div class="node-label">צד קונה</div>
        <div class="node-value">🤝 קונה</div>
      </div>
    </div>
  `;
}

return { renderFlowDiagram, fmtILS, fmtPct, ROLE_META };

});
