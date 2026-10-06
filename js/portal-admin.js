// Simple seller-portal admin screen (v2, 04.10.2026): when each business owner
// logged in, how many times, which files they opened/downloaded, plus upload of
// extra files to a business portal. The API enforces admin/manager on every call.
(()=>{'use strict';
const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const when=v=>v?new Date(v).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}):'';
const size=n=>!n?'':n>1048576?(n/1048576).toFixed(1)+' MB':Math.max(1,Math.round(n/1024))+' KB';
const ERRORS={signed_agreement_required:'נדרש עסק פעיל עם הסכם חתום',account_required:'אין חשבון פורטל לעסק זה',preview_unavailable:'החשבון אינו פתוח לצפייה. נדרש חשבון פורטל פעיל לעסק עם הסכם חתום',file_type_not_allowed:'סוג קובץ לא נתמך (מותר: תמונות, PDF, Word, Excel, PowerPoint, טקסט, וידאו, ZIP)',file_too_large:'הקובץ גדול מ-20MB',upload_missing:'ההעלאה לא הושלמה',archived:'העסק בארכיון'};
let data=null,current=null;
const status=m=>{$('status').textContent=m;if(m)setTimeout(()=>{if($('status').textContent===m)$('status').textContent='';},6000);};
async function api(action,payload={}){const {data:{session}}=await window.supabaseClient.auth.getSession();if(!session)throw Error('יש להתחבר למערכת BSD');const url=window.BSD_CONFIG.SELLER_PORTAL_API_URL;if(!url)throw Error('שירות הפורטל לא הוגדר');const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.access_token},body:JSON.stringify({action,...payload})});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(ERRORS[d.error]||'הפעולה לא הושלמה');return d;}
const stateLabel=a=>a.status==='active'?(a.pending?'ממתין לסיסמה':'פעיל'):a.status==='archived'?'חסום (ארכיון)':'חסום';
async function load(){try{data=await api('admin_overview');render();status('');const id=new URLSearchParams(location.search).get('business_id');if(id&&!current){current=id;await detail(id);}}catch(err){$('accounts').textContent='';status(err.message);}}
const previewable=(account,business)=>!!account&&account.status==='active'&&!!business&&!business.is_archived&&business.agreement_status==='יש הסכם חתום';
const statButton=(attr,label,value,hint)=>`<button type="button" ${attr}><span>${label}</span><b>${value}</b><small>${hint}</small></button>`;
function render(){
 const accounts=data.accounts,active=accounts.filter(a=>a.status==='active');
 const logins=accounts.reduce((n,a)=>n+a.login_count,0),downloads=accounts.reduce((n,a)=>n+a.download_count,0);
 $('stats').innerHTML=statButton('data-show-active','משתמשים פעילים',active.length,'לחצו להצגת המשתמשים ←')+statButton('data-show-logins','כניסות לפורטל',logins,'לחצו להצגת הכניסות ←')+statButton('data-show-downloads','הורדות קבצים',downloads,'לחצו להצגת ההורדות ←');
 const choices=accounts.filter(a=>previewable(a,a.business));
 const sel=$('previewBusiness'),prev=sel.value;
 sel.innerHTML=choices.map(a=>`<option value="${esc(a.business_id)}">${esc(a.business?.internal_name||'עסק')} · ${esc(a.business?.owner_name||'')}</option>`).join('')||'<option value="">אין עסק עם חשבון פורטל פתוח</option>';
 if(prev&&[...sel.options].some(o=>o.value===prev))sel.value=prev;
 $('previewEnter').disabled=!choices.length;
 const q=$('search').value.trim().toLowerCase();
 const rows=accounts.filter(a=>[a.business?.internal_name,a.business?.owner_name,a.username].some(v=>String(v||'').toLowerCase().includes(q)));
 $('accounts').innerHTML=rows.map(a=>`<div class="admin-row"><strong>${esc(a.business?.internal_name||'עסק')}</strong><p>${esc(a.business?.owner_name||'')} · שם משתמש <b dir="ltr">${esc(a.username)}</b> · ${esc(stateLabel(a))}</p><small>כניסה אחרונה: ${a.last_login_at?esc(when(a.last_login_at)):'טרם נכנס'} · ${a.login_count} כניסות · ${a.download_count} הורדות · ${a.view_count} צפיות</small><p>${previewable(a,a.business)?`<button type="button" data-preview="${esc(a.business_id)}">צפייה כבעל העסק</button> `:''}<button type="button" data-detail="${esc(a.business_id)}">פרטים והעלאת קבצים</button> <a href="businesses.html?open=${esc(a.business_id)}">כרטיס העסק</a></p></div>`).join('')||'<p class="muted">עדיין אין חשבונות. פותחים חשבון מכרטיס העסק בסימון «פתח חשבון בפורטל».</p>';
 $('requests').innerHTML=data.requests.map(r=>`<div class="admin-row"><strong>${esc(r.business_name)} · ${esc(r.requester_name)}</strong><p>${esc(r.phone)} · ${esc(when(r.created_at))} · ${r.kind==='password'?'שכחתי סיסמה':r.kind==='username'?'שכחתי שם משתמש':'הודעה'}</p>${r.message?`<p>${esc(r.message)}</p>`:''}${r.status==='new'?`<button type="button" data-request="${esc(r.id)}">סמן כטופל</button>`:'<small>טופל</small>'}</div>`).join('')||'<p class="muted">אין פניות.</p>';
}
function showActive(){
 const active=data.accounts.filter(a=>a.status==='active');
 $('dialogBody').innerHTML=`<h2>משתמשים פעילים (${active.length})</h2><div style="overflow:auto"><table data-active-users style="width:100%;border-collapse:collapse"><thead><tr>${['עסק','איש קשר','שם משתמש','מצב','נפתח','כניסה אחרונה','כניסות'].map(h=>`<th style="text-align:right;border-bottom:1px solid #dce4eb;padding:6px">${h}</th>`).join('')}</tr></thead><tbody>${active.map(a=>`<tr>${[a.business?.internal_name,a.business?.owner_name,a.username,stateLabel(a),when(a.created_at),a.last_login_at?when(a.last_login_at):'טרם נכנס',a.login_count].map((v,i)=>`<td style="padding:6px;border-bottom:1px solid #eef2f5"${i===2?' dir="ltr"':''}>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${active.length?'':'<p class="muted">אין משתמשים פעילים.</p>'}`;
 if(!$('dialog').open)$('dialog').showModal();
}
function table(headers,rows){return `<div style="overflow:auto"><table style="width:100%;border-collapse:collapse"><thead><tr>${headers.map(h=>`<th style="text-align:right;border-bottom:1px solid #dce4eb;padding:6px">${h}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;}
function showLogins(){
 const accounts=[...data.accounts].sort((x,y)=>String(y.last_login_at||'').localeCompare(String(x.last_login_at||'')));
 const total=accounts.reduce((n,a)=>n+a.login_count,0);
 const body=accounts.map(a=>`<tr>${[a.business?.internal_name,a.business?.owner_name,a.username,a.last_login_at?when(a.last_login_at):'טרם נכנס',a.login_count].map((v,i)=>`<td style="padding:6px;border-bottom:1px solid #eef2f5"${i===2?' dir="ltr"':''}>${esc(v)}</td>`).join('')}</tr>`).join('');
 $('dialogBody').innerHTML=`<h2>כניסות לפורטל (${total})</h2>${table(['עסק','איש קשר','שם משתמש','כניסה אחרונה','כניסות'],body)}`;
 $('dialogBody').querySelector('table').setAttribute('data-logins','');
 if(!$('dialog').open)$('dialog').showModal();
}
function showDownloads(){
 const items=[];
 for(const a of data.accounts){
  const files=(a.files||[]).filter(f=>f.mode==='download');
  if(files.length)files.forEach(f=>items.push({a,f}));
  else if(a.download_count)items.push({a,f:null});
 }
 const total=data.accounts.reduce((n,a)=>n+a.download_count,0);
 const body=items.map(({a,f})=>`<tr><td style="padding:6px;border-bottom:1px solid #eef2f5">${esc(a.business?.internal_name||'עסק')}</td><td style="padding:6px;border-bottom:1px solid #eef2f5" dir="ltr">${esc(a.username)}</td><td style="padding:6px;border-bottom:1px solid #eef2f5">${esc(a.download_count)}</td><td style="padding:6px;border-bottom:1px solid #eef2f5">${f?esc(f.name):'—'}</td><td style="padding:6px;border-bottom:1px solid #eef2f5">${f?esc(when(f.at)):'—'}</td></tr>`).join('');
 $('dialogBody').innerHTML=`<h2>הורדות קבצים (${total})</h2>${items.length?table(['עסק','שם משתמש','הורדות','קובץ','מתי'],body):'<p class="muted">אין הורדות מתועדות.</p>'}`;
 $('dialogBody').querySelector('table')?.setAttribute('data-downloads','');
 if(!$('dialog').open)$('dialog').showModal();
}
function openPreview(businessId){
 const tab=window.open('about:blank','_blank');if(tab){try{tab.opener=null;}catch(_){}}
 return api('admin_preview',{business_id:businessId}).then(d=>{
  const url=String(d.portal_url||'').replace(/#.*$/,'')+'#preview='+d.token;
  if(tab)tab.location.replace(url);else location.assign(url);
 }).catch(err=>{tab?.close();throw err;});
}
async function detail(id){
 current=id;const d=await api('admin_detail',{business_id:id}),a=d.account&&d.account.status!=='deleted'?d.account:null,b=d.business,eligible=!b.is_archived&&b.agreement_status==='יש הסכם חתום';
 const files=d.portal.files,docs=files.filter(f=>f.kind!=='extra'),extras=files.filter(f=>f.kind==='extra');
 $('dialogBody').innerHTML=`<h2>${esc(b.internal_name)}</h2>
 <p>${a?`שם משתמש <b dir="ltr">${esc(a.username)}</b> · ${esc(stateLabel(a))}`:'אין חשבון פורטל. פותחים מכרטיס העסק.'} · <a href="businesses.html?open=${esc(b.id)}">כרטיס העסק</a></p>
 ${a?`<p class="actions" style="flex-wrap:wrap">${previewable(a,b)?`<button type="button" data-preview="${esc(b.id)}">צפייה כבעל העסק</button>`:''}${a.status==='active'?`<button type="button" data-reset>${a.pending?'יצירת סיסמה ושליחה ב-WhatsApp':'איפוס סיסמה ושליחה ב-WhatsApp'}</button><button type="button" data-status="blocked">חסימת החשבון</button>`:`<button type="button" data-status="active" ${eligible?'':'disabled'}>הפעלת החשבון</button>`}</p><div data-cred></div>`:''}
 <h3>כניסות ${a?`(${a.login_count})`:''}</h3>${a&&a.logins.length?`<p>${a.logins.map(t=>esc(when(t))).join(' · ')}</p>`:'<p class="muted">אין כניסות מתועדות.</p>'}
 <h3>קבצים שבעל העסק פתח או הוריד</h3>${a&&a.files.length?a.files.map(f=>`<div class="admin-row" style="padding:8px 0"><strong>${esc(f.name)}</strong> <small style="display:block">${f.mode==='download'?'הורדה':'צפייה'} · ${esc(when(f.at))}</small></div>`).join(''):'<p class="muted">עדיין לא נפתחו קבצים.</p>'}
 <h3>מה בעל העסק רואה בפורטל</h3><p class="muted">המסמכים מכרטיס העסק מוצגים אוטומטית (הגרסה האחרונה של כל סוג).</p>${docs.map(f=>`<div class="admin-row" style="padding:8px 0"><strong>${esc(f.type)}</strong> <small style="display:block">${esc(f.name)} · ${esc(when(f.date))}</small></div>`).join('')||'<p class="muted">אין עדיין מסמכים בכרטיס העסק.</p>'}
 <h3>קבצים נוספים</h3>${extras.map(f=>`<div class="admin-row" style="padding:8px 0"><strong>${esc(f.name)}</strong> <small style="display:block">${esc(size(f.size))} · ${esc(when(f.date))}</small><button type="button" data-remove-extra="${esc(f.id)}">הסרה מהפורטל</button></div>`).join('')||'<p class="muted">לא הועלו קבצים נוספים.</p>'}
 ${b.is_archived?'':`<label>העלאת קבצים נוספים לפורטל של העסק (תמונות, PDF, Word, Excel ועוד, עד 20MB לקובץ)<input type="file" id="extraFiles" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.gif,.heic,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.mp4,.mov,.zip"></label><button type="button" class="primary" data-upload>העלאה לפורטל</button>`}`;
 if(!$('dialog').open)$('dialog').showModal();
}
async function upload(files){
 let ok=0;for(const file of files){
  let u=null;try{status(`מעלה את ${file.name}...`);u=await api('admin_upload_url',{business_id:current,file_name:file.name,size:file.size});
   const r=await window.supabaseClient.storage.from(u.bucket).uploadToSignedUrl(u.path,u.token,file,{contentType:u.content_type});if(r.error)throw Error('ההעלאה נכשלה');
   await api('admin_upload_done',{business_id:current,file_id:u.file_id});ok++;
  }catch(err){if(u?.file_id)api('admin_extra_delete',{business_id:current,file_id:u.file_id}).catch(()=>{});status(file.name+': '+err.message);await new Promise(r=>setTimeout(r,1500));}
 }
 return ok;
}
$('closeDialog').onclick=()=>$('dialog').close();$('dialog').addEventListener('close',()=>{$('dialogBody').innerHTML='';current=null;});
$('search').oninput=()=>data&&render();$('refresh').onclick=load;
document.addEventListener('click',async e=>{const button=e.target.closest('button');if(!button||button.id==='closeDialog')return;
 try{
  if(button.hasAttribute('data-show-active'))return showActive();
  if(button.hasAttribute('data-show-logins'))return showLogins();
  if(button.hasAttribute('data-show-downloads'))return showDownloads();
  if(button.dataset.preview||button.id==='previewEnter'){const id=button.dataset.preview||$('previewBusiness').value;if(!id){status('יש לבחור עסק');return;}button.disabled=true;await openPreview(id);return;}
  if(button.dataset.detail){button.disabled=true;await detail(button.dataset.detail);return;}
  if(button.dataset.request){button.disabled=true;await api('admin_request',{request_id:button.dataset.request});await load();return;}
  if(button.hasAttribute('data-reset')){if(!confirm('ליצור סיסמה חדשה ולפתוח הודעת WhatsApp? הסיסמה הקודמת תפסיק לעבוד מיד.'))return;const tab=window.open('about:blank','_blank');if(tab)tab.opener=null;button.disabled=true;
   try{const d=await api('admin_open',{business_id:current}),wa=window.BSDPortalInvite.waUrl(d);if(tab&&wa)tab.location.replace(wa);else tab?.close();
    const box=document.querySelector('[data-cred]');box.innerHTML=`<p>שם משתמש <b dir="ltr">${esc(d.username)}</b> · סיסמה חדשה <b dir="ltr">${esc(d.password)}</b> (מוצגת עכשיו בלבד)</p><textarea readonly rows="8" style="width:100%">${esc(window.BSDPortalInvite.message(d))}</textarea>${wa?`<a href="${esc(wa)}" target="_blank" rel="noopener">פתיחה ב-WhatsApp לשליחה</a>`:'<p>אין טלפון ישראלי תקין בכרטיס. אפשר להעתיק את ההודעה.</p>'}`;await load();
   }catch(err){tab?.close();throw err;}return;}
  if(button.dataset.status){button.disabled=true;await api('admin_status',{business_id:current,status:button.dataset.status});await load();await detail(current);status(button.dataset.status==='blocked'?'החשבון נחסם':'החשבון הופעל');return;}
  if(button.dataset.removeExtra){if(!confirm('להסיר את הקובץ מהפורטל של העסק?'))return;button.disabled=true;await api('admin_extra_delete',{business_id:current,file_id:button.dataset.removeExtra});await detail(current);status('הקובץ הוסר');return;}
  if(button.hasAttribute('data-upload')){const files=[...($('extraFiles')?.files||[])];if(!files.length){status('יש לבחור קובץ');return;}button.disabled=true;const n=await upload(files);await detail(current);status(`${n} מתוך ${files.length} קבצים הועלו לפורטל`);return;}
 }catch(err){status(err.message);}finally{if(document.body.contains(button))button.disabled=false;}
});
// UI guard only. The API enforces admin/manager on every admin_* action.
(async()=>{try{const {data:{session}}=await window.supabaseClient.auth.getSession();if(!session){location.href='login.html';return;}const {data:p}=await window.supabaseClient.from('profiles').select('role,status').eq('id',session.user.id).maybeSingle();if(!p||p.status!=='active'||!['admin','manager'].includes(p.role)){document.querySelector('main.content').innerHTML='<h1>אין הרשאה</h1><p>מסך ניהול הפורטל זמין רק למנהלי המערכת.</p><p><a href="app.html">חזרה למערכת</a></p>';return;}load();}catch(err){status('לא ניתן לאמת הרשאה כרגע');}})();
})();
