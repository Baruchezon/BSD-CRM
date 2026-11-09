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
  function fieldOf(row){
    const named = String(row && (row.field || row.category) || '').trim();
    if (named) return named;
    const detail = String(row && row.detail || '');
    const part = detail.split('·')[0].trim();
    return part || 'ללא תחום';
  }
  function statusOf(row){
    return String(row && row.status || '').trim();
  }
  function sortBusinesses(rows, sort){
    const list = (rows || []).slice();
    if (sort === 'new'){
      list.sort(function(a, b){
        const byDate = String(b && b.created_at || '').localeCompare(String(a && a.created_at || ''));
        return byDate || String(a && a.name || '').localeCompare(String(b && b.name || ''), 'he');
      });
    } else if (sort === 'matches'){
      list.sort(function(a, b){
        const byCount = (Number(b && b.match_count) || 0) - (Number(a && a.match_count) || 0);
        return byCount || String(a && a.name || '').localeCompare(String(b && b.name || ''), 'he');
      });
    } else {
      list.sort(function(a, b){
        return String(a && a.name || '').trim().localeCompare(String(b && b.name || '').trim(), 'he');
      });
    }
    return list;
  }
  // Empty query with no category/status filter stays closed. Filters narrow the search.
  function businessView(rows, opts){
    opts = opts || {};
    const q = String(opts.query || '').trim();
    const field = String(opts.field || '').trim();
    const status = String(opts.status || '').trim();
    let list;
    if (q) list = matches(rows, q);
    else if (field || status) list = (rows || []).slice();
    else return { rows: [], groups: [] };
    if (field) list = list.filter(function(r){ return fieldOf(r) === field; });
    if (status) list = list.filter(function(r){ return statusOf(r) === status; });
    list = sortBusinesses(list, opts.sort || 'name');
    if (!opts.group) return { rows: list, groups: [{ label: '', rows: list }] };
    const map = new Map();
    list.forEach(function(r){
      const label = fieldOf(r);
      if (!map.has(label)) map.set(label, []);
      map.get(label).push(r);
    });
    let groups = [];
    map.forEach(function(groupRows, label){ groups.push({ label: label, rows: groupRows }); });
    if (opts.sort === 'new') groups.sort(function(a, b){ return String(b.rows[0].created_at || '').localeCompare(String(a.rows[0].created_at || '')); });
    else if (opts.sort === 'matches') groups.sort(function(a, b){ return (Number(b.rows[0].match_count) || 0) - (Number(a.rows[0].match_count) || 0); });
    else groups.sort(function(a, b){ return a.label.localeCompare(b.label, 'he'); });
    const flat = [];
    groups.forEach(function(g){ g.rows.forEach(function(r){ flat.push(r); }); });
    return { rows: flat, groups: groups };
  }
  // picker -> results is one Back step. A new selection on the results screen replaces that step.
  function planSmartStep(currentView, nextView){
    if (currentView === 'results' && nextView === 'picker') return 'back';
    if (currentView !== 'results' && nextView === 'results') return 'push';
    return 'replace';
  }
  root.BSDSmartPick = {
    fieldsOf: fieldsOf, matches: matches, sortRows: sortRows,
    BUCKETS: BUCKETS, scoreBucket: scoreBucket, defaultBucket: defaultBucket,
    fieldOf: fieldOf, statusOf: statusOf, sortBusinesses: sortBusinesses, businessView: businessView,
    planSmartStep: planSmartStep
  };
})(typeof window === 'undefined' ? globalThis : window);
