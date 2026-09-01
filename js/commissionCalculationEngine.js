/**
 * BSD Commission Simulator — Calculation Engine
 * ================================================
 * מנוע חישוב טהור, ללא תלות ב-UI. כל פונקציה מקבלת נתונים ומחזירה מבנה מסודר.
 * שום מספר קשיח לא מופיע כאן — הכל נשאב מ-rules (commissionRules.js).
 *
 * עיקרון ארכיטקטוני מרכזי (לפי דרישת ברוך איזון):
 * ---------------------------------------------------
 * מנוע החישוב מחשב את חלוקת העסקה פעם אחת בלבד, ללא שום ידיעה על "מי המשתמש".
 * זהות המשתמש (התפקיד שלו: סוכן מטפל / מפנה / בעל נציגות / בעל זיכיון) נכנסת
 * לתמונה רק בשלב שני, נפרד לגמרי — computeUserEarnings — שרק "מצביע" על החלק
 * הרלוונטי מתוך התוצאה שכבר חושבה. כך מובטח שהחלפת תפקיד הצפייה לעולם לא
 * משנה את סך חלוקת העסקה עצמה, רק את מה שמסומן כ"שייך לי".
 *
 * שלב 1 — עובדות העסקה בלבד (dealFacts), ללא זהות:
 *   track:       'authorizedAgent' | 'office' | 'regional' | 'franchise'
 *   arrivedVia:  'network' — צד זה טופל ע"י מישהו בתוך הרשת (סוכן כלשהו,
 *                             מי שיהיה — לא משנה לחישוב עצמו)
 *                'bsd'     — הצד הגיע ישירות מ-BSD, ללא סוכן טיפול כלל
 *   hasReferral: true/false — האם קיים גורם מפנה לצד זה (מי שיהיה)
 *
 * שלב 2 — זיהוי "מי אני" (attribution), על גבי תוצאת שלב 1 בלבד:
 *   role: 'agent' — הצופה הוא סוכן/מתווך בתוך הרשת. יש לציין:
 *           isUserTreatingAgent: bool — האם אני הגורם המטפל בצד זה
 *           isUserReferrer:      bool — האם אני הגורם המפנה בצד זה
 *   role: 'owner' — הצופה הוא בעל הנציגות/הזיכיון (רלוונטי רק לטראקים
 *           regional/franchise). מקבל את מלוא חלק הרשת מהצד, ללא תלות
 *           במי בפועל טיפל בו בשטח.
 */

