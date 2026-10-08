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
  root.BSDSearch = { phoneKey, phoneQuery, phoneMatch };
})(typeof window === 'undefined' ? globalThis : window);
