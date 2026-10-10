// BSD CRM - "black box" (10.10.2026, STAGING ONLY): a local-only diagnostic recorder for the
// random white-screen freezes on Android Chrome. It NEVER sends anything over the network.
// It keeps the last ~200 technical events in this browser's localStorage, so that after a
// freeze + force-stop the next visit can show what happened right before (blackbox.html).
// Recorded: page file name (no query/hash), lifecycle events (visibility, pagehide/pageshow,
// freeze/resume), JS errors (message cut to 160 chars + file name:line), unhandled promise
// rejections, long main-thread tasks (>200ms), JS heap size (Chrome), navigation type,
// Chrome major version, device memory, network type. NOT recorded: URLs with parameters,
// form contents, names, phone numbers, e-mails, tokens, passwords, record ids.
(function bsdBlackBox(){
  'use strict';
  var KEY = 'bsd-blackbox-v1', OPEN_KEY = 'bsd-blackbox-open-v2', MAX = 200;
  var page = (location.pathname.split('/').pop() || 'index').slice(0, 60);
  var inst = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  function now(){ return Date.now(); }
  function heapMB(){ try { return performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null; } catch(e){ return null; } }
  function clean(s){
    s = String(s == null ? '' : s);
    s = s.replace(/https?:\/\/[^\s)'"]+/g, function(u){ try { var x = new URL(u); return x.host + x.pathname.split('/').slice(-1)[0]; } catch(e){ return '[url]'; } });
    s = s.replace(/eyJ[\w-]{10,}\.[\w-]+\.[\w-]+/g, '[jwt]').replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]').replace(/\+?\d[\d\s-]{7,}\d/g, '[num]');
    s = s.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '[id]');
    return s.slice(0, 160);
  }
  function read(){ try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch(e){ return []; } }
  function write(list){ try { localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX))); } catch(e){} }
  function log(type, extra){
    try {
      var e = { t: now(), p: page, i: inst, ev: type, vis: document.visibilityState, mb: heapMB() };
      if (extra) for (var k in extra) e[k] = extra[k];
      var list = read(); list.push(e); write(list);
    } catch(err){}
  }
  try {
    // 1) Page instances that were opened but never reached pagehide (killed / force-stopped /
    //    crashed). One slot per instance, so several tabs or a fast redirect don't overwrite
    //    each other. A tab that is still alive elsewhere re-registers itself on its next
    //    heartbeat, so it is reported at most once, as "possible".
    function readOpen(){ try { var o = JSON.parse(localStorage.getItem(OPEN_KEY) || '{}'); return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {}; } catch(e){ return {}; } }
    function writeOpen(o){ try { localStorage.setItem(OPEN_KEY, JSON.stringify(o)); } catch(e){} }
    var open0 = readOpen(), stale = Object.keys(open0);
    stale.forEach(function(k){
      var prev = open0[k] || {};
      log('prev_not_closed', { prevPage: prev.p, prevInst: k, prevLastAlive: prev.alive, prevVis: prev.vis, prevMB: prev.mb });
      delete open0[k];
    });
    writeOpen(open0);
    var nav = null; try { nav = (performance.getEntriesByType('navigation')[0] || {}).type || null; } catch(e){}
    var ua = navigator.userAgent || '', chrome = (ua.match(/Chrome\/(\d+)/) || [])[1] || null;
    log('load', { nav: nav, chrome: chrome, android: /Android/i.test(ua), devMem: navigator.deviceMemory || null,
                  net: (navigator.connection && navigator.connection.effectiveType) || null, online: navigator.onLine });
    var closed = false;
    function markOpen(){ if (closed) return; var o = readOpen(); o[inst] = { p: page, alive: now(), vis: document.visibilityState, mb: heapMB() };
      var ks = Object.keys(o); if (ks.length > 10) ks.sort(function(a,b){ return (o[a].alive||0) - (o[b].alive||0); }).slice(0, ks.length - 10).forEach(function(k){ delete o[k]; });
      writeOpen(o); }
    function clearOpen(){ closed = true; var o = readOpen(); if (o[inst]){ delete o[inst]; writeOpen(o); } }
    markOpen();
    // 2) heartbeat while visible (cheap: one small localStorage write every 30s)
    setInterval(function(){ if (!document.hidden) markOpen(); }, 30000);
    // 3) lifecycle
    document.addEventListener('visibilitychange', function(){ log('visibility'); markOpen(); });
    window.addEventListener('pagehide', function(ev){ log('pagehide', { persisted: !!ev.persisted }); clearOpen(); });
    window.addEventListener('pageshow', function(ev){ if (ev.persisted){ closed = false; log('pageshow_bfcache'); markOpen(); } });
    document.addEventListener('freeze', function(){ log('freeze'); });
    document.addEventListener('resume', function(){ log('resume'); markOpen(); });
    window.addEventListener('online', function(){ log('online'); });
    window.addEventListener('offline', function(){ log('offline'); });
    // 4) errors (message + file:line only)
    window.addEventListener('error', function(e){
      if (e && e.target && e.target !== window && (e.target.src || e.target.href)){
        log('resource_error', { tag: e.target.tagName, src: clean(e.target.src || e.target.href) }); return;
      }
      var file = e && e.filename ? String(e.filename).split('?')[0].split('/').pop() : '';
      log('js_error', { msg: clean(e && (e.message || (e.error && e.error.message))), at: file + ':' + (e && e.lineno || 0) });
    }, true);
    window.addEventListener('unhandledrejection', function(e){
      var r = e && e.reason; log('promise_rejection', { msg: clean(r && (r.message || r.error_description || r.error) || r) });
    });
    // 5) long main-thread tasks (> 200ms) - a frozen page shows up here first
    try {
      if ('PerformanceObserver' in window){
        new PerformanceObserver(function(list){
          list.getEntries().forEach(function(en){ if (en.duration > 200) log('long_task', { ms: Math.round(en.duration) }); });
        }).observe({ type: 'longtask', buffered: true });
      }
    } catch(e){}
    window.bsdBlackBoxLog = function(type, info){ log(String(type).slice(0, 40), info ? { info: clean(info) } : null); };
  } catch(err){ /* diagnostics must never break the CRM */ }
})();
