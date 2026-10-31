// Leads list ↔ lead card history.
// Back (browser or the in-app close) must return to the same list entry —
// filters, scroll, and row — and must not fall through to the dashboard.
// A card opened from the leads hub is its own document: the previous entry
// is already the hub, so we must not insert another list entry in front of it.
(function(root){
  const HUB_KEY = 'bsd:leads-hub:list';
  const DROP_FROM_LIST = ['card', 'open', 'new', 'pf_first_name', 'pf_last_name', 'pf_phone', 'pf_email', 'pf_notes'];

  function parse(href){
    try { return new URL(href || '/', 'https://bsd.local'); }
    catch (e) { return new URL('https://bsd.local/'); }
  }
  function serialize(u){
    return u.pathname + u.search + u.hash;
  }
  function listUrl(href){
    const u = parse(href);
    DROP_FROM_LIST.forEach(function(key){ u.searchParams.delete(key); });
    return serialize(u);
  }
  function cardUrl(href, id){
    const u = parse(href);
    u.searchParams.delete('open');
    if (id){
      u.searchParams.delete('new');
      u.searchParams.set('card', id);
    } else {
      u.searchParams.delete('card');
      u.searchParams.set('new', '1');
    }
    return serialize(u);
  }
  function cameFromHub(searchOrHref){
    const raw = String(searchOrHref || '');
    const q = raw.indexOf('?') >= 0 ? raw.slice(raw.indexOf('?')) : (raw.charAt(0) === '?' ? raw : '');
    return new URLSearchParams(q).get('from') === 'leads-hub';
  }

  // Returns the history operations for opening a card.
  // fromHub + a destination page (lead/business): replace this entry only.
  // Same-page list (hub modal, buyers list): stamp the list, then push the card.
  function planCardEntry(opts){
    opts = opts || {};
    const cardType = opts.cardType;
    const fromHub = !!opts.fromHub || !!(opts.state && opts.state.bsdFrom === 'leads-hub');
    const already = !!(opts.state && opts.state.bsdCardType === cardType);
    const cardState = {
      bsdCardType: cardType,
      recordId: opts.recordId || null,
      bsdFrom: fromHub ? 'leads-hub' : null,
      list: opts.listSnapshot || (opts.state && opts.state.list) || null
    };
    const card = cardUrl(opts.href || '/', opts.recordId || null);
    if (already){
      return { ops: [{ op: 'replace', state: Object.assign({}, opts.state, cardState), url: card }] };
    }
    if (fromHub && cardType !== 'hub-lead'){
      return { ops: [{ op: 'replace', state: cardState, url: card }] };
    }
    const listState = { bsdListType: opts.listType || 'leads', list: opts.listSnapshot || null };
    return { ops: [
      { op: 'replace', state: listState, url: listUrl(opts.href || '/') },
      { op: 'push', state: cardState, url: card }
    ]};
  }

  function applyHistory(plan){
    if (!plan || typeof history === 'undefined' || !history.pushState) return;
    plan.ops.forEach(function(op){
      if (op.op === 'push') history.pushState(op.state, '', op.url);
      else history.replaceState(op.state, '', op.url);
    });
  }

  function snapshotScroll(){
    if (typeof window === 'undefined') return { x: 0, y: 0 };
    return {
      x: window.scrollX || 0,
      y: window.scrollY || (document.documentElement && document.documentElement.scrollTop) || 0
    };
  }
  function applyScroll(scroll){
    if (!scroll || typeof window === 'undefined') return;
    const x = Number(scroll.x) || 0;
    const y = Number(scroll.y) || 0;
    const go = function(){ try { window.scrollTo(x, y); } catch (e) {} };
    go();
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(go);
    setTimeout(go, 0);
  }
  function revealRow(id){
    if (!id || typeof document === 'undefined') return;
    const safe = (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(String(id)) : String(id).replace(/[^A-Za-z0-9_-]/g, '');
    if (!safe) return;
    const row = document.querySelector('[data-lead-id="' + safe + '"]');
    if (!row || !row.getBoundingClientRect) return;
    const rect = row.getBoundingClientRect();
    const viewH = window.innerHeight || 0;
    if (rect.top < 80 || rect.bottom > viewH - 40){
      try { row.scrollIntoView({ block: 'center' }); }
      catch (e) { try { row.scrollIntoView(); } catch (e2) {} }
    }
  }
  function armScrollRestoration(){
    try { if (typeof history !== 'undefined' && 'scrollRestoration' in history) history.scrollRestoration = 'manual'; }
    catch (e) {}
  }
  function saveHub(state){
    try { sessionStorage.setItem(HUB_KEY, JSON.stringify(state)); } catch (e) {}
  }
  function takeHub(){
    try {
      const raw = sessionStorage.getItem(HUB_KEY);
      if (!raw) return null;
      sessionStorage.removeItem(HUB_KEY);
      const data = JSON.parse(raw);
      return data && data.v === 1 ? data : null;
    } catch (e) { return null; }
  }
  function navigationType(){
    try {
      const nav = performance.getEntriesByType('navigation')[0];
      return nav && nav.type ? nav.type : '';
    } catch (e) { return ''; }
  }

  root.BSDListReturn = {
    HUB_KEY: HUB_KEY,
    listUrl: listUrl,
    cardUrl: cardUrl,
    cameFromHub: cameFromHub,
    planCardEntry: planCardEntry,
    applyHistory: applyHistory,
    snapshotScroll: snapshotScroll,
    applyScroll: applyScroll,
    revealRow: revealRow,
    armScrollRestoration: armScrollRestoration,
    saveHub: saveHub,
    takeHub: takeHub,
    navigationType: navigationType
  };
})(typeof window === 'undefined' ? globalThis : window);
