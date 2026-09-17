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

  function vipBox(title, body, returnTo){
    return `<section data-vip-crm-box style="grid-column:1/3;margin-top:16px;border:2px solid #d5b85c;border-radius:12px;background:linear-gradient(180deg,#fffdf6,#fff);padding:16px;box-shadow:0 4px 14px rgba(14,27,52,.07);">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;">
        <strong style="color:#0e1b34;font-size:1rem;">⭐ ${esc(title)}</strong>
        <a href="${vipAdminHref(returnTo)}" style="font-size:.78rem;color:#0e1b34;font-weight:700;">ניהול לקוחות VIP</a>
      </div>${body}</section>`;
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
    const disabled=(!eligible || !!account) ? 'disabled' : '';
    const checked=account ? 'checked' : '';
    const reason=!eligible ? '<div style="margin-top:8px;color:#9a6514;font-size:.8rem;">ניתן לפתוח גישת VIP רק לאחר שנשלח הסכם לקונה.</div>' : '';

    modal.insertAdjacentHTML('beforeend',vipBox('גישת לקוח VIP',`
      <div style="display:flex;flex-wrap:wrap;gap:14px;align-items:center;justify-content:space-between;">
        <label style="display:flex;align-items:center;gap:9px;font-weight:800;color:#23304a;cursor:${disabled?'not-allowed':'pointer'};">
          <input id="vipEnableBuyer" type="checkbox" ${checked} ${disabled} style="width:20px;height:20px;accent-color:#d5b85c;"> אפשר גישת VIP
        </label>
        <span style="font-weight:800;color:${statusColor};">סטטוס: ${statusText}</span>
      </div>
      ${account ? `<div style="margin-top:10px;font-size:.85rem;"><b>שם משתמש:</b> ${esc(account.username)}</div>` : ''}
      ${reason}
      <div id="vipBuyerCredentials" style="margin-top:10px;"></div>
    `,`leads.html?open=${encodeURIComponent(lead.id)}`));

    const checkbox=document.getElementById('vipEnableBuyer');
    if(checkbox && !checkbox.disabled){
      checkbox.addEventListener('change',async()=>{
        if(!checkbox.checked) return;
        checkbox.disabled=true;
        try{
          const result=await adminApi('admin_enable_buyer',{buyer_id:lead.id});
          if(result.already_exists){ toast('ללקוח כבר קיים חשבון VIP'); return; }
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
          </div>`;
          toast('חשבון VIP נוצר בהצלחה');
        }catch(e){
          checkbox.checked=false; checkbox.disabled=false; toast(e.message,true);
        }
      });
    }
  }

  async function renderBusinessVip(biz){
    const modal=document.getElementById('modalBox');
    if(!modal || !biz) return;
    const profile=await getProfile();
    if(!profile || !['admin','manager'].includes(profile.role)) return;
    modal.querySelectorAll('[data-vip-crm-box]').forEach(x=>x.remove());

    let status;
    try { status=await adminApi('admin_business_status',{business_id:biz.id}); }
    catch(e){
      modal.insertAdjacentHTML('beforeend',vipBox('פרסום ללקוחות VIP',`<div style="color:#a72a2a;font-size:.85rem;">לא ניתן לטעון סטטוס פרסום: ${esc(e.message)}</div>`,`businesses.html?open=${encodeURIComponent(biz.id)}`));
      return;
    }
    const files=status.eligible_files || [];
    const publication=status.publication || null;
    const enabled=!!publication?.enabled;
    const chosen=publication?.anonymous_file_id || files[0]?.id || '';
    const noFiles=!files.length;
    const options=files.map(f=>`<option value="${esc(f.id)}" ${f.id===chosen?'selected':''}>${esc(f.file_name || 'תקציר אנונימי')} ${f.version_number?`גרסה ${esc(f.version_number)}`:''}</option>`).join('');

    modal.insertAdjacentHTML('beforeend',vipBox('פרסום ללקוחות VIP',`
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
        <label style="display:flex;align-items:center;gap:8px;font-weight:800;${noFiles?'opacity:.55':''}">
          <input id="vipPublishBusiness" type="checkbox" ${enabled?'checked':''} ${noFiles?'disabled':''} style="width:20px;height:20px;accent-color:#d5b85c;"> פרסם ללקוחות VIP
        </label>
      </div>
      <div style="margin-top:10px;">
        <label style="display:block;font-size:.78rem;color:#666;margin-bottom:4px;">קובץ אנונימי מאושר</label>
        <select id="vipAnonymousFile" ${noFiles?'disabled':''} style="width:100%;padding:9px 11px;border:1px solid #d8d3c4;border-radius:8px;font-family:inherit;">${options || '<option>אין תקציר אנונימי מאושר</option>'}</select>
      </div>
      <div style="margin-top:8px;font-size:.76rem;color:${noFiles?'#a72a2a':'#6f7787'};line-height:1.5;">
        ${noFiles ? 'הפרסום חסום. יש ליצור או להעלות קובץ שמוגדר anonymous_summary ברמת סודיות 1.' : 'המערכת מאפשרת פרסום רק של קובץ anonymous_summary פעיל ברמת סודיות 1. קבצים פנימיים וחסויים חסומים גם בצד השרת.'}
      </div>
    `,`businesses.html?open=${encodeURIComponent(biz.id)}`));

    const checkbox=document.getElementById('vipPublishBusiness');
    const select=document.getElementById('vipAnonymousFile');
    async function save(){
      if(!checkbox || !select) return;
      checkbox.disabled=true; select.disabled=true;
      try{
        await adminApi('admin_publish_business',{business_id:biz.id,enabled:checkbox.checked,anonymous_file_id:select.value});
        toast(checkbox.checked ? 'העסק פורסם ללקוחות VIP' : 'העסק הוסר מאזור VIP');
      }catch(e){
        checkbox.checked=!checkbox.checked; toast(e.message,true);
      }finally{ checkbox.disabled=noFiles; select.disabled=noFiles; }
    }
    checkbox?.addEventListener('change',save);
    select?.addEventListener('change',()=>{ if(checkbox?.checked) save(); });
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
          if(biz) renderBusinessVip(biz);
        }catch(e){ console.warn('[BSD VIP] business integration',e); }
      },0);
      return result;
    };
    window.openBizForm.__vipWrapped=true;
    return true;
  }

  let attempts=0;
  const timer=setInterval(()=>{
    attempts++;
    const done=page==='leads.html' ? installLeadWrapper() : page==='businesses.html' ? installBusinessWrapper() : true;
    if(done || attempts>200) clearInterval(timer);
  },50);
})();
