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
  root.BSDSmartPick = { fieldsOf: fieldsOf, matches: matches, sortRows: sortRows };
})(typeof window === 'undefined' ? globalThis : window);
