// 22.10.2026 (בקשת ברוך): «לקוחות בטיפול» ו«החזר ללידים».
// עמודה crm_stage בטבלאות businesses ו-leads:
//   NULL         = הרשימה הראשית (עסקים / קונים) - ברירת מחדל לכל הרשומות הקיימות
//   'lead'       = הוחזר ללידים (מוצג במסך הלידים, לא ברשימה הראשית)
//   'in_progress'= לקוחות בטיפול: כרטיס מלא כמו עסק/קונה, אבל לא ברשימה הראשית,
//                  לא באתר, לא בפיד, לא בהתאמות ולא בדוחות (ה-views הציבוריים מסננים crm_stage IS NULL)
// שינוי שלב לעולם לא מוחק נתונים - רק מעדכן את שלוש עמודות השלב.
(function(root){
  const LABELS = { lead: 'לידים', in_progress: 'לקוחות בטיפול' };
  const MAIN = { businesses: 'רשימת העסקים', leads: 'רשימת הקונים' };
  function label(stage, table){ return stage ? (LABELS[stage] || stage) : (MAIN[table] || 'הרשימה הראשית'); }
  async function set(table, id, stage, profileId){
    if (table !== 'businesses' && table !== 'leads') throw new Error('טבלה לא נתמכת');
    if (stage !== null && stage !== 'lead' && stage !== 'in_progress') throw new Error('שלב לא חוקי');
    const db = root.supabaseClient;
    const patch = { crm_stage: stage, crm_stage_changed_at: new Date().toISOString(), crm_stage_changed_by: profileId || null };
    const { data, error } = await db.from(table).update(patch).eq('id', id).select('id,crm_stage');
    if (error) throw new Error(error.message);
    if (!data || !data.length || (data[0].crm_stage || null) !== stage) throw new Error('השינוי לא נשמר (אין הרשאה לרשומה הזו)');
    if (root.BSDDataCache && profileId){
      ['businesses-page','leads-page','rows:businesses','rows:leads'].forEach(s => { try { root.BSDDataCache.remove(s, profileId); } catch(_){} });
    }
    return data[0];
  }
  async function move(table, id, stage, profileId, name){
    const kind = table === 'businesses' ? 'העסק' : 'הקונה';
    const msg = `להעביר את ${kind}${name ? ' «' + name + '»' : ''} אל «${label(stage, table)}»?\nשום נתון לא נמחק.` +
      (stage ? `\nבזמן שהוא שם הוא לא יופיע ב${MAIN[table]}, באתר, בפיד ובהתאמות.` : '');
    if (!root.confirm(msg)) return null;
    return set(table, id, stage, profileId);
  }
  const isMain = r => !r || !r.crm_stage;
  root.BSDCrmStage = { LABELS, label, set, move, isMain };
})(typeof window === 'undefined' ? globalThis : window);
