// עוזר אישי — קריאה בלבד מול הטבלאות שה-CRM כבר מציג.
// השאילתות רצות עם הסשן של המשתמש, ולכן RLS הוא אותו שער כמו בשאר המסכים.
// אין כאן כתיבה למסד, ואין ניסוח עובדות שלא חזרו מהשאילתה.
(function (root) {
  const STOP = new Set([
    'של','את','על','עם','אל','מן','מה','מי','איפה','איך','למה','מתי','האם','כן','לא',
    'תמצא','מצא','חפש','תחפש','תפתח','פתח','לי','בבקשה','נא','אפשר','תוכל','תביא','הראה','תראה','תציג','הצג',
    'תגיד','ספר','תספר','רוצה','לדעת','פרטים','כרטיס','הכרטיס',
    'עסק','העסק','חברה','החברה','קונה','הקונה','מוכר','המוכר','מתווך','המתווך','ליד','הליד','לקוח','הלקוח','משקיע','המשקיע',
    'נכנס','יצא','נוצר','נמכר','למערכת','במערכת','מהמערכת','סטטוס','הסטטוס','התאמה','ההתאמה','התאמות','הערות','הערה','פגישה','פגישות','שיחה','שיחות','סיכום','סיכומים',
    'ארכיון','בארכיון','תאריך','כניסה','יציאה','הוצע','הוצעה','בין','לבין','עבור','אצל','רשימת','רשימה','כמה','יש','אין',
    'אותו','אותה','הזה','הזו','הזאת','הוא','היא','גם','רק','כל','זה','זו','או','אותי','שלי','שלו','שלה',
    'הראשון','השני','השלישי','מסך','לפי','שם','בשם','שנקרא','פעיל','פעילים','פתוח','פתוחות','סגור','סגורים',
    'אמר','אמרו','נאמר','דיבר','דיברו','איזה','איזו','אלו','אלה','תן','בדוק','תבדוק','חדש','חדשים','ו','ש',
    'קורה','נשמע','שלום','תודה','היי','בוקר','ערב'
  ]);
  const CLOSED_MATCH = ['העסקה נסגרה', 'העסקה נעצרה', 'נסגר ללא עסקה', 'עסקה הושלמה', 'הקונה לא מעוניין'];
  const BUSINESS_COLS = 'id,internal_name,anon_display_name,anonymous_name,business_number,owner_name,owner_phone,city,region,field,category,status,listing_status,removal_reason,sold_to,agreement_status,created_at,updated_at,is_archived,archived_at,archive_reason,crm_stage,notes,short_description,sale_reason';
  const LEAD_COLS = 'id,type,full_name,first_name,last_name,phone,phone2,email,city,company,business_name,status,handling_status,agreement_status,client_number,created_at,updated_at,is_archived,archived_at,archive_reason,crm_stage,notes,meeting_summary,requested_field,budget,lead_side';
  const BROKER_COLS = 'id,full_name,first_name,last_name,phone,email,city,status,agreement_status,looking_for,notes,short_note,created_at,updated_at,is_archived,archived_at,archive_reason';
  const MATCH_COLS = 'id,buyer_id,business_id,broker_id,counterparty_type,status,created_at,status_changed_at,meeting_date,meeting_summary,match_source,stopped_reason';
  const CLARIFY = 'אפשר לשאול על שם של עסק, קונה, מוכר או מתווך, על תאריך כניסה או יציאה, על סטטוס התאמה, על מה שנאמר בהערות ובפגישות, או על חתך כמו כמה רשומות בארכיון. התשובה נלקחת רק ממה ששמור במערכת ושגלוי לך.';

  function norm(s) {
    if (root.BSDSearch && root.BSDSearch.normText) return root.BSDSearch.normText(s);
    return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase();
  }
  function clip(s, n) {
    const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
    if (t.length <= n) return t;
    return t.slice(0, n) + '…';
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function isUuid(id) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id || ''));
  }
  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    try {
      return new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'numeric', year: 'numeric' }).format(d);
    } catch (_e) {
      return d.toISOString().slice(0, 10);
    }
  }
  const GENERIC = new Set(['עסק', 'עסקים', 'חברה', 'חברות', 'קונה', 'קונים', 'מוכר', 'מוכרים', 'מתווך', 'מתווכים', 'ליד', 'לידים', 'לקוח', 'לקוחות', 'משקיע', 'משקיעים', 'התאמה', 'התאמות', 'אדם', 'אנשים', 'רשומה', 'רשומות', 'כרטיס', 'כרטיסים', 'ארכיון', 'פגישה', 'פגישות', 'הערה', 'הערות', 'שיחה', 'שיחות']);
  let STOP_N = null;
  let GENERIC_N = null;
  function folded(source) {
    const out = new Set();
    source.forEach(word => out.add(norm(word)));
    return out;
  }
  function isStop(n) {
    if (!STOP_N) STOP_N = folded(STOP);
    return STOP_N.has(n);
  }
  function isGeneric(token) {
    if (!GENERIC_N) GENERIC_N = folded(GENERIC);
    return GENERIC_N.has(norm(token));
  }
  function needleToken(part) {
    const n = norm(part);
    if (!n || isStop(n)) return '';
    if (n.startsWith('ו') && isStop(n.slice(1))) return '';
    if (/^[בלמה]/.test(n) && n.length >= 4) {
      const cut = n.slice(1);
      if (isStop(cut)) return '';
      if (n.length >= 5 && cut.length >= 3) return String(part).slice(1);
    }
    return part;
  }
  function rawNeedle(text) {
    const quoted = [];
    const re = /[«"']([^»"']{2,80})[»"']/g;
    let m;
    while ((m = re.exec(String(text || '')))) quoted.push(m[1].trim());
    if (quoted.length) return quoted.join(' ').replace(/\s+/g, ' ').trim();
    const parts = String(text || '').replace(/[«»"'`?!.,:;()[\]{}]/g, ' ').split(/\s+/).filter(Boolean);
    const kept = parts.map(needleToken).map(token => token.trim()).filter(Boolean);
    if (!kept.length || kept.every(token => isGeneric(token))) return '';
    return kept.join(' ').replace(/\s+/g, ' ').trim();
  }
  function detectFocus(n) {
    const f = [];
    if (/הער|פגיש|שיח|אמר|נאמר|סיכום|תמלול|דיבר/.test(n)) f.push('speech');
    if (/התאמ|הוצע|הוצעה/.test(n)) f.push('match');
    if (/נכנס|נוצר|הגיע|נרשם|כניס/.test(n)) f.push('entered');
    if (/יצא|עזב|נמכר|הוסר|ארכי|יציא|לא פעיל/.test(n)) f.push('left');
    if (/סטטוס|מצב/.test(n)) f.push('status');
    if (/כמה/.test(n) || /מספר ה/.test(n)) f.push('count');
    if (/רשימ|כל העסק|כל הקונ|כל ההתאמ|כל המתווכ/.test(n)) f.push('list');
    if (!f.length) f.push('identity');
    return f;
  }
  function detectScope(n) {
    const broker = /מתווך|מתווכ/.test(n);
    const business = /עסק|חברה/.test(n);
    const seller = /מוכר/.test(n);
    const buyer = /קונה|משקיע/.test(n);
    const lead = /ליד|לקוח/.test(n);
    if (broker && !business && !buyer && !seller) return 'broker';
    if (business && !buyer && !seller && !broker && !lead) return 'business';
    if ((buyer || seller || lead) && !business && !broker) return 'person';
    if (/התאמ/.test(n) && !business && !buyer && !seller && !broker) return 'match';
    return 'all';
  }
  function leadTypeOf(n) {
    if (/מוכר/.test(n) && !/קונה/.test(n)) return 'seller';
    if (/קונה/.test(n) && !/מוכר/.test(n)) return 'buyer';
    if (/שותפ/.test(n)) return 'partner';
    return '';
  }
  function pickIndex(n) {
    if (/השלישי/.test(n)) return 2;
    if (/השני/.test(n)) return 1;
    if (/הראשון/.test(n)) return 0;
    return null;
  }

  function planQuestion(text, context) {
    const raw = String(text || '').replace(/\s+/g, ' ').trim();
    const n = norm(raw);
    const focus = detectFocus(n);
    const scope = detectScope(n);
    const needle = rawNeedle(raw);
    const cards = context && Array.isArray(context.cards) ? context.cards.filter(c => c && isUuid(c.id)) : [];
    const pick = pickIndex(n);
    const base = { text: raw, norm: n, focus, scope, leadType: leadTypeOf(n), needle, pick };
    if (!raw) return Object.assign({ kind: 'clarify' }, base);
    const sliceLike = focus.includes('count') || focus.includes('list');
    if (!needle && sliceLike) return Object.assign({ kind: 'slice' }, base);
    if (!needle && cards.length && (pick !== null || focus.some(item => item !== 'identity'))) {
      return Object.assign({ kind: 'followup', cards }, base);
    }
    if (!needle) return Object.assign({ kind: 'clarify' }, base);
    return Object.assign({ kind: 'lookup' }, base);
  }

  function cardHref(kind, id) {
    if (!isUuid(id)) return '';
    const enc = encodeURIComponent(id);
    if (kind === 'business') return 'businesses.html?open=' + enc;
    if (kind === 'broker') return 'brokers.html?open=' + enc;
    if (kind === 'match') return 'match-detail.html?id=' + enc;
    if (kind === 'screen') return '';
    return 'leads.html?open=' + enc;
  }
  function listingLabel(v) {
    if (v === 'sold') return 'נמכר';
    if (v === 'removed') return 'עסקה לא פעילה';
    if (!v || v === 'active') return 'פעיל למכירה';
    return String(v);
  }
  function leadKindLabel(type) {
    if (type === 'seller') return 'מוכר';
    if (type === 'partner') return 'שותפות/השקעה';
    if (type === 'buyer') return 'קונה';
    return 'ליד';
  }
  function stageLabel(stage) {
    if (!stage) return '';
    if (stage === 'lead') return 'לידים';
    if (stage === 'in_progress') return 'לקוחות בטיפול';
    return String(stage);
  }
  function personName(row) {
    return String(row.full_name || [row.first_name, row.last_name].filter(Boolean).join(' ') || row.business_name || row.company || '').trim();
  }
  function businessTitle(row) {
    return row.internal_name || row.anon_display_name || row.anonymous_name || row.owner_name || 'עסק ללא שם';
  }

  function ilikeClause(col, term) {
    const clean = String(term || '').replace(/[%_"\\]/g, '').trim();
    if (clean.length < 2) return '';
    if (/[\s,().]/.test(clean)) return col + '.ilike."%' + clean + '%"';
    return col + '.ilike.%' + clean + '%';
  }
  function orIlike(columns, needle) {
    const phrase = String(needle || '').replace(/[%_"\\]/g, ' ').replace(/\s+/g, ' ').trim();
    const tokens = [];
    phrase.split(' ').forEach(part => {
      const bit = part.trim();
      if (bit.length >= 2 && !tokens.includes(bit)) tokens.push(bit);
    });
    if (phrase.length >= 2 && !tokens.includes(phrase)) tokens.unshift(phrase);
    const parts = [];
    columns.forEach(col => {
      tokens.slice(0, 4).forEach(term => {
        const clause = ilikeClause(col, term);
        if (clause) parts.push(clause);
      });
    });
    return parts.join(',');
  }
  function phoneClauses(columns, needle) {
    const S = root.BSDSearch;
    if (!S || !S.phoneQuery) return [];
    const digits = S.phoneQuery(needle);
    if (!digits || digits.length < 7) return [];
    const tail = digits.slice(-7);
    const pattern = '%' + tail.slice(0, 3) + '%' + tail.slice(3) + '%';
    return columns.filter(col => /phone/i.test(col)).map(col => col + '.ilike.' + pattern);
  }

  function scoreHit(needle, primary, fields) {
    const S = root.BSDSearch;
    const list = (fields || []).filter(v => v != null && v !== '');
    if (S && S.phoneMatch && S.phoneMatch(needle, list)) return 96;
    const q = norm(needle);
    const prim = norm(primary);
    if (!q) return 0;
    if (prim && prim === q) return 100;
    if (prim && prim.includes(q)) return 88;
    if (S && S.textMatch && S.textMatch(needle, [primary])) return 80;
    if (S && S.textMatch && S.textMatch(needle, list)) return 70;
    return 0;
  }

  async function safeSelect(db, table, columns, build) {
    try {
      let q = db.from(table).select(columns);
      if (build) q = build(q) || q;
      const res = await q;
      if (res && res.error) return { rows: [], error: res.error.message || 'שגיאת קריאה' };
      return { rows: (res && res.data) || [], error: null };
    } catch (e) {
      return { rows: [], error: (e && e.message) || 'שגיאת קריאה' };
    }
  }
  async function exactCount(db, table, build) {
    try {
      let q = db.from(table).select('id', { count: 'exact', head: true });
      if (build) q = build(q) || q;
      const res = await q;
      if (res && res.error) return { count: null, error: res.error.message || 'שגיאת קריאה' };
      return { count: res && typeof res.count === 'number' ? res.count : 0, error: null };
    } catch (e) {
      return { count: null, error: (e && e.message) || 'שגיאת קריאה' };
    }
  }

  const SEARCH = {
    businesses: { columns: BUSINESS_COLS, or: ['internal_name', 'anon_display_name', 'anonymous_name', 'owner_name', 'business_number', 'city', 'field'] },
    leads: { columns: LEAD_COLS, or: ['full_name', 'first_name', 'last_name', 'business_name', 'company', 'client_number', 'phone', 'city'] },
    brokers: { columns: BROKER_COLS, or: ['full_name', 'first_name', 'last_name', 'phone', 'city', 'looking_for'] }
  };

  function hitFrom(kind, row, needle) {
    let title = '';
    let fields = [];
    let kindLabel = '';
    if (kind === 'business') {
      title = businessTitle(row);
      kindLabel = 'עסק';
      fields = [row.internal_name, row.anon_display_name, row.anonymous_name, row.owner_name, row.business_number, row.city, row.field, row.owner_phone];
    } else if (kind === 'broker') {
      title = personName(row) || 'מתווך ללא שם';
      kindLabel = 'מתווך';
      fields = [title, row.full_name, row.first_name, row.last_name, row.phone, row.city, row.looking_for];
    } else {
      title = personName(row) || 'ללא שם';
      kindLabel = leadKindLabel(row.type);
      fields = [title, row.full_name, row.first_name, row.last_name, row.business_name, row.company, row.client_number, row.phone, row.phone2, row.city];
    }
    const score = scoreHit(needle, title, fields);
    const subtitle = [kind === 'business' ? row.business_number : row.client_number, row.city, kind === 'business' ? row.field : (kind === 'lead' ? kindLabel : row.agreement_status)].filter(Boolean).join(' · ');
    return { kind, kindLabel, id: row.id, title, subtitle, score, row, href: cardHref(kind, row.id), openLabel: 'פתח כרטיס' };
  }

  async function searchTable(db, table, needle, leadType) {
    const spec = SEARCH[table];
    const filter = [orIlike(spec.or, needle)].concat(phoneClauses(spec.or, needle)).filter(Boolean).join(',');
    if (!filter) return { hits: [], error: null };
    const kind = table === 'businesses' ? 'business' : (table === 'brokers' ? 'broker' : 'lead');
    const res = await safeSelect(db, table, spec.columns, q => {
      let next = q.or(filter);
      if (leadType && table === 'leads') next = next.eq('type', leadType);
      return next.order('updated_at', { ascending: false }).limit(40);
    });
    const hits = res.rows.map(row => hitFrom(kind, row, needle)).filter(hit => hit.score >= 70 && isUuid(hit.id));
    hits.sort((a, b) => b.score - a.score || String(a.title).localeCompare(String(b.title), 'he'));
    return { hits: hits.slice(0, 8), error: res.error };
  }

  function tablesFor(scope, leadType) {
    if (scope === 'business') return ['businesses'];
    if (scope === 'broker') return ['brokers'];
    if (scope === 'person') return leadType ? ['leads'] : ['leads', 'brokers'];
    return ['businesses', 'leads', 'brokers'];
  }

  async function searchEntities(db, plan) {
    const first = tablesFor(plan.scope, plan.leadType);
    const errors = [];
    let hits = [];
    for (const table of first) {
      const res = await searchTable(db, table, plan.needle, plan.leadType);
      if (res.error) errors.push(res.error);
      hits = hits.concat(res.hits);
    }
    let widened = false;
    if (!hits.length && plan.scope !== 'all') {
      widened = true;
      for (const table of ['businesses', 'leads', 'brokers']) {
        if (first.includes(table)) continue;
        const res = await searchTable(db, table, plan.needle, '');
        if (res.error) errors.push(res.error);
        hits = hits.concat(res.hits);
      }
    }
    const seen = new Set();
    hits = hits.filter(hit => {
      const key = hit.kind + ':' + hit.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    hits.sort((a, b) => b.score - a.score || String(a.title).localeCompare(String(b.title), 'he'));
    return { hits: hits.slice(0, 6), errors, widened };
  }

  async function loadExtras(db, hits, focus) {
    const extras = {};
    hits.forEach(hit => { extras[hit.kind + ':' + hit.id] = { matches: [], notes: [], meetings: [], calls: [], warning: '' }; });
    const ids = kind => hits.filter(hit => hit.kind === kind && !hit.matchOnly).map(hit => hit.id);
    const matchRows = [];
    const attachCol = { business: 'business_id', lead: 'buyer_id', broker: 'broker_id' };
    for (const kind of ['business', 'lead', 'broker']) {
      const list = ids(kind);
      if (!list.length) continue;
      const res = await safeSelect(db, 'matches', MATCH_COLS, q => q.in(attachCol[kind], list).order('created_at', { ascending: false }).limit(24));
      if (res.error) list.forEach(id => { extras[kind + ':' + id].warning = 'לא הצלחתי לקרוא התאמות עבור הרשומה הזו.'; });
      res.rows.forEach(row => matchRows.push(row));
    }
    const bizIds = unique(matchRows.map(row => row.business_id).concat(ids('business')));
    const leadIds = unique(matchRows.map(row => row.buyer_id).concat(ids('lead')));
    const brokerIds = unique(matchRows.map(row => row.broker_id).concat(ids('broker')));
    const [bizRes, leadRes, brokerRes] = await Promise.all([
      bizIds.length ? safeSelect(db, 'businesses', 'id,internal_name,business_number', q => q.in('id', bizIds).limit(40)) : { rows: [] },
      leadIds.length ? safeSelect(db, 'leads', 'id,full_name,first_name,last_name,business_name', q => q.in('id', leadIds).limit(40)) : { rows: [] },
      brokerIds.length ? safeSelect(db, 'brokers', 'id,full_name,first_name,last_name', q => q.in('id', brokerIds).limit(40)) : { rows: [] }
    ]);
    const bizName = mapById(bizRes.rows, row => row.internal_name || row.business_number || 'עסק');
    const leadName = mapById(leadRes.rows, row => personName(row) || 'קונה');
    const brokerName = mapById(brokerRes.rows, row => personName(row) || 'מתווך');
    let history = [];
    if (focus.includes('match') && matchRows.length) {
      const res = await safeSelect(db, 'match_status_history', 'match_id,status,changed_at,note', q => q.in('match_id', matchRows.map(row => row.id)).order('changed_at', { ascending: true }).limit(40));
      history = res.rows;
    }
    const seenMatch = new Set();
    matchRows.forEach(row => {
      if (!row || seenMatch.has(row.id)) return;
      seenMatch.add(row.id);
      const other = row.counterparty_type === 'broker'
        ? (brokerName[row.broker_id] || 'מתווך')
        : (leadName[row.buyer_id] || 'קונה');
      const business = bizName[row.business_id] || 'עסק';
      const item = {
        id: row.id,
        status: row.status || '',
        created_at: row.created_at,
        source: row.match_source || '',
        stopped: row.stopped_reason || '',
        meeting_summary: row.meeting_summary || '',
        otherName: other,
        businessName: business,
        history: history.filter(entry => entry.match_id === row.id)
      };
      hits.forEach(hit => {
        const linked = (hit.kind === 'business' && row.business_id === hit.id)
          || (hit.kind === 'lead' && row.buyer_id === hit.id)
          || (hit.kind === 'broker' && row.broker_id === hit.id);
        if (linked) extras[hit.kind + ':' + hit.id].matches.push(item);
      });
    });
    if (focus.includes('speech')) {
      await loadSpeech(db, hits, extras);
    }
    return extras;
  }

  async function loadSpeech(db, hits, extras) {
    const tableOf = { business: 'businesses', lead: 'leads', broker: 'brokers' };
    for (const kind of ['business', 'lead', 'broker']) {
      const list = hits.filter(hit => hit.kind === kind).map(hit => hit.id);
      if (!list.length) continue;
      const notes = await safeSelect(db, 'record_notes', 'id,record_id,note_text,created_at,author_id', q => q.eq('table_name', tableOf[kind]).in('record_id', list).order('created_at', { ascending: false }).limit(12));
      const authors = unique(notes.rows.map(row => row.author_id));
      let names = {};
      if (authors.length) {
        const prof = await safeSelect(db, 'profiles', 'id,full_name', q => q.in('id', authors).limit(20));
        names = mapById(prof.rows, row => row.full_name || '');
      }
      notes.rows.forEach(row => {
        const bag = extras[kind + ':' + row.record_id];
        if (bag) bag.notes.push({ text: row.note_text, created_at: row.created_at, author: names[row.author_id] || '' });
      });
    }
    const biz = hits.filter(hit => hit.kind === 'business').map(hit => hit.id);
    const leads = hits.filter(hit => hit.kind === 'lead').map(hit => hit.id);
    const meetingOr = []
      .concat(biz.map(id => 'business_id.eq.' + id))
      .concat(leads.map(id => 'buyer_id.eq.' + id))
      .join(',');
    if (meetingOr) {
      const meetings = await safeSelect(db, 'match_meetings', 'id,business_id,buyer_id,meeting_type,meeting_date,summary_text,decisions,notes,title', q => q.or(meetingOr).is('deleted_at', null).order('meeting_date', { ascending: false }).limit(12));
      meetings.rows.forEach(row => {
        hits.forEach(hit => {
          if ((hit.kind === 'business' && row.business_id === hit.id) || (hit.kind === 'lead' && row.buyer_id === hit.id)) {
            extras[hit.kind + ':' + hit.id].meetings.push(row);
          }
        });
      });
    }
    if (leads.length) {
      const calls = await safeSelect(db, 'phone_calls', 'id,lead_id,started_at,direction,ai_gist,transcript', q => q.in('lead_id', leads).eq('is_test', false).order('started_at', { ascending: false }).limit(8));
      if (calls.error) {
        leads.forEach(id => { if (extras['lead:' + id]) extras['lead:' + id].warning = 'שיחות הטלפון לא זמינות בהרשאה הזו.'; });
      }
      calls.rows.forEach(row => {
        const bag = extras['lead:' + row.lead_id];
        if (bag) bag.calls.push(row);
      });
    }
  }

  function unique(list) {
    return [...new Set((list || []).filter(isUuid))];
  }
  function mapById(rows, label) {
    const out = {};
    (rows || []).forEach(row => { if (row && row.id) out[row.id] = label(row); });
    return out;
  }

  function archiveLine(row) {
    if (row.is_archived) {
      return 'בארכיון מתאריך ' + (fmtDate(row.archived_at) || 'שלא נשמר') + (row.archive_reason ? '. סיבה: ' + clip(row.archive_reason, 140) : '.');
    }
    return 'לא מסומן בארכיון.';
  }

  function factLines(hit, extra, focus) {
    const row = hit.row || {};
    const lines = [];
    const broad = focus.includes('identity') || focus.includes('status') || focus.includes('entered') || focus.includes('left');
    if (broad || focus.includes('entered')) lines.push('נכנס למערכת: ' + (fmtDate(row.created_at) || 'אין תאריך שמור'));
    if (broad || focus.includes('left')) lines.push(archiveLine(row));
    if (hit.kind === 'business' && (broad || focus.includes('left') || focus.includes('status'))) {
      lines.push('סטטוס מכירה: ' + listingLabel(row.listing_status));
      if (row.listing_status === 'sold' && row.sold_to) lines.push('נמכר אל: ' + clip(row.sold_to, 80));
      if (row.listing_status === 'removed' && row.removal_reason) lines.push('סיבת יציאה מהמכירה: ' + clip(row.removal_reason, 140));
    }
    if (hit.kind === 'lead' && (broad || focus.includes('status'))) {
      if (row.status) lines.push('סטטוס: ' + row.status);
      if (row.handling_status) lines.push('סטטוס טיפול: ' + row.handling_status);
      if (row.agreement_status) lines.push('הסכם: ' + row.agreement_status);
    }
    if (hit.kind === 'broker' && (broad || focus.includes('status'))) {
      if (row.status) lines.push('סטטוס: ' + row.status);
      if (row.agreement_status) lines.push('הסכם: ' + row.agreement_status);
    }
    const stage = stageLabel(row.crm_stage);
    if (stage) lines.push('שלב במערכת: ' + stage);
    const matches = (extra && extra.matches) || [];
    if (focus.includes('match')) {
      if (!matches.length) lines.push((extra && extra.warning) || 'אין התאמה שמורה לרשומה הזו.');
      matches.slice(0, 5).forEach(item => {
        const when = fmtDate(item.created_at) || 'תאריך לא שמור';
        lines.push('התאמה מול ' + (hit.kind === 'business' ? item.otherName : item.businessName) + ' נפתחה ב-' + when + '. סטטוס: ' + (item.status || 'ללא סטטוס') + (item.source ? '. מקור: ' + clip(item.source, 60) : ''));
        if (item.history && item.history.length) {
          lines.push('היסטוריית סטטוס: ' + item.history.map(entry => (fmtDate(entry.changed_at) || '—') + ' ' + (entry.status || '')).join(' · '));
        }
        if (item.stopped) lines.push('סיבת עצירה: ' + clip(item.stopped, 140));
      });
    } else if (broad) {
      if (extra && extra.warning && !matches.length) lines.push(extra.warning);
      else lines.push(matches.length ? ('התאמות שמורות: ' + matches.length) : 'אין התאמות שמורות.');
    }
    if (focus.includes('speech')) lines.push.apply(lines, speechLines(hit, extra));
    return lines;
  }

  function speechLines(hit, extra) {
    const lines = [];
    const row = hit.row || {};
    if (row.notes) lines.push('הערה בכרטיס: ' + clip(row.notes, 180));
    if (row.meeting_summary) lines.push('סיכום בכרטיס: ' + clip(row.meeting_summary, 180));
    if (row.short_note) lines.push('הערה קצרה: ' + clip(row.short_note, 180));
    ((extra && extra.notes) || []).slice(0, 4).forEach(note => {
      if (!note.text) return;
      lines.push((note.author ? note.author + ' · ' : 'הערה · ') + (fmtDate(note.created_at) || 'ללא תאריך') + ': ' + clip(note.text, 180));
    });
    ((extra && extra.meetings) || []).slice(0, 4).forEach(meeting => {
      const body = clip(meeting.summary_text || meeting.notes || meeting.decisions || '', 180);
      lines.push((fmtDate(meeting.meeting_date) || 'ללא תאריך') + ' · ' + (meeting.meeting_type || meeting.title || 'פגישה') + ': ' + (body || 'אין סיכום שמור'));
    });
    ((extra && extra.calls) || []).slice(0, 4).forEach(call => {
      const dir = call.direction === 'inbound' || call.direction === 'in' ? 'שיחה נכנסת' : (call.direction === 'outbound' || call.direction === 'out' ? 'שיחה יוצאת' : 'שיחה');
      const body = clip(call.ai_gist || call.transcript || '', 180);
      lines.push(dir + ' · ' + (fmtDate(call.started_at) || 'ללא תאריך') + ': ' + (body || 'אין תקציר שמור'));
    });
    ((extra && extra.matches) || []).slice(0, 3).forEach(item => {
      if (item.meeting_summary) lines.push('סיכום מתוך ההתאמה: ' + clip(item.meeting_summary, 180));
    });
    if (extra && extra.warning) lines.push(extra.warning);
    if (!lines.length) lines.push('אין הערות, סיכומי פגישות או תקצירי שיחות שמורים לרשומה הזו.');
    return lines;
  }

  function proseFor(plan, hits, extras, widened) {
    if (!hits.length) {
      return 'לא מצאתי במערכת רשומה תואמת ל«' + plan.needle + '». נסה שם מלא יותר, מספר עסק או מספר לקוח.';
    }
    const lead = [];
    if (hits.length === 1) lead.push('נמצאה רשומה אחת עבור «' + plan.needle + '»: ' + hits[0].kindLabel + ' ' + hits[0].title + '.');
    else lead.push('נמצאו ' + hits.length + ' רשומות עבור «' + plan.needle + '».');
    if (widened) lead.push('החיפוש הורחב מעבר לסוג שצוין, כי בשם הזה לא נמצאה רשומה מהסוג המבוקש.');
    if (hits[0].score < 88) lead.push('כדאי לוודא בכרטיס שזו הרשומה הנכונה.');
    if (hits.length === 1) {
      const lines = factLines(hits[0], extras[hits[0].kind + ':' + hits[0].id], plan.focus);
      const key = lines.filter(line => /נכנס למערכת|בארכיון|לא מסומן|סטטוס מכירה|התאמה מול|הערה|פגישה|שיחה|סיכום/.test(line)).slice(0, 4);
      key.forEach(line => lead.push(line));
    }
    return lead.join(' ');
  }

  function cardsFor(hits, extras, focus) {
    const cards = [];
    hits.forEach(hit => {
      const extra = extras[hit.kind + ':' + hit.id] || { matches: [] };
      cards.push({
        kind: hit.kind,
        kindLabel: hit.kindLabel,
        id: hit.id,
        title: hit.title,
        subtitle: hit.subtitle,
        href: hit.href,
        openLabel: 'פתח כרטיס',
        lines: factLines(hit, extra, focus)
      });
      if (focus.includes('match')) {
        extra.matches.slice(0, 4).forEach(item => {
          if (!isUuid(item.id)) return;
          cards.push({
            kind: 'match',
            kindLabel: 'התאמה',
            id: item.id,
            title: (hit.kind === 'business' ? hit.title : item.businessName) + ' · ' + (hit.kind === 'business' ? item.otherName : hit.title),
            subtitle: (item.status || 'ללא סטטוס') + ' · ' + (fmtDate(item.created_at) || ''),
            href: cardHref('match', item.id),
            openLabel: 'פתח כרטיס',
            lines: ['נפתחה: ' + (fmtDate(item.created_at) || 'אין תאריך שמור'), 'סטטוס נוכחי: ' + (item.status || 'ללא סטטוס')]
          });
        });
      }
    });
    return cards;
  }

  function sliceTarget(plan) {
    const n = plan.norm;
    const archive = /ארכי/.test(n);
    const sold = /נמכר/.test(n);
    if (plan.scope === 'match' || /התאמ/.test(n)) {
      let mode = 'all';
      if (/פתוח|פעיל/.test(n)) mode = 'open';
      if (/נסגר|הושלמ|סגור/.test(n)) mode = 'closed';
      return { table: 'matches', mode };
    }
    if (plan.scope === 'broker' || /מתווך/.test(n)) return { table: 'brokers', archive };
    if (plan.scope === 'person' || /קונ|מוכר|ליד|לקוח|משקיע/.test(n)) return { table: 'leads', archive, leadType: plan.leadType };
    if (plan.scope === 'business' || /עסק|חברה/.test(n)) return { table: 'businesses', archive, sold };
    return { table: '' };
  }

  function applySlice(q, target) {
    if (target.table === 'matches') {
      if (target.mode === 'open') return q.not('status', 'in', '(' + CLOSED_MATCH.map(status => '"' + status + '"').join(',') + ')');
      if (target.mode === 'closed') return q.in('status', CLOSED_MATCH);
      return q;
    }
    let next = q;
    if (target.leadType) next = next.eq('type', target.leadType);
    if (target.sold) return next.eq('listing_status', 'sold');
    if (target.archive) return next.eq('is_archived', true);
    return next.or('is_archived.is.null,is_archived.eq.false');
  }

  function sliceCopy(target) {
    if (target.table === 'matches' && target.mode === 'open') return { noun: 'התאמות פתוחות', screen: 'matches-workspace.html', screenLabel: 'מרכז ההתאמות' };
    if (target.table === 'matches' && target.mode === 'closed') return { noun: 'התאמות בסטטוס סגירה', screen: 'matches-workspace.html', screenLabel: 'מרכז ההתאמות' };
    if (target.table === 'matches') return { noun: 'התאמות', screen: 'matches-workspace.html', screenLabel: 'מרכז ההתאמות' };
    if (target.table === 'brokers' && target.archive) return { noun: 'מתווכים בארכיון', screen: 'brokers.html', screenLabel: 'מסך מתווכים' };
    if (target.table === 'brokers') return { noun: 'מתווכים', screen: 'brokers.html', screenLabel: 'מסך מתווכים' };
    if (target.table === 'leads' && target.archive) return { noun: 'אנשי קשר בארכיון', screen: 'leads.html?view=archive', screenLabel: 'ארכיון קונים ומוכרים' };
    if (target.table === 'leads') return { noun: (target.leadType === 'seller' ? 'מוכרים' : target.leadType === 'buyer' ? 'קונים' : 'אנשי קשר'), screen: 'leads.html', screenLabel: 'קונים ומשקיעים' };
    if (target.sold) return { noun: 'עסקים בסטטוס נמכר', screen: 'businesses.html', screenLabel: 'עסקים למכירה' };
    if (target.archive) return { noun: 'עסקים בארכיון', screen: 'businesses.html', screenLabel: 'עסקים למכירה' };
    return { noun: 'עסקים שאינם בארכיון', screen: 'businesses.html', screenLabel: 'עסקים למכירה' };
  }

  async function runSlice(db, plan) {
    const target = sliceTarget(plan);
    if (!target.table) {
      return { prose: 'כדי לספור צריך לציין אם הכוונה לעסקים, לקונים, למתווכים או להתאמות.', cards: [], plan, readOnly: true };
    }
    const counted = await exactCount(db, target.table, q => applySlice(q, target));
    if (counted.error) return { prose: 'לא הצלחתי לקרוא את החתך. ' + clip(counted.error, 160), cards: [], plan, readOnly: true };
    const copy = sliceCopy(target);
    const cols = target.table === 'businesses' ? 'id,internal_name,business_number,city,created_at,is_archived'
      : target.table === 'leads' ? 'id,type,full_name,first_name,last_name,client_number,city,created_at'
      : target.table === 'brokers' ? 'id,full_name,first_name,last_name,city,created_at'
      : 'id,status,created_at,buyer_id,business_id,broker_id,counterparty_type';
    const listed = await safeSelect(db, target.table, cols, q => applySlice(q, target).order('created_at', { ascending: false }).limit(8));
    const cards = [{ kind: 'screen', kindLabel: 'מסך', id: '', title: copy.screenLabel, subtitle: '', href: copy.screen, openLabel: 'פתח מסך', lines: [] }];
    (listed.rows || []).forEach(row => {
      if (target.table === 'matches') {
        cards.push({ kind: 'match', kindLabel: 'התאמה', id: row.id, title: row.status || 'התאמה', subtitle: fmtDate(row.created_at), href: cardHref('match', row.id), openLabel: 'פתח כרטיס', lines: ['נפתחה: ' + (fmtDate(row.created_at) || 'אין תאריך שמור')] });
        return;
      }
      const kind = target.table === 'businesses' ? 'business' : (target.table === 'brokers' ? 'broker' : 'lead');
      const title = kind === 'business' ? businessTitle(row) : (personName(row) || 'ללא שם');
      cards.push({ kind, kindLabel: kind === 'business' ? 'עסק' : (kind === 'broker' ? 'מתווך' : leadKindLabel(row.type)), id: row.id, title, subtitle: [row.business_number || row.client_number, row.city].filter(Boolean).join(' · '), href: cardHref(kind, row.id), openLabel: 'פתח כרטיס', lines: ['נכנס למערכת: ' + (fmtDate(row.created_at) || 'אין תאריך שמור')] });
    });
    const prose = 'בנתונים שזמינים לך יש ' + counted.count + ' ' + copy.noun + '.' + (listed.rows && listed.rows.length ? ' מוצגות עד 8 רשומות אחרונות.' : '');
    return { prose, cards, plan, readOnly: true };
  }

  async function reloadHit(db, card) {
    const table = card.kind === 'business' ? 'businesses' : (card.kind === 'broker' ? 'brokers' : (card.kind === 'match' ? 'matches' : 'leads'));
    const cols = card.kind === 'business' ? BUSINESS_COLS : (card.kind === 'broker' ? BROKER_COLS : (card.kind === 'match' ? MATCH_COLS : LEAD_COLS));
    const res = await safeSelect(db, table, cols, q => q.eq('id', card.id).limit(1));
    const row = res.rows[0];
    if (!row) return null;
    if (card.kind === 'match') {
      return { kind: 'match', kindLabel: 'התאמה', id: row.id, title: card.title || 'התאמה', subtitle: row.status || '', score: 100, row, href: cardHref('match', row.id), openLabel: 'פתח כרטיס' };
    }
    const kind = card.kind === 'business' || card.kind === 'broker' ? card.kind : 'lead';
    const hit = hitFrom(kind, row, card.title || personName(row) || businessTitle(row));
    hit.score = 100;
    return hit;
  }

  async function runFollowup(db, plan) {
    if (plan.pick !== null && plan.cards[plan.pick] && plan.cards[plan.pick].kind === 'match') {
      const hit = await reloadHit(db, plan.cards[plan.pick]);
      if (!hit || !hit.row) return { prose: 'לא מצאתי את ההתאמה הזו.', cards: [], plan, readOnly: true };
      const card = {
        kind: 'match', kindLabel: 'התאמה', id: hit.id, title: hit.title || 'התאמה',
        subtitle: hit.row.status || '', href: hit.href, openLabel: 'פתח כרטיס',
        lines: ['נפתחה: ' + (fmtDate(hit.row.created_at) || 'אין תאריך שמור'), 'סטטוס נוכחי: ' + (hit.row.status || 'ללא סטטוס')]
      };
      return { prose: 'ההתאמה נפתחה ב-' + (fmtDate(hit.row.created_at) || 'תאריך לא שמור') + '. סטטוס: ' + (hit.row.status || 'ללא סטטוס') + '.', cards: [card], plan, readOnly: true };
    }
    let source = plan.cards.filter(card => card.kind !== 'match' && card.kind !== 'screen');
    if (plan.pick !== null && plan.cards[plan.pick] && plan.cards[plan.pick].kind !== 'screen') source = [plan.cards[plan.pick]];
    source = source.slice(0, 3);
    const hits = [];
    for (const card of source) {
      if (!card || card.kind === 'match') continue;
      const hit = await reloadHit(db, card);
      if (hit && hit.kind !== 'match') hits.push(hit);
    }
    if (!hits.length) return { prose: 'אין רשומה קודמת לפתוח. כתוב את שם העסק או האדם.', cards: [], plan, readOnly: true };
    const extras = await loadExtras(db, hits, plan.focus);
    const cards = cardsFor(hits, extras, plan.focus);
    const prose = hits.length === 1
      ? proseFor(Object.assign({}, plan, { needle: hits[0].title }), hits, extras, false)
      : 'ממשיך לפי הרשומות מהשאלה הקודמת.';
    return { prose, cards, plan, readOnly: true };
  }

  async function runLookup(db, plan) {
    const found = await searchEntities(db, plan);
    if (!found.hits.length && found.errors.length) {
      return { prose: 'לא הצלחתי לקרוא מהמערכת. ' + clip(found.errors[0], 160), cards: [], plan, readOnly: true };
    }
    const extras = found.hits.length ? await loadExtras(db, found.hits, plan.focus) : {};
    const prose = proseFor(plan, found.hits, extras, found.widened);
    const cards = cardsFor(found.hits, extras, plan.focus);
    return { prose, cards, plan, readOnly: true };
  }

  async function answerQuestion(text, deps) {
    const plan = planQuestion(text, deps && deps.context);
    const db = deps && deps.db;
    if (plan.kind === 'clarify') return { prose: CLARIFY, cards: [], plan, readOnly: true };
    if (!db || typeof db.from !== 'function') return { prose: 'אין חיבור למערכת. התחבר מחדש ונסה שוב.', cards: [], plan, readOnly: true };
    try {
      if (plan.kind === 'slice') return await runSlice(db, plan);
      if (plan.kind === 'followup') return await runFollowup(db, plan);
      return await runLookup(db, plan);
    } catch (e) {
      return { prose: 'לא הצלחתי להשלים את החיפוש. ' + clip(e && e.message, 160), cards: [], plan, readOnly: true };
    }
  }

  function renderAnswerHtml(result) {
    const prose = '<div class="pa-prose">' + esc(result && result.prose) + '</div>';
    const cards = ((result && result.cards) || []).map(card => {
      const link = card.href ? '<a class="pa-open" href="' + esc(card.href) + '">' + esc(card.openLabel || 'פתח כרטיס') + '</a>' : '';
      const lines = (card.lines || []).map(line => '<div class="pa-line">' + esc(line) + '</div>').join('');
      return '<article class="pa-card"><div class="pa-card-top"><div><div class="pa-k">' + esc(card.kindLabel || '') + '</div><div class="pa-t">' + esc(card.title || '') + '</div>' + (card.subtitle ? '<div class="pa-s">' + esc(card.subtitle) + '</div>' : '') + '</div>' + link + '</div>' + lines + '</article>';
    }).join('');
    return prose + (cards ? '<div class="pa-cards">' + cards + '</div>' : '');
  }

  root.BSDAssistant = {
    planQuestion,
    answerQuestion,
    renderAnswerHtml,
    cardHref,
    orIlike,
    fmtDate,
    CLOSED_MATCH
  };
})(typeof window === 'undefined' ? globalThis : window);
