// Seller portal controls inside the CRM business card (admin/manager only; the
// API enforces the same rule). v2 (04.10.2026): checking "פתח חשבון בפורטל"
// opens the account in one click: the server creates a username and a random
// password, and a ready WhatsApp message opens for BSD to send. Nothing is ever
// sent automatically.
(()=>{'use strict';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const when=v=>v?new Date(v).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}):'';
const ERRORS={signed_agreement_required:'נדרש עסק פעיל עם הסכם חתום',account_required:'אין חשבון פורטל לעסק זה'};
async function api(action,payload={}){
 const url=window.BSD_CONFIG.SELLER_PORTAL_API_URL;if(!url)throw Error('שירות הפורטל טרם הופעל. פרטי העסק נשמרים כרגיל');
 const {data:{session}}=await window.supabaseClient.auth.getSession();if(!session)throw Error('יש להתחבר למערכת');
 const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.access_token},body:JSON.stringify({action,...payload})});const d=await r.json().catch(()=>({}));
 if(!r.ok)throw Error(ERRORS[d.error]||'פעולת הפורטל לא הושלמה');return d;
}
const invite=()=>window.BSDPortalInvite;
function credentialsHtml(d){
 const text=invite().message(d),wa=invite().waUrl(d);
 return `<div data-portal-new style="margin:10px 0;padding:12px;border:1px solid #c9a854;border-radius:10px;background:#fff">
 <p style="margin:0 0 6px"><b>החשבון מוכן.</b> שם משתמש: <b dir="ltr">${esc(d.username)}</b> · סיסמה: <b dir="ltr">${esc(d.password)}</b></p>
 <p style="margin:0 0 6px;font-size:.85rem">הסיסמה מוצגת עכשיו בלבד ונשמרת בשרת בצורה מוצפנת. ההודעה נפתחת ב-WhatsApp לשליחה על ידך.</p>
 <textarea data-portal-invite rows="9" readonly style="width:100%;font-size:.85rem">${esc(text)}</textarea>
 <p style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 0">${wa?`<a data-portal-wa href="${esc(wa)}" target="_blank" rel="noopener" style="display:inline-block;padding:8px 14px;border-radius:8px;background:#128c4a;color:#fff;text-decoration:none;font-weight:700">פתיחה ב-WhatsApp לשליחה</a>`:'<span style="color:#a33">אין בכרטיס טלפון ישראלי תקין. אפשר להעתיק את ההודעה ולשלוח ידנית.</span>'}<button type="button" data-portal-copy>העתקת ההודעה</button></p></div>`;
}
function markup(biz){return `<section id="sellerPortalCard" class="field full" style="padding:14px;border:1px solid #c9a854;border-radius:10px;background:#fffdf5"><h3 class="section-h">פורטל בעלי עסקים</h3><label style="display:flex;gap:8px;align-items:center;font-weight:700"><input type="checkbox" id="sellerPortalEnabled" style="width:auto">פתח חשבון בפורטל</label><p data-portal-summary role="status" style="margin:6px 0">${biz?'טוען את מצב חשבון הפורטל...':'לאחר שמירת עסק פעיל עם הסכם חתום ייווצרו שם משתמש וסיסמה, ותיפתח הודעת WhatsApp מוכנה לשליחה.'}</p><div data-portal-credentials></div><div data-portal-controls style="display:flex;gap:8px;flex-wrap:wrap"></div><small>מחיקת חשבון הפורטל משאירה את כרטיס העסק ואת הקבצים שלו. העברה לארכיון או ביטול ההסכם חוסמים את הגישה אוטומטית.</small></section>`;}
// Opens a blank tab synchronously (inside the click) so the browser allows it,
// then points it at wa.me once the server answered.
function reserveTab(){const w=window.open('about:blank','_blank');if(w){try{w.opener=null;w.document.body.innerHTML='<p dir="rtl" style="font-family:Arial;padding:30px">מכין את הודעת ה-WhatsApp...</p>';}catch(_){}}return w;}
function sendTo(tab,d){const wa=invite().waUrl(d);if(tab&&wa){tab.location.replace(wa);return true;}if(tab)tab.close();return false;}
async function mount(biz){
 const root=document.getElementById('sellerPortalCard');if(!root)return;
 const checkbox=root.querySelector('#sellerPortalEnabled');
 if(!biz){const agreement=document.getElementById('agreement_status');const sync=()=>{checkbox.disabled=agreement?.value!=='יש הסכם חתום';if(checkbox.disabled)checkbox.checked=false;};agreement?.addEventListener('change',sync);sync();return;}
 let account=null,busy=false,lastError='';
 const summary=root.querySelector('[data-portal-summary]'),controls=root.querySelector('[data-portal-controls]'),credBox=root.querySelector('[data-portal-credentials]');
 const eligible=()=>!biz.is_archived&&biz.agreement_status==='יש הסכם חתום';
 const exists=()=>!!account&&account.status!=='deleted';
 const draw=()=>{
  if(!busy)checkbox.checked=exists()&&account.status==='active';checkbox.disabled=busy||!eligible();
  let s='לא קיים חשבון פורטל. סימון V יוצר שם משתמש וסיסמה ופותח הודעת WhatsApp מוכנה.';
  if(exists()){s='שם משתמש: '+account.username+' · '+(account.status==='active'?(account.pending?'ממתין לסיסמה (נפתח בשיטה הקודמת)':'פעיל'):account.status==='archived'?'חסום עקב ארכיון':'חסום');if(!account.pending)s+=' · '+(account.last_login_at?'כניסה אחרונה '+when(account.last_login_at)+' · '+account.login_count+' כניסות':'טרם נכנס');}
  if(!eligible())s+=' · הגישה אפשרית רק לעסק פעיל עם הסכם חתום';
  summary.textContent=lastError||s;summary.style.color=lastError?'#a33':'';
  controls.innerHTML=exists()?`${account.status==='active'?`<button type="button" data-portal-open>${account.pending?'יצירת סיסמה ושליחה ב-WhatsApp':'איפוס סיסמה ושליחה ב-WhatsApp'}</button><button type="button" data-portal-block>חסימת החשבון</button>`:`<button type="button" data-portal-unblock ${!eligible()?'disabled':''}>הפעלת החשבון</button>`}<button type="button" data-portal-delete>מחיקת חשבון הפורטל</button><a href="portal-admin.html?business_id=${encodeURIComponent(biz.id)}" style="align-self:center">ניהול הפורטל של העסק ←</a>`:'';
  if(busy)controls.querySelectorAll('button').forEach(b=>b.disabled=true);
 };
 const reload=async()=>{const d=await api('admin_detail',{business_id:biz.id});account=d.account;draw();};
 const open=async tab=>{const d=await api('admin_open',{business_id:biz.id});credBox.innerHTML=credentialsHtml(d);if(!sendTo(tab,d)&&invite().waUrl(d))credBox.querySelector('[data-portal-wa]')?.focus();await reload();};
 const run=async(fn,tab=null)=>{lastError='';busy=true;draw();try{await fn();}catch(e){tab?.close();lastError=e.message;}finally{busy=false;draw();}};
 checkbox.onchange=()=>{if(busy)return;const on=checkbox.checked;
  if(on&&(!exists()||account.pending)){const tab=reserveTab();run(()=>open(tab),tab);}
  else if(on)run(async()=>{await api('admin_status',{business_id:biz.id,status:'active'});await reload();});
  else run(async()=>{await api('admin_status',{business_id:biz.id,status:'blocked'});credBox.replaceChildren();await reload();});
 };
 root.addEventListener('click',async e=>{
  const copy=e.target.closest('[data-portal-copy]');if(copy){const t=root.querySelector('[data-portal-invite]');try{await navigator.clipboard.writeText(t.value);copy.textContent='ההודעה הועתקה';}catch(_){t.select();}return;}
  const button=e.target.closest('[data-portal-controls] button');if(!button||busy)return;
  if(button.hasAttribute('data-portal-open')){if(!account.pending&&!confirm('ליצור סיסמה חדשה? הסיסמה הקודמת תפסיק לעבוד מיד.'))return;const tab=reserveTab();run(()=>open(tab),tab);}
  else if(button.hasAttribute('data-portal-block'))run(async()=>{await api('admin_status',{business_id:biz.id,status:'blocked'});credBox.replaceChildren();await reload();});
  else if(button.hasAttribute('data-portal-unblock'))run(async()=>{await api('admin_status',{business_id:biz.id,status:'active'});await reload();});
  else if(button.hasAttribute('data-portal-delete')){if(!confirm('למחוק את חשבון הפורטל בלבד? כרטיס העסק וכל הקבצים יישארו.'))return;run(async()=>{await api('admin_delete',{business_id:biz.id});credBox.replaceChildren();await reload();});}
 });
 try{await reload();}catch(error){checkbox.disabled=true;summary.textContent=error.message;}
}
// New business saved with the box checked: open the account and show the ready message.
async function afterSave(id,requested){
 if(!requested)return;const d=await api('admin_open',{business_id:id});
 const dialog=document.createElement('dialog');dialog.style.cssText='max-width:520px;width:calc(100% - 32px);padding:22px;direction:rtl;border-radius:12px';
 dialog.innerHTML=`<h3 style="margin-top:0">העסק נשמר ונפתח חשבון בפורטל</h3>${credentialsHtml(d)}<p><button type="button" data-close>סגירה</button></p>`;
 dialog.addEventListener('click',async e=>{if(e.target.closest('[data-close]'))dialog.close();if(e.target.closest('[data-portal-copy]')){try{await navigator.clipboard.writeText(dialog.querySelector('textarea').value);e.target.textContent='ההודעה הועתקה';}catch(_){}}});
 dialog.onclose=()=>dialog.remove();document.body.append(dialog);dialog.showModal();
}
window.BSDSellerPortal={markup,mount,afterSave,api};
})();
