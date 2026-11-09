// חיפוש חי לבחירת עסק או קונה במסך «התאמות AI חכמות».
// הנרמול (גרש, גרשיים, מרכאות, רווחים, אותיות סופיות, טלפון ומספר)
// זהה לחיפוש בשאר המערכת (js/bsd-search.js). תצוגה בלבד.
(function(root){
  function fieldsOf(row){
    row = row || {};
    return [row.name, row.number, row.id_number, row.detail].concat(row.phones || []);
  }
  function matches(rows, query){
    const q = String(query == null ? '' : query).trim();
    if (q.length < 1) return [];
    const S = root.BSDSearch;
    return (rows || []).filter(function(row){
      const fields = fieldsOf(row);
      if (!S) return fields.join(' ').toLowerCase().indexOf(q.toLowerCase()) >= 0;
      return S.textMatch(q, fields) || S.phoneMatch(q, fields);
    });
  }
  function sortRows(rows){
    return (rows || []).slice().sort(function(a, b){
      return String(a && a.name || '').trim().localeCompare(String(b && b.name || '').trim(), 'he');
    });
  }
  // 75+ , 61–74 , 50–60 , and everything under 50. Order is the filter order.
  const BUCKETS = [
    { id: 'high', label: '75% ומעלה' },
    { id: 'good', label: '61%–74%' },
    { id: 'mid', label: '50%–60%' },
    { id: 'low', label: 'מתחת ל-50%' }
  ];
  function scoreBucket(score){
    const n = Number(score);
    if (n >= 75) return 'high';
    if (n >= 61) return 'good';
    if (n >= 50) return 'mid';
    return 'low';
  }
  function defaultBucket(counts){
    counts = counts || {};
    for (let i = 0; i < BUCKETS.length; i++){
      if ((counts[BUCKETS[i].id] || 0) > 0) return BUCKETS[i].id;
    }
    return 'all';
  }
  root.BSDSmartPick = { fieldsOf: fieldsOf, matches: matches, sortRows: sortRows, BUCKETS: BUCKETS, scoreBucket: scoreBucket, defaultBucket: defaultBucket };
})(typeof window === 'undefined' ? globalThis : window);
