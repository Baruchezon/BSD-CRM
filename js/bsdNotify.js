// BSD CRM - gentle, controllable in-app notifications (build 202610051500)
//
// Why this exists (05.10.2026): the dashboard popups (new website lead,
// unread messages, today's tasks) were full-screen dark overlays. The new-lead
// one re-opened every 60 seconds and on every page load, because "סגירה" only
// removed the overlay from the screen and nothing remembered it. On top of that
// an ARCHIVED lead whose website_intake_stage was still 'new' kept popping forever.
//
// This module gives every popup the same simple rules:
//   1. A small card in the corner, not a blocking overlay. You can keep working.
//   2. "סגירה" (or ✕ / Esc) is remembered. The same item never pops again.
//   3. "הזכר לי בעוד שעה" (snooze) where it makes sense.
//   4. "🔕 השתק": for an hour / until tomorrow 08:00 / never show this type again.
//   5. One settings window (⚙️ הגדרות ← 🔔 הגדרות התראות קופצות) to turn it all
//      back on. The settings are saved on THIS device (localStorage).
// Nothing here writes to the database.
(function(){
  'use strict';
  var PREF_KEY = 'bsdNotifyPrefs_v1';
  var DISMISS_KEY = 'bsdNotifyDismissed_v1';
  var KEEP_MS = 60 * 24 * 3600 * 1000;   // forget dismissals after 60 days
  var MAX_ENTRIES = 800;
  var DEFAULTS = { leads: true, messages: true, tasks: true, sound: true, autoJump: false, muteUntil: 0 };
  var KIND_LABELS = { leads: 'לידים חדשים מהאתר', messages: 'הודעות פנימיות', tasks: 'משימות להיום', push: 'התראות Push' };

  function now(){ return Date.now(); }
  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; }); }
  function readJSON(key, fallback){ try { var v = JSON.parse(localStorage.getItem(key) || 'null'); return v && typeof v === 'object' ? v : fallback; } catch(e){ return fallback; } }
  function writeJSON(key, val){ try { localStorage.setItem(key, JSON.stringify(val)); } catch(e){} }

  // ---------- preferences ----------
  function prefs(){ var p = readJSON(PREF_KEY, {}); var out = {}; for (var k in DEFAULTS) out[k] = (k in p) ? p[k] : DEFAULTS[k]; return out; }
  function savePrefs(patch){ var p = prefs(); for (var k in patch) p[k] = patch[k]; writeJSON(PREF_KEY, p); refreshMenuLabel(); return p; }
  function mutedAll(p){ p = p || prefs(); return p.muteUntil === -1 || (typeof p.muteUntil === 'number' && p.muteUntil > now()); }
  function allowed(kind){ var p = prefs(); if (mutedAll(p)) return false; if (kind in DEFAULTS && p[kind] === false) return false; return true; }
  function soundAllowed(){ var p = prefs(); return !mutedAll(p) && p.sound !== false; }
  function autoJump(){ var p = prefs(); return !mutedAll(p) && p.autoJump === true; }
  function tomorrowMorning(){ var d = new Date(); d.setDate(d.getDate() + 1); d.setHours(8, 0, 0, 0); return d.getTime(); }
  function muteFor(ms){ return savePrefs({ muteUntil: ms === -1 ? -1 : now() + ms }); }
  function muteUntilTomorrow(){ return savePrefs({ muteUntil: tomorrowMorning() }); }
  function unmute(){ return savePrefs({ muteUntil: 0 }); }
  function muteStatusText(p){
    p = p || prefs();
    if (p.muteUntil === -1) return 'כל ההתראות הקופצות מושתקות עד שתפעיל אותן שוב';
    if (mutedAll(p)){ var d = new Date(p.muteUntil); return 'מושתק עד ' + d.toLocaleDateString('he-IL') + ' ' + d.toLocaleTimeString('he-IL', {hour:'2-digit', minute:'2-digit'}); }
    return '';
  }

  // ---------- dismissals / snoozes ----------
  function store(){ var s = readJSON(DISMISS_KEY, {}); return s; }
  function prune(s){
    var keys = Object.keys(s), t = now();
    keys.forEach(function(k){ var v = s[k]; if (!v || (v.until && v.until < t - KEEP_MS) || (!v.until && v.at && v.at < t - KEEP_MS)) delete s[k]; });
    keys = Object.keys(s);
    if (keys.length > MAX_ENTRIES){ keys.sort(function(a,b){ return (s[a].at||0) - (s[b].at||0); }).slice(0, keys.length - MAX_ENTRIES).forEach(function(k){ delete s[k]; }); }
    return s;
  }
  function dismiss(kind, id){ var s = store(); s[kind + ':' + id] = { at: now() }; writeJSON(DISMISS_KEY, prune(s)); }
  function snooze(kind, id, ms){ var s = store(); s[kind + ':' + id] = { at: now(), until: now() + ms }; writeJSON(DISMISS_KEY, prune(s)); }
  function isHidden(kind, id){ var v = store()[kind + ':' + id]; if (!v) return false; if (v.until) return v.until > now(); return true; }
  function isDismissed(kind, id){ var v = store()[kind + ':' + id]; return !!(v && !v.until); }

  // ---------- card UI ----------
  var STYLE_ID = 'bsdNotifyStyle';
  function ensureStyle(){
    if (document.getElementById(STYLE_ID)) return;
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = [
      '#bsdNotifyStack{position:fixed;bottom:16px;left:16px;z-index:9990;display:flex;flex-direction:column-reverse;gap:10px;width:min(380px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow-y:auto;direction:rtl;font-family:"Heebo","Rubik",sans-serif;pointer-events:none;}',
      '.bsd-ncard{pointer-events:auto;background:#fff;border:1px solid #e3dccb;border-right:4px solid #c9a24b;border-radius:12px;box-shadow:0 10px 30px rgba(14,27,52,.22);padding:12px 14px 10px;color:#1c2333;animation:bsdNIn .18s ease-out;}',
      '@keyframes bsdNIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}',
      '.bsd-ncard-head{display:flex;align-items:flex-start;gap:8px;}',
      '.bsd-ncard-icon{font-size:1.3rem;line-height:1.2;}',
      '.bsd-ncard-title{flex:1;font-weight:700;color:#0e1b34;font-size:.95rem;line-height:1.35;}',
      '.bsd-ncard-x{background:none;border:none;color:#8a93a8;font-size:1.1rem;cursor:pointer;padding:0 2px;line-height:1;min-width:28px;min-height:28px;}',
      '.bsd-ncard-x:hover{color:#0e1b34;}',
      '.bsd-ncard-body{font-size:.86rem;color:#40485c;margin:4px 0 10px;}',
      '.bsd-ncard-actions{display:flex;flex-wrap:wrap;gap:6px;align-items:center;}',
      '.bsd-nbtn{border-radius:7px;padding:7px 12px;font-family:inherit;font-size:.8rem;font-weight:700;cursor:pointer;text-decoration:none;display:inline-block;border:1px solid #d8d3c4;background:#fff;color:#0e1b34;}',
      '.bsd-nbtn.primary{background:#0e1b34;color:#fff;border-color:#0e1b34;}',
      '.bsd-nbtn.link{border:none;background:none;color:#5a6378;font-weight:600;padding:7px 6px;}',
      '.bsd-nmute{display:none;margin-top:8px;padding-top:8px;border-top:1px dashed #e3dccb;gap:6px;flex-wrap:wrap;}',
      '.bsd-nmute.open{display:flex;}',
      '#bsdNotifySettings{position:fixed;inset:0;background:rgba(14,27,52,.45);z-index:9995;display:flex;align-items:center;justify-content:center;padding:16px;direction:rtl;font-family:"Heebo","Rubik",sans-serif;}',
      '#bsdNotifySettings .box{background:#fff;border-radius:14px;padding:20px 22px;max-width:420px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.35);}',
      '#bsdNotifySettings label{display:flex;flex-direction:row;justify-content:flex-start;text-align:right;align-items:center;gap:10px;padding:8px 0;font-size:.9rem;color:#1c2333;cursor:pointer;}',
      '#bsdNotifySettings input[type=checkbox]{width:18px;height:18px;}',
      '#bsdNotifySettings input[type=checkbox]{flex:0 0 auto;margin:0;}',
      '@media (max-width:600px){#bsdNotifyStack{left:8px;right:8px;bottom:8px;width:auto;max-height:55vh;}.bsd-ncard{padding:10px 12px 8px;}.bsd-ncard-body{margin:2px 0 8px;}}'
    ].join('\n');
    document.head.appendChild(st);
  }
  function stack(){
    var el = document.getElementById('bsdNotifyStack');
    if (!el){ ensureStyle(); el = document.createElement('div'); el.id = 'bsdNotifyStack'; el.setAttribute('role', 'region'); el.setAttribute('aria-label', 'התראות'); document.body.appendChild(el); }
    return el;
  }
  function findCard(key){ var all = document.querySelectorAll('.bsd-ncard'); for (var i = 0; i < all.length; i++) if (all[i].dataset.key === key) return all[i]; return null; }
  function closeCard(key){ var c = findCard(key); if (c) c.remove(); }

  // opts: { key, kind, icon, title, bodyHtml, actions:[{label, href, primary, onClick, keepOpen}], onDismiss, snoozeMs, onSnooze }
  function showCard(opts){
    var old = findCard(opts.key);
    if (old) old.remove();
    var card = document.createElement('div');
    card.className = 'bsd-ncard';
    card.dataset.key = opts.key;
    card.dataset.kind = opts.kind || '';
    card.setAttribute('role', 'status');
    card.setAttribute('aria-live', 'polite');
    var kindLabel = KIND_LABELS[opts.kind] || 'התראות מסוג זה';
    card.innerHTML =
      '<div class="bsd-ncard-head"><span class="bsd-ncard-icon">' + (opts.icon || '🔔') + '</span>' +
      '<div class="bsd-ncard-title">' + esc(opts.title) + '</div>' +
      '<button type="button" class="bsd-ncard-x" data-act="close" title="סגירה (לא יופיע שוב)" aria-label="סגירה">✕</button></div>' +
      (opts.bodyHtml ? '<div class="bsd-ncard-body">' + opts.bodyHtml + '</div>' : '') +
      '<div class="bsd-ncard-actions">' +
        (opts.actions || []).map(function(a, i){
          var cls = 'bsd-nbtn' + (a.primary ? ' primary' : '');
          return a.href ? '<a class="' + cls + '" data-act="a' + i + '" href="' + esc(a.href) + '">' + esc(a.label) + '</a>'
                        : '<button type="button" class="' + cls + '" data-act="a' + i + '">' + esc(a.label) + '</button>';
        }).join('') +
        (opts.snoozeMs ? '<button type="button" class="bsd-nbtn" data-act="snooze">⏰ הזכר לי בעוד שעה</button>' : '') +
        '<button type="button" class="bsd-nbtn" data-act="close">סגירה</button>' +
        '<button type="button" class="bsd-nbtn link" data-act="mute" aria-expanded="false">🔕 השתק</button>' +
      '</div>' +
      '<div class="bsd-nmute">' +
        '<button type="button" class="bsd-nbtn" data-act="mute1h">לשעה</button>' +
        '<button type="button" class="bsd-nbtn" data-act="muteTomorrow">עד מחר 08:00</button>' +
        (opts.kind && opts.kind in DEFAULTS ? '<button type="button" class="bsd-nbtn" data-act="muteKind">לא להציג יותר ' + esc(kindLabel) + '</button>' : '') +
        '<button type="button" class="bsd-nbtn link" data-act="settings">⚙️ הגדרות</button>' +
      '</div>';
    function done(){ card.remove(); }
    function dismissNow(){ if (opts.onDismiss) try { opts.onDismiss(); } catch(e){} done(); }
    card.addEventListener('click', function(ev){
      var t = ev.target.closest('[data-act]'); if (!t) return;
      var act = t.dataset.act;
      if (act === 'close') return dismissNow();
      if (act === 'snooze'){ if (opts.onSnooze) try { opts.onSnooze(opts.snoozeMs); } catch(e){} return done(); }
      if (act === 'mute'){ var m = card.querySelector('.bsd-nmute'); var open = !m.classList.contains('open'); m.classList.toggle('open', open); t.setAttribute('aria-expanded', open ? 'true' : 'false'); return; }
      if (act === 'mute1h'){ muteFor(3600 * 1000); dismissNow(); return toastHint('🔕 ההתראות הקופצות מושתקות לשעה'); }
      if (act === 'muteTomorrow'){ muteUntilTomorrow(); dismissNow(); return toastHint('🔕 ההתראות הקופצות מושתקות עד מחר 08:00'); }
      if (act === 'muteKind'){ var patch = {}; patch[opts.kind] = false; savePrefs(patch); dismissNow(); return toastHint('🔕 ' + kindLabel + ' לא יקפצו יותר. אפשר להחזיר ב: ⚙️ הגדרות ← 🔔 הגדרות התראות קופצות'); }
      if (act === 'settings'){ return openSettings(); }
      var idx = act.charAt(0) === 'a' ? parseInt(act.slice(1), 10) : -1;
      var a = (opts.actions || [])[idx];
      if (!a) return;
      if (a.onClick){ ev.preventDefault(); try { a.onClick(ev); } catch(e){} }
      if (!a.keepOpen) done();
    });
    stack().appendChild(card);
    return card;
  }

  function toastHint(text){
    ensureStyle();
    var t = document.createElement('div');
    t.className = 'bsd-ncard';
    t.style.cssText = 'font-size:.82rem;padding:10px 14px;';
    t.textContent = text;
    stack().appendChild(t);
    setTimeout(function(){ if (t.isConnected) t.remove(); }, 4500);
  }

  document.addEventListener('keydown', function(ev){
    if (ev.key !== 'Escape') return;
    if (document.getElementById('bsdNotifySettings')){ document.getElementById('bsdNotifySettings').remove(); return; }
    var cards = document.querySelectorAll('#bsdNotifyStack .bsd-ncard');
    var last = cards[cards.length - 1];
    if (!last) return;
    var x = last.querySelector('[data-act="close"]');
    if (x) x.click(); else last.remove();
  });

  // ---------- settings window ----------
  function openSettings(){
    ensureStyle();
    var old = document.getElementById('bsdNotifySettings'); if (old) old.remove();
    var p = prefs();
    var wrap = document.createElement('div');
    wrap.id = 'bsdNotifySettings';
    var status = muteStatusText(p);
    wrap.innerHTML =
      '<div class="box" role="dialog" aria-modal="true" aria-label="הגדרות התראות קופצות">' +
        '<div style="font-weight:700;color:#0e1b34;font-size:1.05rem;margin-bottom:4px;">🔔 הגדרות התראות קופצות</div>' +
        '<div style="color:#8a93a8;font-size:.78rem;margin-bottom:10px;">נשמר במכשיר הזה. כל התראה שסגרת לא תקפוץ שוב.</div>' +
        (status ? '<div data-role="status" style="background:#fff6e0;border:1px solid #e8d6a6;color:#6b5414;border-radius:8px;padding:8px 10px;font-size:.84rem;margin-bottom:8px;">🔕 ' + esc(status) + ' <button type="button" class="bsd-nbtn" data-act="unmute" style="margin-inline-start:6px;">הפעל עכשיו</button></div>' : '') +
        '<label><input type="checkbox" data-pref="leads"' + (p.leads ? ' checked' : '') + '> 🆕 ' + KIND_LABELS.leads + '</label>' +
        '<label><input type="checkbox" data-pref="messages"' + (p.messages ? ' checked' : '') + '> 💬 ' + KIND_LABELS.messages + '</label>' +
        '<label><input type="checkbox" data-pref="tasks"' + (p.tasks ? ' checked' : '') + '> 📋 ' + KIND_LABELS.tasks + '</label>' +
        '<label><input type="checkbox" data-pref="sound"' + (p.sound ? ' checked' : '') + '> 🔊 צליל כשמגיעה התראת Push והמערכת פתוחה</label>' +
        '<label><input type="checkbox" data-pref="autoJump"' + (p.autoJump ? ' checked' : '') + '> ↪️ לעבור אוטומטית למסך ההתראה כשמגיעה התראת Push (במקום כרטיס קטן)</label>' +
        '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;">' +
          '<button type="button" class="bsd-nbtn" data-act="m1h">🔕 השתק הכול לשעה</button>' +
          '<button type="button" class="bsd-nbtn" data-act="mTom">🔕 עד מחר 08:00</button>' +
          '<button type="button" class="bsd-nbtn" data-act="mForever">🔕 עד שאפעיל שוב</button>' +
        '</div>' +
        '<div style="color:#8a93a8;font-size:.74rem;margin-top:10px;">התראות Push לטלפון/למחשב (גם כשהמערכת סגורה) מופעלות ומבוטלות בכפתור «התראות» שבתפריט ⚙️ הגדרות.</div>' +
        '<div style="display:flex;justify-content:flex-end;margin-top:14px;"><button type="button" class="bsd-nbtn primary" data-act="closeSettings">סיום</button></div>' +
      '</div>';
    wrap.addEventListener('change', function(ev){ var k = ev.target.dataset && ev.target.dataset.pref; if (!k) return; var patch = {}; patch[k] = !!ev.target.checked; savePrefs(patch); });
    wrap.addEventListener('click', function(ev){
      if (ev.target === wrap) return wrap.remove();
      var t = ev.target.closest('[data-act]'); if (!t) return;
      var act = t.dataset.act;
      if (act === 'closeSettings') return wrap.remove();
      if (act === 'unmute'){ unmute(); return openSettings(); }
      if (act === 'm1h'){ muteFor(3600 * 1000); return openSettings(); }
      if (act === 'mTom'){ muteUntilTomorrow(); return openSettings(); }
      if (act === 'mForever'){ muteFor(-1); return openSettings(); }
    });
    document.body.appendChild(wrap);
  }

  // ---------- menu entry next to the push bell (⚙️ הגדרות menu) ----------
  function refreshMenuLabel(){
    var a = document.getElementById('bsdNotifySettingsLink');
    if (a) a.textContent = mutedAll() ? '🔕 הגדרות התראות קופצות (מושתק)' : '🔔 הגדרות התראות קופצות';
  }
  function injectMenuLink(){
    if (document.getElementById('bsdNotifySettingsLink')) return;
    var bell = document.getElementById('pushBellBtn');
    if (!bell || !bell.parentNode) return;
    var a = document.createElement('a');
    a.id = 'bsdNotifySettingsLink';
    a.href = 'javascript:void(0)';
    a.style.cssText = bell.getAttribute('style') || '';
    a.addEventListener('click', function(ev){ ev.preventDefault(); openSettings(); });
    bell.parentNode.insertBefore(a, bell.nextSibling);
    refreshMenuLabel();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', injectMenuLink); else injectMenuLink();

  window.BSDNotify = {
    prefs: prefs, savePrefs: savePrefs, allowed: allowed, soundAllowed: soundAllowed, autoJump: autoJump,
    mutedAll: mutedAll, muteFor: muteFor, muteUntilTomorrow: muteUntilTomorrow, unmute: unmute,
    dismiss: dismiss, snooze: snooze, isHidden: isHidden, isDismissed: isDismissed,
    showCard: showCard, closeCard: closeCard, findCard: findCard, openSettings: openSettings, toastHint: toastHint
  };
})();
