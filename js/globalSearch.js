// Shared search for the dashboard, leads and buyers.
// Data: rpc crm_global_search (SECURITY INVOKER, so results follow the caller's own RLS). Min 2 chars, debounced.
(function () {
  'use strict';
  const MIN = 2;
  const DEBOUNCE_MS = 260;
  const BADGE_STYLE = {
    'קונה': ['#e0ecff', '#1d4ed8'],
    'בעל עסק': ['#ffe9d6', '#c2410c'],
    'משקיע': ['#efe5ff', '#6d28d9'],
    'עסק': ['#d9f5ee', '#0f766e'],
    'מתווך': ['#dff3fd', '#0369a1'],
    'נרשם לעדכונים': ['#fde4f1', '#be185d'],
    'מתעניין בהכשרה': ['#fff1cc', '#a16207'],
  };
  const KIND_ICON = { lead: '👤', review: '📋', business: '🏢', broker: '🤝', subscriber: '📬', training: '🎓' };

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function safeHref(h) {
    if (/^[a-z-]+\.html\?open=[0-9a-f-]{36}$/i.test(String(h || ''))) return h;
    return /^leads-hub\.html\?open=[0-9a-f-]{36}&tab=y2026$/i.test(String(h || '')) ? h : '#';
  }

  function injectStyle() {
    if (document.getElementById('gsStyle')) return;
    const css = `
.gs-wrap{position:relative;margin:4px 0 26px;z-index:30}
.gs-shell{position:relative;border-radius:22px;padding:3px;background:linear-gradient(120deg,#f5c84c,#ff8a5b 25%,#e04f9a 48%,#7c5cff 72%,#22b8cf);
  box-shadow:0 14px 28px rgba(14,27,52,.18),0 4px 0 #b88a1c,0 6px 14px rgba(124,92,255,.22);transition:transform .15s ease,box-shadow .15s ease}
.gs-shell:focus-within{transform:translateY(-2px);box-shadow:0 20px 38px rgba(14,27,52,.24),0 5px 0 #b88a1c,0 10px 24px rgba(124,92,255,.32)}
.gs-inner{display:flex;align-items:center;gap:12px;border-radius:19px;padding:6px 18px;
  background:linear-gradient(180deg,#ffffff 0%,#fbf7ec 100%);box-shadow:inset 0 2px 0 #fff,inset 0 -3px 8px rgba(14,27,52,.08)}
.gs-icon{flex:none;width:42px;height:42px;border-radius:14px;display:grid;place-items:center;font-size:1.25rem;
  background:linear-gradient(145deg,#1b2f57,#0e1b34);color:#f5c84c;box-shadow:0 3px 0 #050b18,inset 0 1px 0 rgba(255,255,255,.18)}
.gs-input{flex:1;min-width:0;border:0;outline:0;background:transparent;font-family:inherit;font-size:1.15rem;color:#0e1b34;padding:14px 2px;direction:rtl}
.gs-input::placeholder{color:#8a8fa3}
.gs-clear{flex:none;border:0;background:#eef0f6;color:#4b5470;border-radius:10px;width:32px;height:32px;cursor:pointer;font-size:1rem;display:none}
.gs-wrap.has-q .gs-clear{display:block}
.gs-hint{margin:8px 6px 0;font-size:.78rem;color:#7a8095}
.gs-panel{position:absolute;inset-inline:0;top:calc(100% + 10px);background:#fff;border-radius:18px;border:1px solid #ece6d2;
  box-shadow:0 24px 50px rgba(14,27,52,.22);max-height:min(62vh,560px);overflow:auto;padding:8px;display:none}
.gs-wrap.open .gs-panel{display:block}
.gs-row{display:flex;align-items:center;gap:12px;padding:11px 12px;border-radius:13px;text-decoration:none;color:#0e1b34;border:1px solid transparent}
.gs-row:hover,.gs-row.on{background:linear-gradient(90deg,#fff8e4,#f4f1ff);border-color:#efe2b5}
.gs-kind{flex:none;width:38px;height:38px;border-radius:12px;display:grid;place-items:center;font-size:1.1rem;background:#f4f5fa;box-shadow:inset 0 -2px 0 rgba(0,0,0,.06)}
.gs-main{flex:1;min-width:0}
.gs-title{font-weight:700;font-size:.98rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gs-sub{font-size:.8rem;color:#646b80;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gs-badges{flex:none;display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;max-width:46%}
.gs-badge{font-size:.72rem;font-weight:700;padding:3px 10px;border-radius:999px;white-space:nowrap;box-shadow:inset 0 -1px 0 rgba(0,0,0,.08)}
.gs-badge.arch{background:#e9eaee;color:#4b5060}
.gs-badge.extra{background:#fff4d6;color:#8a6410}
.gs-empty{padding:18px;text-align:center;color:#6b7186;font-size:.9rem}
.gs-count{padding:4px 10px 8px;font-size:.75rem;color:#8a8fa3}
@media (max-width:640px){.gs-input{font-size:1rem;padding:12px 0}.gs-badges{max-width:40%}.gs-icon{width:36px;height:36px}}
`;
    const el = document.createElement('style');
    el.id = 'gsStyle';
    el.textContent = css;
    document.head.appendChild(el);
  }

  function badgeHtml(label) {
    const [bg, fg] = BADGE_STYLE[label] || ['#eef0f6', '#334'];
    return `<span class="gs-badge" style="background:${bg};color:${fg}">${esc(label)}</span>`;
  }

  function rowHtml(r, i) {
    const badges = [badgeHtml(r.badge)];
    if (r.extra_badge) badges.push(`<span class="gs-badge extra">${esc(r.extra_badge)}</span>`);
    if (r.is_archived) badges.push('<span class="gs-badge arch">בארכיון</span>');
    return `<a class="gs-row" id="gsResult${i}" role="option" aria-selected="false" href="${esc(safeHref(r.href))}">
      <span class="gs-kind" aria-hidden="true">${KIND_ICON[r.kind] || '🔎'}</span>
      <span class="gs-main"><div class="gs-title">${esc(r.title)}</div><div class="gs-sub">${esc(r.subtitle || '')}</div></span>
      <span class="gs-badges">${badges.join('')}</span></a>`;
  }

  function mount(host) {
    if (!host || host.dataset.gsReady) return;
    host.dataset.gsReady = '1';
    injectStyle();
    host.innerHTML = `<div class="gs-wrap" id="gsWrap">
      <div class="gs-shell"><div class="gs-inner">
        <span class="gs-icon" aria-hidden="true">🔎</span>
        <input id="gsInput" class="gs-input" type="search" autocomplete="off" spellcheck="false" enterkeyhint="search"
          placeholder="שם, טלפון, מייל, מספר כרטיס, עיר או תחום" aria-label="חיפוש בכל המערכת" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="gsPanel">
        <button type="button" class="gs-clear" id="gsClear" title="ניקוי" aria-label="ניקוי">✕</button>
      </div></div>
      <div class="gs-panel" id="gsPanel" role="listbox"></div>
      <div class="gs-hint">חיפוש בכל קטגוריות הלידים ובכרטיסי הקונים והעסקים</div>
    </div>`;
    const wrap = host.querySelector('#gsWrap');
    const input = host.querySelector('#gsInput');
    const panel = host.querySelector('#gsPanel');
    let timer = null, seq = 0, results = [], active = -1;

    const close = () => {
      wrap.classList.remove('open');
      input.setAttribute('aria-expanded', 'false');
      setActive(-1);
    };
    const openPanel = () => { wrap.classList.add('open'); input.setAttribute('aria-expanded', 'true'); };
    const setActive = i => {
      const rows = panel.querySelectorAll('.gs-row');
      active = Math.max(-1, Math.min(i, rows.length - 1));
      rows.forEach((row, index) => {
        row.classList.toggle('on', index === active);
        row.setAttribute('aria-selected', String(index === active));
      });
      if (active >= 0) {
        input.setAttribute('aria-activedescendant', rows[active].id);
        rows[active].scrollIntoView({ block: 'nearest' });
      } else {
        input.removeAttribute('aria-activedescendant');
      }
    };
    const paint = (q, rows, error) => {
      results = rows || [];
      if (error) panel.innerHTML = `<div class="gs-empty">החיפוש לא הצליח כרגע. נסה שוב בעוד רגע.</div>`;
      else if (!results.length) panel.innerHTML = `<div class="gs-empty">לא נמצא דבר עבור «${esc(q)}»</div>`;
      else panel.innerHTML = `<div class="gs-count">${results.length === 1 ? 'תוצאה אחת' : results.length + ' תוצאות'}</div>` + results.map(rowHtml).join('');
      setActive(-1);
    };
    async function run(q, my) {
      try {
        const { data, error } = await window.supabaseClient.rpc('crm_global_search', { p_q: q });
        if (my !== seq) return;
        if (error) throw error;
        paint(q, data || []);
      } catch (e) {
        if (my !== seq) return;
        console.error('global search failed', e && e.message);
        paint(q, [], true);
      }
    }
    input.addEventListener('input', () => {
      const q = input.value.trim();
      wrap.classList.toggle('has-q', !!input.value);
      clearTimeout(timer);
      const my = ++seq;
      results = [];
      setActive(-1);
      if (q.length < MIN) { close(); panel.innerHTML = ''; return; }
      panel.innerHTML = '<div class="gs-empty" role="status">מחפש…</div>';
      openPanel();
      timer = setTimeout(() => run(q, my), DEBOUNCE_MS);
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); if (!wrap.classList.contains('open') && results.length) openPanel(); setActive(active + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
      else if (e.key === 'Enter') {
        const pick = results[active >= 0 ? active : 0];
        if (pick && wrap.classList.contains('open')) { e.preventDefault(); const h = safeHref(pick.href); if (h !== '#') location.href = h; }
      } else if (e.key === 'Escape') { close(); }
    });
    input.addEventListener('focus', () => { if (input.value.trim().length >= MIN && panel.innerHTML) openPanel(); });
    host.querySelector('#gsClear').addEventListener('click', () => {
      input.value = '';
      input.dispatchEvent(new Event('input'));
      input.focus();
    });
    document.addEventListener('click', e => { if (!wrap.contains(e.target)) close(); });
  }

  window.BSDGlobalSearch = { mount };
  function auto() { const host = document.getElementById('globalSearch'); if (host) mount(host); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', auto); else auto();
})();
