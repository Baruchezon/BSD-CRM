// Shared search for the dashboard, leads and buyers.
// Every result has a ⋮ menu: open card, send agreement, send business card, WhatsApp, call.
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
.gs-row{padding:0;gap:0}
.gs-link{flex:1;min-width:0;display:flex;align-items:center;gap:12px;padding:11px 12px;text-decoration:none;color:inherit}
.gs-more{flex:none;width:40px;height:40px;margin-inline-start:2px;margin-inline-end:6px;border-radius:12px;border:1px solid #e3dcc4;background:#fff;color:#1b2f57;font-size:1.35rem;font-weight:800;line-height:1;cursor:pointer;box-shadow:0 2px 0 #e9e2cc}
.gs-more:hover,.gs-more[aria-expanded="true"]{background:#1b2f57;color:#f5c84c;border-color:#1b2f57}
.gs-menu{position:fixed;z-index:9999;min-width:230px;max-width:min(320px,calc(100vw - 16px));max-height:min(70vh,460px);overflow:auto;background:#152645;border:1px solid rgba(255,255,255,.15);border-radius:12px;box-shadow:0 18px 40px rgba(0,0,0,.45);direction:rtl;padding:4px 0}
.gs-menu-head{padding:10px 16px 8px;color:#f5c84c;font-weight:800;font-size:.88rem;border-bottom:1px solid rgba(255,255,255,.1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gs-menu button,.gs-menu a{display:block;width:100%;text-align:right;background:none;border:0;color:#fff;text-decoration:none;padding:12px 16px;font-size:.9rem;font-family:inherit;cursor:pointer;border-top:1px solid rgba(255,255,255,.08)}
.gs-menu .gs-menu-head + button,.gs-menu .gs-menu-head + a{border-top:0}
.gs-menu button:hover,.gs-menu a:hover,.gs-menu button:focus-visible,.gs-menu a:focus-visible{background:rgba(245,200,76,.14);outline:0}
.gs-menu .gs-menu-note{padding:10px 16px;color:#b9c3d8;font-size:.8rem;border-top:1px solid rgba(255,255,255,.08)}
.gs-menu .gs-menu-ok{color:#86efac}
.gs-toast{position:fixed;bottom:22px;left:50%;transform:translateX(-50%);z-index:10000;background:#0e1b34;color:#fff;padding:12px 20px;border-radius:12px;font-size:.9rem;box-shadow:0 10px 30px rgba(0,0,0,.35);direction:rtl;max-width:calc(100vw - 32px)}
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
    return `<div class="gs-row" id="gsResult${i}" role="option" aria-selected="false">
      <a class="gs-link" href="${esc(safeHref(r.href))}">
      <span class="gs-kind" aria-hidden="true">${KIND_ICON[r.kind] || '🔎'}</span>
      <span class="gs-main"><div class="gs-title">${esc(r.title)}</div><div class="gs-sub">${esc(r.subtitle || '')}</div></span>
      <span class="gs-badges">${badges.join('')}</span></a>
      <button type="button" class="gs-more" data-gs-more="${i}" aria-haspopup="menu" aria-expanded="false" aria-label="פעולות עבור ${esc(r.title)}" title="פעולות">⋮</button></div>`;
  }

  // ───── תפריט שלוש נקודות על כל תוצאה (26.11.2026, בקשת ברוך) ─────
  // מכל תוצאה בחיפוש: פתיחת כרטיס, שליחת הסכם, שליחת כרטיס ביקור, וואטסאפ וחיוג -
  // בלי לחפש באיזה מסך הרשומה נמצאת. שליחת ההסכם עושה בדיוק מה שעושים
  // sendAgreementForLead / sendAgreementForBiz / sendAgreementForBroker במסכים עצמם.
  const AGREEMENT_URL = 'https://baruchezon.github.io/bsd-contracts/bsd-admin-prep.html?';
  const SIGNED = 'יש הסכם חתום';
  const SENT = 'נשלח הסכם לחתימה';
  const DETAIL = {
    lead: ['leads', 'id,full_name,first_name,last_name,phone,phone2,type,business_name,requested_field,agreement_status,whatsapp_channel'],
    business: ['businesses', 'id,internal_name,owner_name,owner_phone,agreement_status,whatsapp_channel'],
    broker: ['brokers', 'id,full_name,first_name,last_name,phone,agreement_status,commission_type,full_handling_pct,referral_pct,whatsapp_channel'],
    review: ['leads_2026_review', 'id,full_name,phone'],
    training: ['training_leads', 'id,first_name,last_name,phone'],
    subscriber: ['business_alert_subscribers', 'id,first_name,last_name,phone'],
  };
  let menuEl = null, menuBtn = null, profilePromise = null, cardPromise = null;

  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'gs-toast';
    t.setAttribute('role', 'status');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 4200);
  }
  function getProfile() {
    try { if (typeof CURRENT_PROFILE !== 'undefined' && CURRENT_PROFILE && CURRENT_PROFILE.id) return Promise.resolve(CURRENT_PROFILE); } catch (_) {}
    if (!profilePromise) {
      profilePromise = (async () => {
        const { data: u } = await window.supabaseClient.auth.getUser();
        const uid = u && u.user && u.user.id;
        if (!uid) return null;
        const { data } = await window.supabaseClient.from('profiles').select('*').eq('id', uid).maybeSingle();
        return data || null;
      })().catch(() => { profilePromise = null; return null; });
    }
    return profilePromise;
  }
  function canSendAgreement(p) {
    if (!p) return false;
    if (p.role === 'admin' || p.role === 'manager') return true;
    return !!p.can_send_agreement;
  }
  function myCard() {
    if (!cardPromise) {
      cardPromise = (async () => {
        const p = await getProfile();
        if (!p) return null;
        const { data, error } = await window.supabaseClient.from('agent_digital_cards').select('*')
          .eq('owner_user_id', p.id).order('created_at', { ascending: false });
        if (error) throw error;
        const rows = data || [];
        return rows.find(c => c.short_code === 'ezon') || rows.find(c => c.is_published) || rows[0] || null;
      })().catch(() => { cardPromise = null; return null; });
    }
    return cardPromise;
  }
  function cardUrl(c) {
    return c.short_code
      ? new URL(c.short_code === 'ezon' ? 'c/ezon/' : 'c/#' + encodeURIComponent(c.short_code), location.href).href
      : new URL('digital-card.html?card=' + encodeURIComponent(c.public_token), location.href).href;
  }
  function phoneFromSubtitle(sub) {
    const m = String(sub || '').match(/\+?\d[\d\s().-]{6,}\d/);
    return m ? m[0] : '';
  }
  // 050-1234567 / +972 50… → 972501234567 (לוואטסאפ). מחזיר '' כשזה לא מספר תקין.
  function waDigits(phone) {
    let d = String(phone || '').replace(/\D/g, '');
    if (d.startsWith('00')) d = d.slice(2);
    if (/^0[1-9]\d{7,8}$/.test(d)) d = '972' + d.slice(1);
    if (/^9720/.test(d)) d = '972' + d.slice(4);
    return /^[1-9]\d{8,14}$/.test(d) ? d : '';
  }
  function personName(rec, fallback) {
    if (!rec) return fallback || '';
    return (rec.full_name && String(rec.full_name).trim())
      || [rec.first_name, rec.last_name].filter(Boolean).join(' ').trim()
      || fallback || '';
  }
  async function loadDetail(r) {
    const d = DETAIL[r.kind];
    if (!d) return null;
    try {
      const { data } = await window.supabaseClient.from(d[0]).select(d[1]).eq('id', r.id).maybeSingle();
      return data || null;
    } catch (_) { return null; }
  }
  async function loadBrokerDefaults() {
    let referral = 20, full = 50;
    try {
      const { data } = await window.supabaseClient.from('settings').select('extra').eq('id', 1).single();
      if (data && data.extra) {
        if (data.extra.broker_referral_pct_default != null) referral = data.extra.broker_referral_pct_default;
        if (data.extra.broker_full_handling_pct_default != null) full = data.extra.broker_full_handling_pct_default;
      }
    } catch (_) {}
    return { referral, full };
  }

  async function sendAgreement(r, rec) {
    const table = DETAIL[r.kind][0];
    // נפתח חלון מיד בלחיצה (לפני כל המתנה לשרת), כדי שחוסם החלונות הקופצים
    // בטלפון ובדפדפן לא יחסום אותו. הכתובת נקבעת אחרי עדכון הסטטוס.
    const win = window.open('', '_blank');
    try {
      if (rec.agreement_status !== SIGNED) {
        const patch = r.kind === 'lead' ? { agreement_status: SENT, agreement_sent: true } : { agreement_status: SENT };
        const { error } = await window.supabaseClient.from(table).update(patch).eq('id', rec.id);
        if (error) throw error;
        rec.agreement_status = SENT;
      }
      let params;
      if (r.kind === 'lead') {
        params = new URLSearchParams({
          type: rec.type === 'seller' ? 'seller' : 'buyer', recordId: rec.id, recordTable: 'leads', leadType: rec.type || '',
          name: personName(rec), phone: rec.phone || '',
          biz: rec.type === 'seller' ? (rec.business_name || '') : (rec.requested_field || ''),
        });
      } else if (r.kind === 'business') {
        params = new URLSearchParams({
          type: 'seller', recordId: rec.id, recordTable: 'businesses',
          name: rec.owner_name || '', phone: rec.owner_phone || '', biz: rec.internal_name || '',
        });
      } else {
        const def = await loadBrokerDefaults();
        const ctype = rec.commission_type || (rec.full_handling_pct != null && rec.referral_pct == null ? 'טיפול מלא' : 'הפניה');
        const pct = ctype === 'טיפול מלא' ? (rec.full_handling_pct ?? def.full) : (rec.referral_pct ?? def.referral);
        params = new URLSearchParams({
          type: 'broker', recordId: rec.id, brokerId: rec.id, name: personName(rec), phone: rec.phone || '',
          commissionType: ctype, pct: String(pct),
        });
      }
      if (window.BSD_CONFIG && window.BSD_CONFIG.WHATSAPP_API_UI === true && rec.whatsapp_channel === 'api') {
        params.set('waApi', '1'); params.set('recordTable', table);
      }
      const url = AGREEMENT_URL + params.toString();
      if (win && !win.closed) win.location.href = url; else window.open(url, '_blank');
      toast('נפתח ממשק הכנת ההסכם עבור ' + (personName(rec) || rec.owner_name || r.title));
    } catch (e) {
      if (win && !win.closed) win.close();
      toast('שליחת ההסכם לא הצליחה: ' + ((e && e.message) || e));
    }
  }

  async function sendCard(phone) {
    const wa = waDigits(phone);
    const win = window.open('', '_blank');
    try {
      const c = await myCard();
      if (!c) { if (win) win.close(); toast('עדיין אין לך כרטיס ביקור. אפשר ליצור אותו במסך «כרטיס ביקור דיגיטלי».'); return; }
      if (!c.is_published) { if (win) win.close(); toast('כרטיס הביקור שלך בטיוטה. יש לפרסם אותו במסך «כרטיס ביקור דיגיטלי» לפני שליחה.'); return; }
      const text = 'שלום, מצורף כרטיס הביקור הדיגיטלי שלי: ' + c.full_name + '\n' + cardUrl(c);
      const url = 'https://wa.me/' + wa + '?text=' + encodeURIComponent(text);
      if (win && !win.closed) win.location.href = url; else window.open(url, '_blank');
    } catch (e) {
      if (win && !win.closed) win.close();
      toast('לא ניתן לשלוח את כרטיס הביקור: ' + ((e && e.message) || e));
    }
  }

  function closeMenu(restoreFocus) {
    if (!menuEl) return;
    menuEl.remove();
    menuEl = null;
    if (menuBtn) {
      menuBtn.setAttribute('aria-expanded', 'false');
      if (restoreFocus && menuBtn.isConnected) menuBtn.focus({ preventScroll: true });
    }
    menuBtn = null;
  }
  function placeMenu() {
    if (!menuEl || !menuBtn) return;
    const rect = menuBtn.getBoundingClientRect();
    const vw = document.documentElement.clientWidth, vh = window.innerHeight, m = 8;
    const { width, height } = menuEl.getBoundingClientRect();
    const below = vh - m - rect.bottom - 4, above = rect.top - m - 4;
    const top = height > below && above > below ? rect.top - 4 - height : rect.bottom + 4;
    menuEl.style.top = Math.max(m, Math.min(top, vh - m - height)) + 'px';
    menuEl.style.left = Math.max(m, Math.min(rect.left, vw - m - width)) + 'px';
  }
  function item(label, fn) {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    b.textContent = label;
    b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); closeMenu(); fn(); });
    return b;
  }
  function note(text, cls) {
    const n = document.createElement('div');
    n.className = 'gs-menu-note' + (cls ? ' ' + cls : '');
    n.textContent = text;
    return n;
  }
  async function openMenu(btn, r) {
    if (menuBtn === btn) { closeMenu(true); return; }
    closeMenu();
    menuBtn = btn;
    btn.setAttribute('aria-expanded', 'true');
    const el = document.createElement('div');
    el.className = 'gs-menu';
    el.setAttribute('role', 'menu');
    el.addEventListener('click', e => e.stopPropagation());
    const head = document.createElement('div');
    head.className = 'gs-menu-head';
    head.textContent = r.title || 'פעולות';
    el.appendChild(head);
    el.appendChild(note('טוען פעולות…'));
    document.body.appendChild(el);
    menuEl = el;
    placeMenu();

    const [rec, profile] = await Promise.all([loadDetail(r), getProfile()]);
    myCard(); // טעינה מוקדמת, כדי שלחיצה על «כרטיס ביקור» תהיה מיידית
    if (menuEl !== el) return; // נסגר או נפתח תפריט אחר בינתיים
    el.querySelectorAll('.gs-menu-note').forEach(n => n.remove());

    const href = safeHref(r.href);
    if (href !== '#') el.appendChild(item('📂 פתח כרטיס', () => { location.href = href; }));

    const canAgreement = ['lead', 'business', 'broker'].includes(r.kind);
    if (canAgreement && rec) {
      if (!canSendAgreement(profile)) el.appendChild(note('אין לך הרשאה לשליחת הסכמים'));
      else if (rec.agreement_status === SIGNED) {
        el.appendChild(note('✅ יש הסכם חתום', 'gs-menu-ok'));
        el.appendChild(item('📄 שלח הסכם נוסף', () => sendAgreement(r, rec)));
      } else {
        const label = r.kind === 'business' ? '📄 שלח הסכם לבעל העסק'
          : rec.agreement_status === SENT ? '📄 שלח הסכם שוב (כבר נשלח פעם)' : '📄 שלח הסכם';
        el.appendChild(item(label, () => sendAgreement(r, rec)));
      }
    } else if (canAgreement && !rec) {
      el.appendChild(note('לא ניתן לטעון את פרטי הרשומה'));
    }

    const phone = rec ? (r.kind === 'business' ? rec.owner_phone : (rec.phone || rec.phone2)) : phoneFromSubtitle(r.subtitle);
    const wa = waDigits(phone);
    if (wa) {
      el.appendChild(item('💳 שלח כרטיס ביקור (וואטסאפ)', () => sendCard(phone)));
      el.appendChild(item('💬 וואטסאפ', () => window.open('https://wa.me/' + wa, '_blank', 'noopener')));
    }
    if (phone && String(phone).replace(/\D/g, '').length >= 7) {
      const dial = String(phone).replace(/[^\d+]/g, '');
      el.appendChild(item('📞 חייג ' + phone, () => { location.href = 'tel:' + dial; }));
    }
    if (!wa && !phone) el.appendChild(note('אין מספר טלפון ברשומה'));
    placeMenu();
    const first = el.querySelector('button');
    if (first && document.activeElement === btn) first.focus({ preventScroll: true });
  }

  document.addEventListener('click', e => {
    if (menuEl && !menuEl.contains(e.target) && !(menuBtn && menuBtn.contains(e.target))) closeMenu();
  });
  document.addEventListener('keydown', e => {
    if (!menuEl) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(true); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const items = [...menuEl.querySelectorAll('button')];
      if (!items.length) return;
      e.preventDefault();
      const i = items.indexOf(document.activeElement);
      const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i <= 0 ? items.length - 1 : i - 1);
      items[next].focus();
    }
  }, true);
  window.addEventListener('resize', () => closeMenu());
  window.addEventListener('scroll', e => { if (menuEl && !(e.target instanceof Node && menuEl.contains(e.target))) closeMenu(); }, true);

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
      <div class="gs-hint">חיפוש בכל המערכת: לידים, קונים, עסקים ומתווכים · לחיצה על ⋮ ליד תוצאה = שליחת הסכם, כרטיס ביקור, וואטסאפ וחיוג</div>
    </div>`;
    const wrap = host.querySelector('#gsWrap');
    const input = host.querySelector('#gsInput');
    const panel = host.querySelector('#gsPanel');
    let timer = null, seq = 0, results = [], active = -1;

    const close = () => {
      closeMenu();
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
    panel.addEventListener('click', e => {
      const more = e.target.closest('[data-gs-more]');
      if (!more) return;
      e.preventDefault();
      e.stopPropagation();
      const r = results[Number(more.dataset.gsMore)];
      if (r) openMenu(more, r);
    });
    input.addEventListener('focus', () => { if (input.value.trim().length >= MIN && panel.innerHTML) openPanel(); });
    host.querySelector('#gsClear').addEventListener('click', () => {
      input.value = '';
      input.dispatchEvent(new Event('input'));
      input.focus();
    });
    document.addEventListener('click', e => { if (!wrap.contains(e.target) && !(menuEl && menuEl.contains(e.target))) close(); });
  }

  window.BSDGlobalSearch = { mount };
  function auto() { const host = document.getElementById('globalSearch'); if (host) mount(host); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', auto); else auto();
})();