(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    root.BSDEngine = factory();
  }
})(typeof window !== "undefined" ? window : globalThis, function () {

const EPSILON = 0.01; // סובלנות לשגיאות עיגול (אגורות)

/**
 * שלב 1: מחשב את חלוקת העמלה של צד בודד בעסקה (מוכר או קונה) — עובדתי בלבד,
 * ללא שום ידיעה על זהות המשתמש הצופה.
 */
function calculateSideCommission(dealValue, commissionRate, dealFacts, rules) {
  const grossCommission = round2(dealValue * commissionRate);
  const { track, arrivedVia, hasReferral } = dealFacts;

  let referralAmount = 0;
  let agentAmount = 0;
  let officeAmount = 0;
  let regionalAmount = 0;
  let franchiseAmount = 0;
  let bsdAmount = 0;
  let developmentManagerAmount = 0;

  // ---------- מקרה 1: הצד הגיע ישירות מ-BSD (אין סוכן, אין מפנה) ----------
  if (arrivedVia === "bsd") {
    bsdAmount = grossCommission;
  } else {
    // ---------- מקרה 2: הצד טופל ע"י מישהו בתוך הרשת, לפי מסלול ----------
    const trackRules = rules[track];
    if (!trackRules || trackRules.enabled === false) {
      throw new Error(`מסלול "${track}" אינו פעיל או אינו קיים בהגדרות`);
    }

    if (hasReferral) {
      referralAmount = round2(grossCommission * rules.global.referralRate);
    }

    if (track === "authorizedAgent") {
      // סוכן מורשה: אין "יתרה" מחושבת — כל האחוזים שטוחים מהעמלה הכוללת
      if (hasReferral) {
        agentAmount = round2(grossCommission * trackRules.withReferralAgentRate);
        bsdAmount = round2(grossCommission * trackRules.withReferralBsdRate);
      } else {
        agentAmount = round2(grossCommission * trackRules.soloRate);
        bsdAmount = round2(grossCommission * trackRules.bsdSoloRate);
      }
    } else if (track === "office" || track === "regional" || track === "franchise") {
      // משרד / נציגות / זכיין: קודם מפנה+סוכן, אח"כ היתרה מתחלקת ביחס קבוע
      const agentRate = hasReferral ? trackRules.agentRateWithReferral : trackRules.agentRateNoReferral;
      agentAmount = round2(grossCommission * agentRate);
      const remainder = round2(grossCommission - referralAmount - agentAmount);

      const shareKey = track === "office" ? "officeShareOfRemainder"
                      : track === "regional" ? "regionalShareOfRemainder"
                      : "franchiseShareOfRemainder";
      const bsdShareKey = "bsdShareOfRemainder";

      const entityShare = round2(remainder * trackRules[shareKey]);
      const bsdShare = round2(remainder * trackRules[bsdShareKey]);

      if (track === "office") officeAmount = entityShare;
      else if (track === "regional") regionalAmount = entityShare;
      else franchiseAmount = entityShare;

      bsdAmount = bsdShare;
    }

    // ---------- מנהל פיתוח: תת-חלוקה של חלק BSD בפועל (רק נציגות/זכיין) ----------
    // חשוב: זה אינו רכיב נוסף מעל העמלה — הוא נחתך מתוך bsdAmount שכבר
    // חושב, ומקטין אותו בהתאם. הסדר תואם לדרישה: קודם סוכן/מפנה/נציגות/
    // זכיין/BSD, ורק בסוף מנהל הפיתוח מתוך חלק BSD שנותר.
    if (track === "regional" || track === "franchise") {
      const dmConfig = trackRules.developmentManager;
      if (dmConfig && dmConfig.enabled) {
        developmentManagerAmount = round2(bsdAmount * dmConfig.rate);
        bsdAmount = round2(bsdAmount - developmentManagerAmount);
      }
    }
  }

  // ---------- תיקון עיגול אחרון: מבטיח שסכום החלוקה שווה בדיוק לעמלה ----------
  let distributionTotal = round2(referralAmount + agentAmount + officeAmount + regionalAmount + franchiseAmount + developmentManagerAmount + bsdAmount);
  const diff = round2(grossCommission - distributionTotal);
  if (Math.abs(diff) > 0 && Math.abs(diff) < 0.05) {
    bsdAmount = round2(bsdAmount + diff);
    distributionTotal = round2(referralAmount + agentAmount + officeAmount + regionalAmount + franchiseAmount + developmentManagerAmount + bsdAmount);
  }

  const distributionValid = Math.abs(grossCommission - distributionTotal) < EPSILON;

  return {
    track,
    arrivedVia,
    grossCommission,
    referralAmount,
    agentAmount,
    officeAmount,
    regionalAmount,
    franchiseAmount,
    developmentManagerAmount,
    bsdAmount,
    distributionTotal,
    distributionValid,
  };
}

/** חישוב צד המוכר (עובדתי, ללא זהות משתמש) */
function calculateSellerSide(dealValue, dealFacts, rules) {
  return calculateSideCommission(dealValue, rules.global.sellerCommissionRate, dealFacts, rules);
}

/** חישוב צד הקונה (עובדתי, ללא זהות משתמש) */
function calculateBuyerSide(dealValue, dealFacts, rules) {
  return calculateSideCommission(dealValue, rules.global.buyerCommissionRate, dealFacts, rules);
}

/**
 * שלב 1 המלא: מחשב עסקה שלמה — שני הצדדים + סיכום כולל + תוקף חלוקה.
 * אינו יודע דבר על זהות המשתמש הצופה. מנהל הפיתוח (אם מוגדר ומופעל במסלול)
 * כבר מחושב בתוך כל צד בנפרד (calculateSideCommission), כתת-חלוקה של BSD.
 */
function calculateDeal(dealInput, rules) {
  const { dealValue, sellerFacts, buyerFacts } = dealInput;

  const sellerSide = calculateSellerSide(dealValue, sellerFacts, rules);
  const buyerSide = calculateBuyerSide(dealValue, buyerFacts, rules);

  const totalCommission = round2(sellerSide.grossCommission + buyerSide.grossCommission);
  const totalAgent = round2(sellerSide.agentAmount + buyerSide.agentAmount);
  const totalOffice = round2(sellerSide.officeAmount + buyerSide.officeAmount);
  const totalRegional = round2(sellerSide.regionalAmount + buyerSide.regionalAmount);
  const totalFranchise = round2(sellerSide.franchiseAmount + buyerSide.franchiseAmount);
  const totalReferral = round2(sellerSide.referralAmount + buyerSide.referralAmount);
  const totalDevelopmentManager = round2(sellerSide.developmentManagerAmount + buyerSide.developmentManagerAmount);
  const totalBsd = round2(sellerSide.bsdAmount + buyerSide.bsdAmount);

  const dealSummary = {
    dealValue,
    sellerCommission: sellerSide.grossCommission,
    buyerCommission: buyerSide.grossCommission,
    totalCommission,
    agentShare: totalAgent,
    officeShare: totalOffice,
    regionalShare: totalRegional,
    franchiseShare: totalFranchise,
    referralShare: totalReferral,
    developmentManagerShare: totalDevelopmentManager,
    bsdShare: totalBsd,
  };

  const validation = validateDistribution(sellerSide, buyerSide);

  return {
    sellerSide,
    buyerSide,
    dealSummary,
    distributionValidation: validation,
  };
}

/**
 * בדיקת תקינות: סכום כל החלוקות (משני הצדדים) חייב להיות שווה בדיוק לסה"כ
 * העמלות שנגבו. אם לא — יש להציג שגיאת חישוב ולא תוצאה מטעה.
 */
function validateDistribution(sellerSide, buyerSide) {
  const totalGross = round2(sellerSide.grossCommission + buyerSide.grossCommission);
  const totalDistributed = round2(sellerSide.distributionTotal + buyerSide.distributionTotal);
  const isValid =
    sellerSide.distributionValid &&
    buyerSide.distributionValid &&
    Math.abs(totalGross - totalDistributed) < EPSILON;

  return {
    isValid,
    totalGross,
    totalDistributed,
    difference: round2(totalGross - totalDistributed),
    message: isValid ? "החישוב תקין" : "שגיאת חישוב — סכום החלוקה אינו תואם לעמלה שנגבתה",
  };
}

/**
 * שלב 2: מזהה איזה חלק מתוך תוצאת שלב 1 (שכבר חושבה במלואה) שייך למשתמש
 * הצופה הנוכחי, לפי תפקידו. אינה נוגעת כלל בחישוב החלוקה עצמו.
 *
 * attribution: {role:'agent', isUserTreatingAgent, isUserReferrer}
 *            | {role:'owner'}
 *            | {role:'developmentManager'}
 */
function computeSideUserAttribution(sideResult, attribution) {
  if (!attribution || attribution.role == null) {
    return { amount: 0, highlightRoles: [] };
  }

  if (attribution.role === "owner") {
    const entityKey = sideResult.track === "office" ? "officeAmount"
                      : sideResult.track === "regional" ? "regionalAmount"
                      : sideResult.track === "franchise" ? "franchiseAmount"
                      : null;
    const entityRole = sideResult.track === "office" ? "office"
                       : sideResult.track === "regional" ? "regional"
                       : sideResult.track === "franchise" ? "franchise"
                       : null;
    if (!entityKey) return { amount: 0, highlightRoles: [] };
    const amount = sideResult[entityKey] || 0;
    return { amount: round2(amount), highlightRoles: amount > 0 ? [entityRole] : [] };
  }

  if (attribution.role === "developmentManager") {
    const amount = sideResult.developmentManagerAmount || 0;
    return { amount: round2(amount), highlightRoles: amount > 0 ? ["dev"] : [] };
  }

  // role === 'agent'
  // כלל עסקי בל-יעבור: הגורם המטפל והגורם המפנה הם תמיד שני אנשים שונים.
  // אם משום מה שני הדגלים הגיעו כ-true יחד (קלט לא תקין), זו שגיאת קלט —
  // לא סופרים את אותו אדם פעמיים, ולא "בוחרים בשקט" איזה מהם עדיף.
  if (attribution.isUserTreatingAgent && attribution.isUserReferrer) {
    throw new Error("גורם מטפל אינו יכול להיות גם גורם מפנה באותו צד עסקה");
  }

  let amount = 0;
  const highlightRoles = [];
  if (attribution.isUserTreatingAgent) {
    amount += sideResult.agentAmount;
    highlightRoles.push("agent");
  }
  if (attribution.isUserReferrer) {
    amount += sideResult.referralAmount;
    highlightRoles.push("referral");
  }
  return { amount: round2(amount), highlightRoles };
}

/**
 * שלב 2 המלא: מחשב את סך העמלה של המשתמש הצופה על פני שני צדי העסקה,
 * בהתבסס על תוצאת calculateDeal שכבר חושבה (ואינה משתנה בעקבות קריאה זו).
 */
function computeUserEarnings(dealResult, sellerAttribution, buyerAttribution) {
  const sellerCalc = computeSideUserAttribution(dealResult.sellerSide, sellerAttribution);
  const buyerCalc = computeSideUserAttribution(dealResult.buyerSide, buyerAttribution);
  const total = round2(sellerCalc.amount + buyerCalc.amount);
  const totalCommission = dealResult.dealSummary.totalCommission;
  const effectivePct = totalCommission > 0 ? Math.round((total / totalCommission) * 10000) / 100 : 0;

  return {
    sellerAmount: sellerCalc.amount,
    buyerAmount: buyerCalc.amount,
    total,
    effectivePct,
    sellerHighlightRoles: sellerCalc.highlightRoles,
    buyerHighlightRoles: buyerCalc.highlightRoles,
  };
}

/** עיגול ל-2 ספרות עשרוניות (אגורות), נמנע משגיאות floating point */
function round2(num) {
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

return {
  calculateSideCommission,
  calculateSellerSide,
  calculateBuyerSide,
  calculateDeal,
  validateDistribution,
  computeUserEarnings,
};

});
