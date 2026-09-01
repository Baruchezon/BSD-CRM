/**
 * BSD CRM — Commission Rules (Supabase-backed)
 * ================================================
 * גרסת ה-CRM של commissionRules.js: במקום localStorage (שהיה שומר
 * הגדרות רק בדפדפן המקומי), האחוזים נשמרים בטבלה משותפת אחת ב-Supabase
 * (public.commission_rules, שורה יחידה id=1) כך שכל הסוכנים רואים תמיד
 * את אותם אחוזים, מכל מכשיר.
 *
 * הרשאות אמיתיות (RLS בשרת, לא רק הסתרת כפתור):
 *   - קריאה: כל משתמש מחובר (כולל agent רגיל — צריך כדי להריץ סימולציה).
 *   - כתיבה: role='admin' בלבד (ר' migrations/2026-09-01_commission_
 *     simulator_rules.sql). ניסיון שמירה ממשתמש שאינו admin נחסם ע"י
 *     הפוסטגרס עצמו, גם אם מישהו יעקוף את הממשק ויקרא ל-API ישירות.
 *
 * זהו אותו מבנה נתונים בדיוק כמו בגרסה העצמאית (DEFAULT_COMMISSION_RULES) —
 * מנוע החישוב (commissionCalculationEngine.js) ומצייר-המפה
 * (commissionMapRenderer.js) לא שונו כלל, הם עובדים זהה משני המקורות.
 */

window.BSDCommissionRules = (function () {

  // אותה ברירת מחדל בדיוק כמו בגרסה העצמאית — משמשת רק כרשת ביטחון אם
  // מסיבה כלשהי הטבלה ריקה או שהקריאה נכשלת (למשל בעיית רשת חולפת).
  const FALLBACK_DEFAULTS = {
    version: "1.0.0",
    lastUpdated: "2026-09-01",
    global: { sellerCommissionRate: 0.05, buyerCommissionRate: 0.05, referralRate: 0.20 },
    authorizedAgent: { enabled: true, label: "סוכן מורשה", soloRate: 0.70, bsdSoloRate: 0.30, withReferralAgentRate: 0.50, withReferralBsdRate: 0.30 },
    office: { enabled: true, label: "משרד מייצג BSD", agentRateNoReferral: 0.50, agentRateWithReferral: 0.40, officeShareOfRemainder: 0.50, bsdShareOfRemainder: 0.50 },
    regional: { enabled: true, label: "נציגות BSD", ownerLabel: "בעל הנציגות", agentLabel: "מתווך תחת הנציגות", agentRateNoReferral: 0.50, agentRateWithReferral: 0.40, regionalShareOfRemainder: 0.70, bsdShareOfRemainder: 0.30, developmentManager: { enabled: false, rate: 0.10 } },
    franchise: { enabled: false, label: "זכיין BSD", ownerLabel: "בעל הזיכיון", agentLabel: "מתווך תחת הזכיין", agentRateNoReferral: null, agentRateWithReferral: null, franchiseShareOfRemainder: null, bsdShareOfRemainder: null, note: "ממתין לאחוזים מדויקים.", developmentManager: { enabled: false, rate: 0.10 } },
  };

  /** טוען את הגדרות העמלה הנוכחיות מהטבלה המשותפת */
  async function loadCommissionRules() {
    try {
      const { data, error } = await window.supabaseClient
        .from("commission_rules")
        .select("rules_json")
        .eq("id", 1)
        .single();
      if (error || !data) {
        console.warn("commission_rules: קריאה נכשלה, נטענת ברירת מחדל מקומית כרשת ביטחון", error);
        return structuredCloneCompat(FALLBACK_DEFAULTS);
      }
      return data.rules_json;
    } catch (e) {
      console.warn("commission_rules: שגיאת רשת, נטענת ברירת מחדל מקומית כרשת ביטחון", e);
      return structuredCloneCompat(FALLBACK_DEFAULTS);
    }
  }

  /**
   * שומר הגדרות עמלה חדשות. נקרא רק ממסך הניהול המוטמע, שכבר מוסתר
   * לחלוטין ממי שאינו admin — אך ה-RLS בשרת הוא קו ההגנה האמיתי: אם
   * משתמש שאינו admin יגיע לכאן בכל דרך שהיא, השמירה תיכשל בשרת.
   */
  async function saveCommissionRules(rules) {
    const { error } = await window.supabaseClient
      .from("commission_rules")
      .update({ rules_json: rules })
      .eq("id", 1);
    if (error) {
      throw new Error(
        error.code === "42501" || /permission|policy/i.test(error.message || "")
          ? "אין לך הרשאה לשמור שינויים באחוזים (רק אדמין רשאי)"
          : "שמירת האחוזים נכשלה: " + error.message
      );
    }
    return rules;
  }

  function structuredCloneCompat(obj) {
    return typeof structuredClone === "function" ? structuredClone(obj) : JSON.parse(JSON.stringify(obj));
  }

  return { loadCommissionRules, saveCommissionRules, FALLBACK_DEFAULTS };
})();
