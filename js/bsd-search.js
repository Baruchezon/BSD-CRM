// 08.10.2026 (בקשת ברוך): חיפוש טלפון בכל הרשימות - בלי תלות במקפים, רווחים,
// סוגריים או קידומת +972 / 972 / 00972 במקום 0. "0525337339", "052-533 7339"
// ו-"+972 52-5337339" מוצאים את אותו כרטיס. תצוגה וסינון בלבד - לא משנה נתונים.
// בשימוש כ-OR נוסף לחיפוש הקיים, כך שחיפוש שעבד קודם ממשיך לעבוד בדיוק אותו דבר.
(function(root){
  const PREFIX = /^(?:00)?972/;
  // Stored phone -> plain local digits ("+972-52-533-7339" -> "0525337339").
  function phoneKey(v){
    let d = String(v == null ? '' : v).replace(/\D/g, '');
    if (PREFIX.test(d)){
      const rest = d.replace(PREFIX, '').replace(/^0/, '');
      if (rest.length >= 8) d = '0' + rest;
    }
    return d;
  }
  // Typed search -> digits to look for, or '' when the text is not a phone search
  // (letters, or fewer than 3 digits - so a short number never floods the list).
  function phoneQuery(q){
    const s = String(q == null ? '' : q).trim();
    if (!s || !/^[\d\s\-+().\/]+$/.test(s)) return '';
    let d = s.replace(/\D/g, '');
    if (d.length < 3) return '';
    if (PREFIX.test(d)){
      const rest = d.replace(PREFIX, '').replace(/^0/, '');
      if (rest.length >= 2) d = '0' + rest;
    }
    return d;
  }
  function phoneMatch(query, phones){
    const qd = phoneQuery(query);
    if (!qd) return false;
    return (phones || []).some(p => { const k = phoneKey(p); return !!k && k.includes(qd); });
  }
  // 18.10.2026 (בקשת ברוך, מרכז ההתאמות): נרמול טקסט עברי לחיפוש - ניקוד,
  // אותיות סופיות (ך/כ ם/מ ן/נ ף/פ ץ/צ), גרש/גרשיים/מרכאות, מקפים ורווחים כפולים,
  // אותיות גדולות/קטנות. "דקור", "דקור " ו-"ד'קור" מוצאים את אותו עסק.
  const FINALS = { 'ך':'כ', 'ם':'מ', 'ן':'נ', 'ף':'פ', 'ץ':'צ' };
  function normText(v){
    return String(v == null ? '' : v)
      .replace(/[\u0591-\u05C7]/g, '')
      .replace(/[ךםןףץ]/g, ch => FINALS[ch])
      .replace(/["'`\u05F3\u05F4\u2018\u2019\u201C\u201D]/g, '')
      .replace(/[\-_.,\/\\()|#:]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }
  // כל מילה בחיפוש צריכה להופיע איפשהו בשדות (בכל סדר). מספר עסק נמצא גם
  // בלי הקידומת BSD-B (למשל "1088" או "2610-1088").
  function textMatch(query, fields){
    const raw = String(query == null ? '' : query).trim();
    if (!raw) return true;
    const q = normText(query);
    // "---" / גרשיים בלבד מתנרמלים למחרוזת ריקה. בלי הבדיקה הזו כל העסקים
    // והקונים היו נחשבים לתוצאה, כי חיפוש ריק = "בלי סינון".
    if (!q) return false;
    const hay = normText((fields || []).filter(f => f != null && f !== '').join(' | '));
    const hayDigits = hay.replace(/\s+/g, '');
    return q.split(' ').every(tok => tok && (hay.includes(tok) || (/^\d+$/.test(tok) && hayDigits.includes(tok))));
  }
  root.BSDSearch = { phoneKey, phoneQuery, phoneMatch, normText, textMatch };
})(typeof window === 'undefined' ? globalThis : window);
