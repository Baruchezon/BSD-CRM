// BSD CRM - VIP Clients integration
// Loaded only from js/config.js on leads.html and businesses.html.
// This module is intentionally additive: it wraps the existing modal openers
// without replacing existing save logic or fields.
(() => {
  const API = (window.BSD_CONFIG && window.BSD_CONFIG.VIP_API_URL) || 'https://zcdlegcvfirwzitfxjcs.supabase.co/functions/v1/vip-api';
  const page = (location.pathname.split('/').pop() || '').toLowerCase();
  let profileCache = null;

  function esc(value){
    return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function vipAdminHref(returnTo){
    const fallback = (location.pathname.split('/').pop() || 'app.html') + location.search;
    return 'vip-admin.html?return=' + encodeURIComponent(returnTo || fallback);
  }

  function toast(message, isError){
    if (typeof window.showToast === 'function') {
      try { window.showToast(message, !!isError); return; } catch(e){}
    }
    const el = document.createElement('div');
    el.textContent = message;
    el.style.cssText = `position:fixed;left:24px;bottom:24px;z-index:9999;background:${isError?'#9f2d2d':'#0e1b34'};color:#fff;padding:12px 18px;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.25);font-family:Heebo,Arial,sans-serif;`;
    document.body.appendChild(el);
    setTimeout(()=>el.remove(), isError ? 5500 : 3000);
  }

  async function getProfile(){
    if (profileCache) return profileCache;
    if (!window.supabaseClient) return null;
    const { data:{ session } } = await window.supabaseClient.auth.getSession();
    if (!session) return null;
    const { data } = await window.supabaseClient.from('profiles').select('id,full_name,role,status').eq('id', session.user.id).maybeSingle();
    profileCache = data || null;
    return profileCache;
  }

  async function adminApi(action, payload={}){
    const { data:{ session } } = await window.supabaseClient.auth.getSession();
    if (!session?.access_token) throw new Error('ההתחברות למערכת פגה');
    const response = await fetch(API, {
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+session.access_token},
      body:JSON.stringify({ action, ...payload })
    });
    let data={};
    try { data=await response.json(); } catch(e){}
    if(!response.ok || data.ok===false) throw new Error(data.message || data.error || 'שגיאה במודול VIP');
    return data;
  }

  // מאפשר למסך העסקים לטעון את סטטוסי הפרסום ללקוחות VIP בקריאה מרוכזת
  // אחת. הטוקן והרשאות המנהל נשארים בתוך אותו מנגנון מאובטח של המודול.
  window.BSDVIPAdminApi = adminApi;
  window.dispatchEvent(new CustomEvent('bsd:vip-ready'));

  function vipBox(title, body, returnTo){
    return `<section data-vip-crm-box style="grid-column:1/3;margin-top:16px;border:2px solid #d5b85c;border-radius:12px;background:linear-gradient(180deg,#fffdf6,#fff);padding:16px;box-shadow:0 4px 14px rgba(14,27,52,.07);">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;">
        <strong style="color:#0e1b34;font-size:1rem;">⭐ ${esc(title)}</strong>
        <a href="${vipAdminHref(returnTo)}" style="font-size:.78rem;color:#0e1b34;font-weight:700;">ניהול לקוחות VIP</a>
      </div>${body}</section>`;
  }

  function isMobileBusinessCard(){
    return !!(window.matchMedia && window.matchMedia('(max-width: 640px)').matches);
  }

  // בדסקטופ תיבת הסימון נשארת בתוך שורת סטטוס ההסכם הקיימת.
  // במובייל היא עוברת לשורה עצמאית בראש כרטיס העסק כדי שלא תיעלם בתוך הכותרת הצפופה.
  function businessVipTarget(modal){
    const stickyTop=modal.querySelector('.biz-sticky-top');
    if(isMobileBusinessCard() && stickyTop) return stickyTop;
    const notes=[...modal.querySelectorAll('.biz-sticky-top .agr-note:not(.agr-upload-row)')];
    return notes.find(note=>note.textContent.includes('סטטוס הסכם נוכחי'))
      || stickyTop
      || modal.querySelector('.biz-tabpane[data-tab="summaries"]')
      || modal.querySelector('.biz-tabpanes .biz-tabpane')
      || modal.querySelector('#bizForm .form-grid')
      || modal.querySelector('#bizForm')
      || modal;
  }

  function businessVipBox(body){
    if(isMobileBusinessCard()){
      return `<span data-vip-crm-box class="biz-vip-inline biz-vip-mobile" style="order:2;display:flex;flex:1 1 100%;width:100%;margin:2px 0 1px;padding:8px 10px;border:1px solid #d5b85c;border-radius:9px;background:#fff8dc;box-shadow:0 2px 7px rgba(14,27,52,.12);box-sizing:border-box;">${body}</span>`;
    }
    return `<span data-vip-crm-box class="biz-vip-inline">${body}</span>`;
  }

  function addAdminShortcut(){
    if (document.querySelector('[data-vip-admin-shortcut]')) return;
    const toolbar = document.querySelector('.toolbar .add-btns') || document.querySelector('.toolbar');
    if (!toolbar) return;
    const a=document.createElement('a');
    a.href=vipAdminHref();
    a.dataset.vipAdminShortcut='1';
    a.textContent='⭐ לקוחות VIP';
    a.style.cssText='display:inline-flex;align-items:center;text-decoration:none;background:#d5b85c;color:#172033;border-radius:8px;padding:10px 16px;font-size:.85rem;font-weight:800;';
    toolbar.appendChild(a);
  }

  async function renderBuyerVip(lead){
    const modal=document.getElementById('modalBox');
    if(!modal || !lead || lead.type!=='buyer') return;
    const profile=await getProfile();
    if(!profile || !['admin','manager'].includes(profile.role)) return;
    modal.querySelectorAll('[data-vip-crm-box]').forEach(x=>x.remove());

    let account=null;
    try {
      const list=await adminApi('admin_list');
      account=(list.accounts||[]).find(a=>a.buyer_id===lead.id) || null;
    } catch(e){
      modal.insertAdjacentHTML('beforeend',vipBox('גישת לקוח VIP',`<div style="color:#a72a2a;font-size:.85rem;">לא ניתן לטעון כרגע את סטטוס VIP: ${esc(e.message)}</div>`,`leads.html?open=${encodeURIComponent(lead.id)}`));
      return;
    }

    const eligible=['נשלח הסכם לחתימה','יש הסכם חתום'].includes(lead.agreement_status) || lead.agreement_sent || lead.agreement_signed;
    const active=account && account.status==='active';
    const blocked=account && account.status==='blocked';
    const statusText=active ? 'פעיל' : blocked ? 'חסום' : 'לא הופעל';
    const statusColor=active ? '#217a4d' : blocked ? '#a72a2a' : '#6f7787';
    // 05.10.2026 (בקשת ברוך): סימון VIP בטעות חייב להיות הפיך. קודם התיבה ננעלה
    // ברגע שנוצר חשבון (disabled כש-account קיים) והאירוע טיפל רק בסימון, כך
    // שאי אפשר היה לבטל. עכשיו: הפעלה עדיין מותרת רק אחרי שנשלח/נחתם הסכם
    // (אותו כלל גם בשרת), אבל ביטול מותר תמיד - הסרת הסימון מבטלת את החשבון
    // (admin_account_action 'delete': מחיקה רכה + ניתוק כל הכניסות). אפשר
    // להפעיל שוב בכל עת (נוצרת סיסמה זמנית חדשה).
    const disabled=(!eligible && !account) ? 'disabled' : '';
    const checked=account ? 'checked' : '';
    const reason=(!eligible && !account) ? '<div style="margin-top:8px;color:#9a6514;font-size:.8rem;">ניתן לפתוח גישת VIP רק לאחר שנשלח הסכם לקונה.</div>' : '';

    modal.insertAdjacentHTML('beforeend',vipBox('גישת לקוח VIP',`
      <div style="display:flex;flex-wrap:wrap;gap:14px;align-items:center;justify-content:space-between;">
        <label style="display:flex;align-items:center;gap:9px;font-weight:800;color:#23304a;cursor:${disabled?'not-allowed':'pointer'};" title="${account ? 'הסרת הסימון מבטלת את גישת ה-VIP של הלקוח' : ''}">
          <input id="vipEnableBuyer" type="checkbox" ${checked} ${disabled} style="width:20px;height:20px;accent-color:#d5b85c;"> אפשר גישת VIP
        </label>
        <span id="vipBuyerStatus" style="font-weight:800;color:${statusColor};">סטטוס: ${statusText}</span>
      </div>
      <div id="vipBuyerAccountLine">${account ? `<div style="margin-top:10px;font-size:.85rem;"><b>שם משתמש:</b> ${esc(account.username)}</div><div style="margin-top:4px;font-size:.75rem;color:#6f7787;">סומן בטעות? הסר את הסימון כדי לבטל את גישת ה-VIP.</div>` : ''}</div>
      ${reason}
      <div id="vipBuyerCredentials" style="margin-top:10px;"></div>
    `,`leads.html?open=${encodeURIComponent(lead.id)}`));

    const checkbox=document.getElementById('vipEnableBuyer');
    if(!checkbox || checkbox.disabled) return;
    let current=account; // החשבון הנוכחי (מתעדכן גם מיד אחרי יצירה, כדי שאפשר יהיה לבטל מיד)
    const setStatus=(text,color)=>{ const el=document.getElementById('vipBuyerStatus'); if(el){ el.textContent='סטטוס: '+text; el.style.color=color; } };

    async function enable(){
      checkbox.disabled=true;
      try{
        const result=await adminApi('admin_enable_buyer',{buyer_id:lead.id});
        if(result.already_exists){ current=result.account || current; toast('ללקוח כבר קיים חשבון VIP'); return; }
        current=result.account || null;
        const username=result.account?.username || '';
        const pwd=result.temporary_password || '';
        const phone=(result.buyer?.phone || lead.phone || '').replace(/\D/g,'');
        const name=result.buyer?.name || lead.full_name || '';
        const site='https://www.bsd-bbi.co.il/vip/';
        const message=`שלום ${name},\n\nברוך הבא לאזור לקוחות VIP של BSD.\nהמערכת מתעדכנת באופן שוטף בעסקים חדשים והזדמנויות עסקיות אנונימיות.\n\nכניסה: ${site}\nשם משתמש: ${username}\nסיסמה זמנית: ${pwd}\n\nבכניסה ניתן לשנות את הסיסמה. אם שכחת את הסיסמה, פנה ל BSD.`;
        const waPhone=phone.startsWith('0') ? '972'+phone.slice(1) : phone;
        const target=document.getElementById('vipBuyerCredentials');
        if(target) target.innerHTML=`<div style="background:#f7f2df;border:1px solid #e1cc87;border-radius:10px;padding:12px;line-height:1.7;">
          <div><b>שם משתמש:</b> ${esc(username)}</div><div><b>סיסמה זמנית:</b> <span style="font-family:monospace;font-size:1rem;">${esc(pwd)}</span></div>
          <div style="font-size:.75rem;color:#755f23;margin-top:4px;">הסיסמה מוצגת כעת לצורך השליחה. היא אינה נשמרת כטקסט גלוי.</div>
          ${waPhone ? `<a href="https://wa.me/${esc(waPhone)}?text=${encodeURIComponent(message)}" target="_blank" rel="noopener" style="display:inline-block;margin-top:9px;background:#1f9d55;color:#fff;text-decoration:none;border-radius:8px;padding:8px 13px;font-weight:800;">שלח פרטי כניסה ב WhatsApp</a>` : ''}
          <div style="font-size:.75rem;color:#6f7787;margin-top:6px;">סומן בטעות? הסר את הסימון כדי לבטל מיד.</div>
        </div>`;
        setStatus('פעיל','#217a4d');
        toast('חשבון VIP נוצר בהצלחה');
      }catch(e){
        checkbox.checked=false; toast(e.message,true);
      }finally{
        checkbox.disabled=false;
      }
    }

    async function disable(){
      if(!current || !current.id){ checkbox.checked=false; return; }
      const name=lead.full_name || 'הלקוח';
      const ok=window.confirm(`לבטל את גישת ה-VIP של ${name}?\n\nשם המשתמש ${current.username || ''} יבוטל וכל הכניסות הפעילות ינותקו.\nאפשר להפעיל שוב בכל עת (תיווצר סיסמה זמנית חדשה).`);
      if(!ok){ checkbox.checked=true; return; }
      checkbox.disabled=true;
      try{
        await adminApi('admin_account_action',{account_id:current.id,account_action:'delete'});
        current=null;
        const creds=document.getElementById('vipBuyerCredentials'); if(creds) creds.innerHTML='';
        const line=document.getElementById('vipBuyerAccountLine'); if(line) line.innerHTML='';
        setStatus('לא הופעל','#6f7787');
        toast('גישת ה-VIP בוטלה');
      }catch(e){
        checkbox.checked=true; toast(e.message,true);
      }finally{
        // אחרי ביטול: הפעלה מחדש שוב רק אם נשלח/נחתם הסכם.
        checkbox.disabled=!current && !eligible;
        if(checkbox.parentElement) checkbox.parentElement.style.cursor=checkbox.disabled?'not-allowed':'pointer';
      }
    }

    checkbox.addEventListener('change',()=>{ if(checkbox.checked) enable(); else disable(); });
  }

  // ---------------------------------------------------------------------------
  // 05.10.2026 (בקשת ברוך): תיבת «פרסום ללקוחות VIP» בכרטיס עסק.
  // הכלל בשרת (vip-api) לא השתנה: אפשר לפרסם רק אם בתיק המכירה של העסק יש
  // קובץ פעיל מסוג «תקציר אנונימי» ברמת סודיות 1 (ה-PDF של התקציר האנונימי).
  // מה שהשתנה הוא התצוגה בלבד:
  //  1. כשהתיבה נעולה מוצגת תמיד שורה קצרה שאומרת בדיוק מה חסר (ולא רק
  //     tooltip שבטאבלט/טלפון לא רואים בכלל).
  //  2. כפתור «⭐ הכן ל-VIP» שמריץ את אותה הפקת PDF קיימת («📄 הפק PDF אנונימי»)
  //     מתוך התקציר האנונימי השמור, ואז בודק שוב ופותח את התיבה. הפרסום עצמו
  //     נשאר בסימון ידני של התיבה - שום דבר לא מתפרסם אוטומטית.
  //  3. אחרי כל שינוי בתיק המכירה (הפקה/העלאה/מחיקה) הסטטוס נבדק מחדש, כך
  //     שאין צורך לסגור ולפתוח את הכרטיס.
  // ---------------------------------------------------------------------------
  const VIP_MSG_LOADING='טוען סטטוס פרסום';
  const VIP_MSG_LOAD_FAILED='לא ניתן לטעון כרגע את סטטוס הפרסום';
  const VIP_MSG_NO_SUMMARY='חסר תקציר אנונימי שמור (וגם PDF שלו)';
  const VIP_MSG_NO_PDF='חסר PDF של התקציר האנונימי בתיק המכירה';
  const VIP_MSG_STALE='ה-PDF ישן מהתקציר';
  const VIP_MSG_VIP_ON_OLDER='ב-VIP מוצג PDF ישן';
  const VIP_MSG_UNKNOWN='לא ידוע אם ה-PDF תואם לתקציר';
  const VIP_MSG_OLDER_VERSIONS='בתיק המכירה יש גם גרסאות PDF ישנות';
  const VIP_FIX_TITLE='מפיק PDF חדש מהתקציר השמור (אם צריך), ה-VIP - רק אם העסק כבר מפורסם - יציג את החדש, והגרסאות הישנות יוסרו מתיק המכירה. עסק שלא ב-VIP לא יפורסם.';
  let businessVipState=null; // { bizId, files, publication, chosen, busy }
  let businessVipRefreshTimer=null;

  function currentBiz(bizId, fallback){
    try { return (typeof ALL_BIZ!=='undefined' && ALL_BIZ.find(x=>x.id===bizId)) || fallback || null; }
    catch(e){ return fallback || null; }
  }
  function normText(v){ return String(v ?? '').replace(/\r\n?/g,'\n').trim(); }
  function vipBoxEl(){ return document.querySelector('[data-vip-crm-box][data-vip-biz]'); }
  function setVipHint(html){
    const hint=document.getElementById('vipPrepHint');
    if(hint) hint.innerHTML=html || '';
  }
  function goToAnonSummary(){
    if(typeof window.bsdGoToAnonSummary==='function'){ try{ window.bsdGoToAnonSummary(); return; }catch(e){} }
    if(typeof window.bsdActivateBizTab==='function'){ try{ window.bsdActivateBizTab('summaries'); }catch(e){} }
  }

  // 05.10.2026 (כלל ברוך): ב-VIP תמיד רק הגרסה האחרונה של ה-PDF האנונימי.
  // ה-PDF נחשב "ישן" אם נבנה מטקסט שונה מהתקציר השמור כרגע (ראו
  // window.BSDAnonPdf ב-businesses.html). PDF ישן לא ניתן לפרסום חדש, ומוצג
  // כפתור שמעדכן אותו (PDF חדש, ה-VIP - אם כבר מפורסם - מצביע עליו, והישן מוסר).
  async function vipPdfFreshness(biz, files, publication){
    const out={ fresh:true, vipOnOlder:false, older:files.length>1 };
    if(!files.length) return out;
    const enabled=!!publication?.enabled;
    out.vipOnOlder=enabled && publication.anonymous_file_id!==files[0].id;
    const A=window.BSDAnonPdf;
    if(!A) return out;
    try{
      const b=currentBiz(biz.id,biz) || biz;
      const hash=await A.hash(b);
      const tagged=A.TAG_RE.test(String(files[0].storage_path||''));
      const changedAt=tagged ? null : await A.changedAt(b);
      out.fresh=A.freshness(files[0],hash,changedAt);
    }catch(e){ out.fresh=true; }
    return out;
  }

  async function applyBusinessVipStatus(biz, status){
    const checkbox=document.getElementById('vipPublishBusiness');
    const box=vipBoxEl();
    if(!checkbox || !box || box.dataset.vipBiz!==biz.id) return;
    const files=(status.eligible_files || []).slice().sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')));
    const publication=status.publication || null;
    const enabled=!!publication?.enabled;
    const noFiles=!files.length;
    const pdf=await vipPdfFreshness(biz, files, publication);
    if(document.getElementById('vipPublishBusiness')!==checkbox) return; // הכרטיס נבנה מחדש בינתיים
    const stale=!noFiles && pdf.fresh===false;
    // פרסום חדש תמיד עם הגרסה האחרונה בלבד; PDF ישן לא ניתן לפרסום חדש (אפשר רק להסיר).
    const lockPublish=noFiles || (stale && !enabled);
    businessVipState={ bizId:biz.id, files, publication, chosen:files[0]?.id || '', busy:false, lockPublish };
    checkbox.checked=enabled;
    checkbox.disabled=lockPublish;
    const label=checkbox.parentElement;
    const hasSummary=!!normText(currentBiz(biz.id,biz)?.anon_summary);
    const reason=!noFiles ? '' : (hasSummary ? VIP_MSG_NO_PDF : VIP_MSG_NO_SUMMARY);
    if(label){
      label.classList.toggle('is-disabled',lockPublish);
      label.title=noFiles ? ('🔒 '+reason+'. לחץ «⭐ הכן ל-VIP».')
        : stale ? '🔒 '+VIP_MSG_STALE+'. לחץ «🔄 עדכן ל-PDF האחרון».'
        : 'הצגה באזור לקוחות VIP';
    }
    if(noFiles){
      setVipHint(`<span class="biz-vip-why">🔒 ${esc(reason)}</span>
        <button type="button" class="biz-vip-prep" id="vipPrepBtn" title="מפיק PDF מהתקציר האנונימי השמור ושומר אותו בתיק המכירה. הפרסום עצמו נשאר בסימון ידני.">⭐ הכן ל-VIP</button>
        <span id="vipPrepStatus" class="biz-vip-status"></span>`);
      const btn=document.getElementById('vipPrepBtn');
      if(btn) btn.addEventListener('click',()=>prepareBusinessForVip(biz));
      return;
    }
    let why='';
    if(stale) why='⚠️ '+VIP_MSG_STALE;
    else if(pdf.vipOnOlder) why='⚠️ '+VIP_MSG_VIP_ON_OLDER;
    else if(pdf.fresh===null) why='ℹ️ '+VIP_MSG_UNKNOWN;
    else if(pdf.older) why='ℹ️ '+VIP_MSG_OLDER_VERSIONS;
    if(!why){ setVipHint(''); return; }
    const btnText=pdf.fresh===true && !pdf.vipOnOlder ? '🧹 השאר רק את האחרון' : '🔄 עדכן ל-PDF האחרון';
    setVipHint(`<span class="biz-vip-why">${esc(why)}</span>
      <button type="button" class="biz-vip-prep" id="vipFixPdfBtn" title="${esc(VIP_FIX_TITLE)}">${esc(btnText)}</button>
      <span id="vipPrepStatus" class="biz-vip-status"></span>`);
    const fix=document.getElementById('vipFixPdfBtn');
    if(fix) fix.addEventListener('click',()=>fixBusinessVipPdf(biz, pdf.fresh===null));
  }

  // בודק שיש תקציר שמור ושאין בו שינויים שלא נשמרו (ה-PDF נבנה רק מהנוסח השמור).
  function savedSummaryReady(biz){
    const fresh=currentBiz(biz.id,biz) || biz;
    const saved=normText(fresh.anon_summary);
    const textarea=document.getElementById('anon_summary');
    if(!saved){
      goToAnonSummary();
      toast('חסר תקציר אנונימי שמור. כתוב או צור אותו (AI), לחץ «💾 שמור תקציר אנונימי» ואז נסה שוב.',true);
      return false;
    }
    if(textarea && normText(textarea.value)!==saved){
      goToAnonSummary();
      toast('יש בתקציר האנונימי שינויים שלא נשמרו. ה-PDF נבנה רק מהנוסח השמור - לחץ «💾 שמור תקציר אנונימי» (ה-PDF יתעדכן אוטומטית).',true);
      return false;
    }
    return true;
  }

  async function fixBusinessVipPdf(biz, forceNew){
    if(!savedSummaryReady(biz)) return;
    if(!window.BSDAnonPdf || typeof window.BSDAnonPdf.sync!=='function'){
      toast('עדכון ה-PDF אינו זמין כרגע במסך הזה. רענן את הדף ונסה שוב.',true);
      return;
    }
    const btn=document.getElementById('vipFixPdfBtn');
    if(btn) btn.disabled=true;
    if(businessVipState) businessVipState.busy=true;
    const statusEl=()=>document.getElementById('vipPrepStatus');
    let res=null;
    try{
      res=await window.BSDAnonPdf.sync(biz.id,{ mode: forceNew ? 'generate' : 'fix', onStatus:t=>{ const el=statusEl(); if(el) el.textContent=t; } });
    }catch(e){
      res={ ok:false, message:(e && e.message) || String(e) };
    }finally{
      if(businessVipState) businessVipState.busy=false;
    }
    if(res && (res.ok || res.generated)){
      if(typeof window.BSDAnonPdf.report==='function') window.BSDAnonPdf.report(biz.id,res);
      else toast('✓ '+(window.BSDAnonPdf.summary?.(res) || 'עודכן'));
    } else {
      const msg=(res && (res.message || res.reason)) || 'העדכון נכשל';
      toast('⚠️ '+msg,true);
      const el=statusEl(); if(el) el.textContent='❌ '+msg;
      if(btn) btn.disabled=false;
    }
    await refreshBusinessVip(biz);
  }

  async function refreshBusinessVip(biz){
    const box=vipBoxEl();
    if(!box || box.dataset.vipBiz!==biz.id) return;
    let status;
    try { status=await adminApi('admin_business_status',{business_id:biz.id}); }
    catch(e){
      const checkbox=document.getElementById('vipPublishBusiness');
      if(checkbox){ checkbox.disabled=true; if(checkbox.parentElement){ checkbox.parentElement.classList.add('is-disabled'); checkbox.parentElement.title=VIP_MSG_LOAD_FAILED; } }
      setVipHint(`<span class="biz-vip-why">⚠️ ${esc(VIP_MSG_LOAD_FAILED)}</span> <button type="button" class="biz-vip-prep" id="vipRetryBtn">נסה שוב</button>`);
      const retry=document.getElementById('vipRetryBtn');
      if(retry) retry.addEventListener('click',()=>refreshBusinessVip(biz));
      return;
    }
    await applyBusinessVipStatus(biz, status);
  }

  function scheduleBusinessVipRefresh(bizId){
    const box=vipBoxEl();
    if(!box || box.dataset.vipBiz!==bizId || businessVipState?.busy) return;
    clearTimeout(businessVipRefreshTimer);
    businessVipRefreshTimer=setTimeout(()=>{
      const biz=currentBiz(bizId,{ id:bizId });
      if(biz) refreshBusinessVip(biz);
    },400);
  }

  async function prepareBusinessForVip(biz){
    if(!savedSummaryReady(biz)) return;
    if(typeof window.sfCanUpload==='function' && !window.sfCanUpload()){
      toast('אין לך הרשאה להפיק קבצים לתיק המכירה',true);
      return;
    }
    if(typeof window.generateAndSaveSummaryPdf!=='function'){
      toast('הפקת PDF אינה זמינה כרגע במסך הזה. רענן את הדף ונסה שוב.',true);
      return;
    }
    const btn=document.getElementById('vipPrepBtn');
    if(btn) btn.disabled=true;
    if(businessVipState) businessVipState.busy=true;
    const statusEl=document.getElementById('vipPrepStatus');
    if(statusEl) statusEl.textContent='📄 מפיק PDF...';
    try{
      // אותה פונקציה בדיוק של הכפתור «📄 הפק PDF אנונימי» - כולל בדיקת המזהים.
      await window.generateAndSaveSummaryPdf(biz.id,'anonymous_summary','vipPrepStatus');
    }finally{
      if(businessVipState) businessVipState.busy=false;
    }
    const failText=(document.getElementById('vipPrepStatus')?.textContent || '');
    await refreshBusinessVip(biz);
    const checkbox=document.getElementById('vipPublishBusiness');
    if(checkbox && !checkbox.disabled){
      toast('✓ העסק מוכן ל-VIP. כדי לפרסם - סמן את התיבה «פרסום ללקוחות VIP».');
      try { checkbox.focus({ preventScroll:true }); } catch(e){}
    } else if(/^[❌⚠]/.test(failText)){
      const st=document.getElementById('vipPrepStatus');
      if(st) st.textContent=failText;
    }
  }

  async function renderBusinessVip(biz){
    const modal=document.getElementById('modalBox');
    if(!modal || !biz) return;
    const profile=await getProfile();
    if(!profile || !['admin','manager'].includes(profile.role)) return;
    modal.querySelectorAll('[data-vip-crm-box]').forEach(x=>x.remove());
    businessVipState=null;
    const target=businessVipTarget(modal);
    target.dataset.vipReturn=`businesses.html?open=${encodeURIComponent(biz.id)}`;

    // מוכנס מיד כדי שהשליטה תהיה גלויה גם בזמן טעינת סטטוס הפרסום מהשרת.
    target.insertAdjacentHTML('beforeend',businessVipBox(`
      <label title="${VIP_MSG_LOADING}"><input id="vipPublishBusiness" type="checkbox" disabled> פרסום ללקוחות VIP</label>
      <span id="vipPrepHint" class="biz-vip-hint"></span>
    `));
    const box=vipBoxEl() || modal.querySelector('[data-vip-crm-box]');
    if(box) box.dataset.vipBiz=biz.id;
    const checkbox=document.getElementById('vipPublishBusiness');
    if(!checkbox) return;

    async function save(){
      const state=businessVipState;
      if(!state || state.bizId!==biz.id || !state.files.length || (state.lockPublish && checkbox.checked)){ checkbox.checked=!checkbox.checked; return; }
      checkbox.disabled=true;
      try{
        await adminApi('admin_publish_business',{business_id:biz.id,enabled:checkbox.checked,anonymous_file_id:state.chosen});
        window.dispatchEvent(new CustomEvent('bsd:vip-publication-changed',{
          detail:{ businessId:biz.id, enabled:checkbox.checked }
        }));
        toast(checkbox.checked ? 'העסק פורסם ללקוחות VIP' : 'העסק הוסר מאזור VIP');
      }catch(e){
        checkbox.checked=!checkbox.checked; toast(e.message,true);
      }finally{
        // אחרי הסרה מ-VIP של PDF ישן - התיבה ננעלת שוב עד שה-PDF יעודכן.
        await refreshBusinessVip(biz);
      }
    }
    checkbox.addEventListener('change',save);
    await refreshBusinessVip(biz);
  }

  window.BSDVIPRefreshBusiness=bizId=>scheduleBusinessVipRefresh(bizId);

  // כל טעינה מחדש של תיק המכירה (אחרי הפקה/העלאה/מחיקה של קובץ) בודקת שוב
  // את סטטוס ה-VIP של הכרטיס הפתוח. קריאה בלבד - לא משנה את הפונקציה המקורית.
  function installSaleFileRefreshHook(){
    if(typeof window.loadSaleFileModule!=='function') return false;
    if(window.loadSaleFileModule.__vipHooked) return true;
    const original=window.loadSaleFileModule;
    const wrapped=async function(bizId){
      const result=await original.apply(this,arguments);
      try{ scheduleBusinessVipRefresh(bizId); }catch(e){}
      return result;
    };
    wrapped.__vipHooked=true;
    window.loadSaleFileModule=wrapped;
    return true;
  }

  function installLeadWrapper(){
    if(page!=='leads.html' || typeof window.openLeadForm!=='function' || window.openLeadForm.__vipWrapped) return false;
    const original=window.openLeadForm;
    window.openLeadForm=function(id,forcedType,prefillData){
      const result=original.apply(this,arguments);
      setTimeout(()=>{
        try{
          const lead=(typeof ALL_LEADS!=='undefined' && id) ? ALL_LEADS.find(x=>x.id===id) : null;
          if(lead) renderBuyerVip(lead);
        }catch(e){ console.warn('[BSD VIP] buyer integration',e); }
      },0);
      return result;
    };
    window.openLeadForm.__vipWrapped=true;
    addAdminShortcut();
    return true;
  }

  function installBusinessWrapper(){
    if(page!=='businesses.html' || typeof window.openBizForm!=='function' || window.openBizForm.__vipWrapped) return false;
    const original=window.openBizForm;
    window.openBizForm=function(id){
      const result=original.apply(this,arguments);
      setTimeout(()=>{
        try{
          const biz=(typeof ALL_BIZ!=='undefined' && id) ? ALL_BIZ.find(x=>x.id===id) : null;
          installSaleFileRefreshHook();
          if(biz) renderBusinessVip(biz);
        }catch(e){ console.warn('[BSD VIP] business integration',e); }
      },0);
      return result;
    };
    window.openBizForm.__vipWrapped=true;
    installSaleFileRefreshHook();
    return true;
  }

  let attempts=0;
  const timer=setInterval(()=>{
    attempts++;
    const done=page==='leads.html' ? installLeadWrapper() : page==='businesses.html' ? installBusinessWrapper() : true;
    if(done || attempts>200) clearInterval(timer);
  },50);
})();