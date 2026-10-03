(()=>{'use strict';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(action,payload={}){
 const url=window.BSD_CONFIG.SELLER_PORTAL_API_URL;if(!url)throw Error('שירות הפורטל טרם הופעל. פרטי העסק נשמרים כרגיל');
 const {data:{session}}=await window.supabaseClient.auth.getSession();if(!session)throw Error('יש להתחבר למערכת');
 const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.access_token},body:JSON.stringify({action,...payload})});const d=await r.json();
 if(!r.ok)throw Error(d.error==='signed_agreement_required'?'נדרש עסק פעיל עם הסכם חתום':'פעולת הפורטל לא הושלמה');return d;
}
function message(d){return `שלום ${String(d.name||'').trim()},\nתודה על האמון ועל שיתוף הפעולה. אנחנו ב BSD איתך לאורך תהליך מכירת העסק.\nפתחנו עבורך אזור אישי לצפייה במסמכים ובעדכונים של העסק שלך.\nקישור כניסה: ${d.portal_url}\nשם משתמש: ${d.username}\nסיסמה זמנית: ${d.temporary_password}\nיש להחליף את הסיסמה בכניסה הראשונה בתוך 24 שעות.\nנשמח לעמוד לרשותך בכל שאלה.\nצוות BSD`;}
function phone(d){const n=String(d.phone||'').replace(/\D/g,'');return n.startsWith('0')?'972'+n.slice(1):n;}
function markup(biz){return `<section id="sellerPortalCard" class="field full" style="padding:14px;border:1px solid #c9a854;border-radius:10px;background:#fffdf5"><h3 class="section-h">כניסה לפורטל בעלי עסקים</h3><label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="sellerPortalEnabled" style="width:auto">חיבור העסק לפורטל</label><p data-portal-summary role="status">${biz?'טוען את מצב חשבון הפורטל':'פרטי הכניסה ייווצרו לאחר שמירת עסק פעיל עם הסכם חתום'}</p><div data-portal-credentials></div><div data-portal-controls style="display:flex;gap:8px;flex-wrap:wrap"></div><small>מחיקת חשבון הפורטל משאירה את כרטיס העסק ואת הקבצים שלו. העברה לארכיון חוסמת את הגישה אוטומטית.</small></section>`;}
async function mount(biz){
 const root=document.getElementById('sellerPortalCard');if(!root)return;
 if(!biz){const checkbox=root.querySelector('input');const agreement=document.getElementById('agreement_status');const sync=()=>{checkbox.disabled=agreement?.value!=='יש הסכם חתום';if(checkbox.disabled)checkbox.checked=false;};agreement?.addEventListener('change',sync);sync();return;}
 let account,credentials=null,busy=false,lastError='';
 const summary=root.querySelector('[data-portal-summary]'),checkbox=root.querySelector('input'),controls=root.querySelector('[data-portal-controls]');
 const draw=()=>{const exists=account&&account.status!=='deleted',eligible=!biz.is_archived&&biz.agreement_status==='יש הסכם חתום';checkbox.checked=exists&&account.status==='active';checkbox.disabled=busy||!eligible;summary.textContent=exists?'שם משתמש: '+account.username+' · '+(account.status==='active'?'פעיל':account.status==='archived'?'חסום עקב ארכיון':'חסום'):'לא קיים חשבון פורטל';controls.innerHTML=exists?`<button type="button" data-portal-send>שליחת פרטי כניסה ב WhatsApp</button><button type="button" data-portal-reset>שינוי סיסמה</button><button type="button" data-portal-block ${!eligible?'disabled':''}>${account.status==='active'?'חסימה':'הפעלת חשבון'}</button><button type="button" data-portal-delete>מחיקת חשבון הפורטל</button><a href="portal-admin.html?business_id=${encodeURIComponent(biz.id)}">ניהול מסמכים ופעילות</a>`:'';controls.querySelectorAll('button').forEach(b=>{if(busy)b.disabled=true;});if(!eligible)summary.textContent+=' · הגישה חסומה כל עוד העסק בארכיון או ללא הסכם חתום';if(lastError)summary.textContent=lastError;};
 const showCredentials=d=>{credentials=d;root.querySelector('[data-portal-credentials]').innerHTML=`<p>שם משתמש: <b dir="ltr">${esc(d.username)}</b></p><p>סיסמה זמנית: <b dir="ltr">${esc(d.temporary_password)}</b></p><small>הסיסמה מוצגת פעם אחת בלבד. שליחה חוזרת לאחר סגירת הכרטיס יוצרת סיסמה זמנית חדשה.</small>`;};
 const reload=async()=>{const d=await api('admin_detail',{business_id:biz.id});account=d.account;draw();};
 const reset=async()=>{const d=await api('admin_credentials',{business_id:biz.id});showCredentials(d);await reload();return d;};
 checkbox.onchange=async()=>{if(busy)return;const enabled=checkbox.checked;lastError='';busy=true;draw();try{if(enabled&&(!account||account.status==='deleted'))await reset();else {await api('admin_status',{business_id:biz.id,status:enabled?'active':'blocked'});await reload();}}catch(e){lastError=e.message;}finally{busy=false;draw();}};
 controls.onclick=async e=>{const button=e.target.closest('button');if(!button||busy)return;let popup=null;try{
  if(button.hasAttribute('data-portal-delete')&&!confirm('למחוק את חשבון הפורטל בלבד? כרטיס העסק וכל הקבצים יישארו.'))return;
  if(button.hasAttribute('data-portal-send')){popup=window.open('about:blank','_blank');if(popup)popup.opener=null;}
  lastError='';busy=true;draw();
  if(button.hasAttribute('data-portal-reset'))await reset();
  if(button.hasAttribute('data-portal-send')){const d=credentials||await reset(),n=phone(d);if(!/^972\d{8,9}$/.test(n))throw Error('יש לעדכן מספר טלפון ישראלי תקין בכרטיס העסק');const url='https://wa.me/'+n+'?text='+encodeURIComponent(message(d));if(popup)popup.location=url;else window.open(url,'_blank','noopener');}
  if(button.hasAttribute('data-portal-block')){await api('admin_status',{business_id:biz.id,status:account.status==='active'?'blocked':'active'});await reload();}
  if(button.hasAttribute('data-portal-delete')){await api('admin_delete',{business_id:biz.id});credentials=null;root.querySelector('[data-portal-credentials]').replaceChildren();await reload();}
 }catch(error){popup?.close();lastError=error.message;}finally{busy=false;draw();}};
 try{await reload();}catch(error){checkbox.disabled=true;summary.textContent=error.message;}
}
async function afterSave(id,requested){if(!requested)return;const d=await api('admin_credentials',{business_id:id});const dialog=document.createElement('dialog');dialog.style.cssText='max-width:500px;width:calc(100% - 32px);padding:24px;direction:rtl;border-radius:12px';const n=phone(d);dialog.innerHTML=`<h3>העסק נשמר ונוצר חשבון פורטל</h3><p>שם משתמש: <b dir="ltr">${esc(d.username)}</b></p><p>סיסמה זמנית: <b dir="ltr">${esc(d.temporary_password)}</b></p>${/^972\d{8,9}$/.test(n)?`<a href="https://wa.me/${n}?text=${encodeURIComponent(message(d))}" target="_blank" rel="noopener">שליחת פרטי כניסה ב WhatsApp</a>`:'<p>יש לעדכן טלפון בכרטיס העסק לצורך שליחת הפרטים.</p>'}<p><button type="button">סגירה</button></p>`;dialog.querySelector('button').onclick=()=>dialog.close();dialog.onclose=()=>dialog.remove();document.body.append(dialog);dialog.showModal();}
window.BSDSellerPortal={markup,mount,afterSave,api,message};
})();
