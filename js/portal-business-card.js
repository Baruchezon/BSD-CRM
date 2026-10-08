// Seller portal controls inside the CRM business card (admin/manager only; the
// API enforces the same rule). v2 (04.10.2026): checking "פתח חשבון בפורטל"
// opens the account in one click: the server creates a username and a random
// password, and a ready WhatsApp message opens for BSD to send. Nothing is ever
// sent automatically.
(()=>{'use strict';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const when=v=>v?new Date(v).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}):'';
const ERRORS={email_missing:'אין מייל תקין בכרטיס העסק',sender_not_ready:'שליחת מיילים מהכתובת baruch@bsd-bbi.co.il עדיין לא הופעלה. המייל לא נשלח והסיסמה לא השתנתה',send_failed:'המייל לא נשלח והסיסמה לא השתנתה. אפשר לנסות שוב או לשלוח ב-WhatsApp',sent_not_saved:'המייל נשלח אבל הסיסמה החדשה לא נשמרה. הסיסמה הקודמת עדיין עובדת. יש ללחוץ שוב על «שליחה במייל»',try_later:'נשלחו כמה מיילים ברצף. אפשר לנסות שוב בעוד רבע שעה',invalid_action:'שליחה במייל עדיין לא הופעלה בשרת. המייל לא נשלח',signed_agreement_required:'נדרש עסק פעיל עם הסכם חתום',account_required:'אין חשבון פורטל לעסק זה',preview_unavailable:'החשבון אינו פתוח לצפייה. נדרש חשבון פורטל פעיל לעסק עם הסכם חתום'};
async function api(action,payload={}){
 const url=window.BSD_CONFIG.SELLER_PORTAL_API_URL;if(!url)throw Error('שירות הפורטל טרם הופעל. פרטי העסק נשמרים כרגיל');
 const {data:{session}}=await window.supabaseClient.auth.getSession();if(!session)throw Error('יש להתחבר למערכת');
 const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.access_token},body:JSON.stringify({action,...payload})});const d=await r.json().catch(()=>({}));
 if(!r.ok)throw Error(ERRORS[d.error]||'פעולת הפורטל לא הושלמה');return d;
}
const invite=()=>window.BSDPortalInvite;
// 08.10.2026 (בקשת ברוך): «שליחה במייל» of the portal login details to the card's owner email.
// Confirm first (business, owner, email, new-password warning). The server issues a NEW password,
// emails the website link + «פורטל בעלי עסקים» button + username + password from baruch@bsd-bbi.co.il,
// and only then makes the new password the working one. Every attempt is logged in audit_log
// (action portal_access_email, never the password).
const EMAIL_LOG_ACTION='portal_access_email';
const validEmail=v=>/^[^\s@<>()",;]+@[^\s@<>()",;]+\.[A-Za-z]{2,}$/.test(String(v??'').trim());
function emailState(biz,account){
 if(!account||account.status!=='active')return {show:false};
 const email=String(biz?.owner_email??'').trim();
 return validEmail(email)?{show:true,enabled:true,email}:{show:true,enabled:false,email:'',note:'אין מייל בכרטיס. כדי לשלוח במייל, ממלאים «אימייל הבעלים» ושומרים את הכרטיס.'};
}
function emailConfirmHtml(biz,email,username){
 const row=(k,v)=>`<p style="margin:0;padding:7px 0;border-bottom:1px solid #eee;text-align:right;line-height:1.5"><span style="color:#555">${esc(k)}:</span> <b style="overflow-wrap:anywhere">${v}</b></p>`;
 return `<h3 style="margin:0 0 10px">שליחת פרטי הכניסה לפורטל במייל</h3>
 <div style="margin:0 0 12px">${row('העסק',esc(biz.internal_name||''))}${row('בעל העסק',esc(biz.owner_name||'—'))}${row('נשלח אל',`<span dir="ltr">${esc(email)}</span>`)}${row('מאת','<span dir="ltr">baruch@bsd-bbi.co.il</span>')}</div>
 <p style="margin:0 0 10px;font-size:.9rem;line-height:1.6;background:#f7f9fb;border-radius:8px;padding:10px">המייל כולל קישור לאתר BSD, הסבר ללחוץ על הכפתור «פורטל בעלי עסקים», את שם המשתמש <b dir="ltr">${esc(username||'')}</b> וסיסמה.</p>
 <p data-new-password-warning style="margin:0 0 12px;font-size:.95rem;line-height:1.6;background:#fff4e5;border:1px solid #e8b25a;color:#7a4a00;border-radius:8px;padding:10px;font-weight:700">⚠️ בשליחה תיווצר סיסמה חדשה, והסיסמה הקודמת תפסיק לעבוד.</p>
 <p style="display:flex;gap:8px;flex-wrap:wrap;margin:0"><button type="button" data-email-send style="min-height:44px;padding:8px 18px;font-weight:700;background:#0f2a44;color:#fff;border:0;border-radius:8px">שליחה</button><button type="button" data-email-cancel style="min-height:44px;padding:8px 18px">ביטול</button></p>`;
}
// Resolves true only when the user pressed «שליחה».
function confirmEmail(biz,email,username){return new Promise(resolve=>{
 const dialog=document.createElement('dialog');dialog.setAttribute('data-portal-email-confirm','');dialog.style.cssText='max-width:480px;width:calc(100% - 32px);padding:20px;direction:rtl;border-radius:12px;border:1px solid #c9a854';
 dialog.innerHTML=emailConfirmHtml(biz,email,username);let ok=false;
 dialog.addEventListener('click',e=>{if(e.target.closest('[data-email-send]')){ok=true;dialog.close();}else if(e.target.closest('[data-email-cancel]'))dialog.close();});
 dialog.onclose=()=>{dialog.remove();resolve(ok);};document.body.append(dialog);dialog.showModal();});}
function emailLogText(row){
 if(!row)return '';const d=row.details||{};
 return d.status==='sent'?`מייל פרטי כניסה נשלח אל ${d.to||''} · ${when(row.occurred_at)}`:`ניסיון שליחה במייל אל ${d.to||''} נכשל · ${when(row.occurred_at)}`;
}
function credentialsHtml(d){
 const text=invite().message(d),wa=invite().waUrl(d);
 return `<div data-portal-new style="margin:10px 0;padding:12px;border:1px solid #c9a854;border-radius:10px;background:#fff">
 <p style="margin:0 0 6px"><b>החשבון מוכן.</b> שם משתמש: <b dir="ltr">${esc(d.username)}</b> · סיסמה: <b dir="ltr">${esc(d.password)}</b></p>
 <p style="margin:0 0 6px;font-size:.85rem">הסיסמה מוצגת עכשיו בלבד ונשמרת בשרת בצורה מוצפנת. ההודעה נפתחת ב-WhatsApp לשליחה על ידך.</p>
 <textarea data-portal-invite rows="9" readonly style="width:100%;font-size:.85rem">${esc(text)}</textarea>
 <p style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 0">${wa?`<a data-portal-wa href="${esc(wa)}" target="_blank" rel="noopener" style="display:inline-block;padding:8px 14px;border-radius:8px;background:#128c4a;color:#fff;text-decoration:none;font-weight:700">פתיחה ב-WhatsApp לשליחה</a>`:'<span style="color:#a33">אין בכרטיס טלפון ישראלי תקין. אפשר להעתיק את ההודעה ולשלוח ידנית.</span>'}<button type="button" data-portal-copy>העתקת ההודעה</button></p></div>`;
}
// 08.10.2026 (בקשת ברוך, תיקון): «פתח חשבון בפורטל» first asks HOW to send the login details:
// checkboxes «וואטסאפ» (checked by default) and «מייל» (one or both), then «פתח ושלח» / «ביטול».
// Same code for every business card (old, new, without an account) and for a new business saved
// with the box checked. WhatsApp alone = exactly the previous flow. «מייל» = the existing server
// action admin_email_access (sender baruch@bsd-bbi.co.il, owner email from the DB). Nothing is sent
// before «פתח ושלח»; WhatsApp is always sent by hand.
function channelChoiceHtml(biz){
 const email=String(biz?.owner_email??'').trim(),ok=validEmail(email);
 const box='display:flex;gap:10px;align-items:center;min-height:44px;padding:8px 10px;border:1px solid #ddd;border-radius:8px;margin:0 0 8px;cursor:pointer;font-weight:700';
 const cb='width:22px;height:22px;flex:0 0 auto;margin:0';
 return `<h3 style="margin:0 0 6px">פתיחת חשבון בפורטל</h3>
 <p style="margin:0 0 12px;line-height:1.5">איך לשלוח לבעל העסק את פרטי הכניסה?${biz?.internal_name?` <span style="color:#555">(${esc(biz.internal_name)})</span>`:''}</p>
 <label style="${box}"><input type="checkbox" data-ch-wa checked style="${cb}"><span>וואטסאפ<small style="display:block;font-weight:400;color:#555">הודעה מוכנה נפתחת ב-WhatsApp לשליחה על ידך</small></span></label>
 <label style="${box}${ok?'':';opacity:.75;cursor:default'}"><input type="checkbox" data-ch-mail ${ok?'':'disabled aria-describedby="portalChoiceMailNote"'} style="${cb}"><span>מייל${ok?`<small style="display:block;font-weight:400;color:#555;overflow-wrap:anywhere">יישלח אל <span dir="ltr">${esc(email)}</span> מהכתובת <span dir="ltr" style="white-space:nowrap">baruch@bsd-bbi.co.il</span></small>`:`<small id="portalChoiceMailNote" data-ch-mail-note style="display:block;font-weight:400;color:#a33">אין מייל בכרטיס. כדי לשלוח במייל, ממלאים «אימייל הבעלים» ושומרים את הכרטיס.</small>`}</span></label>
 <p data-ch-none role="alert" style="margin:0 0 8px;color:#a33;font-size:.9rem" hidden>יש לבחור וואטסאפ, מייל או את שניהם.</p>
 <p style="display:flex;gap:8px;flex-wrap:wrap;margin:4px 0 0"><button type="button" data-ch-ok style="min-height:44px;padding:8px 18px;font-weight:700;background:#0f2a44;color:#fff;border:0;border-radius:8px">פתח ושלח</button><button type="button" data-ch-cancel style="min-height:44px;padding:8px 18px">ביטול</button></p>`;
}
// Resolves {wa,mail,tab} after «פתח ושלח», or null on «ביטול»/Esc. With reserve, the WhatsApp tab is
// reserved inside that click (as before), so the browser does not block it.
function chooseChannels(biz,{reserve=false}={}){return new Promise(resolve=>{
 const dialog=document.createElement('dialog');dialog.setAttribute('data-portal-open-choice','');dialog.style.cssText='max-width:440px;width:calc(100% - 32px);max-height:calc(100% - 32px);overflow:auto;padding:20px;direction:rtl;border-radius:12px;border:1px solid #c9a854;box-sizing:border-box';
 dialog.innerHTML=channelChoiceHtml(biz);let pick=null;
 const wa=dialog.querySelector('[data-ch-wa]'),mail=dialog.querySelector('[data-ch-mail]'),none=dialog.querySelector('[data-ch-none]'),okBtn=dialog.querySelector('[data-ch-ok]');
 const sync=()=>{const any=wa.checked||(mail.checked&&!mail.disabled);okBtn.disabled=!any;none.hidden=any;};
 dialog.addEventListener('change',sync);
 dialog.addEventListener('click',e=>{
  if(e.target.closest('[data-ch-ok]')){const w=wa.checked,m=mail.checked&&!mail.disabled;if(!w&&!m){sync();return;}pick={wa:w,mail:m,tab:w&&reserve?reserveTab():null};dialog.close();}
  else if(e.target.closest('[data-ch-cancel]'))dialog.close();});
 dialog.onclose=()=>{dialog.remove();resolve(pick);};document.body.append(dialog);dialog.showModal();});}
// WhatsApp text when the password went by email: same text, the password line points to the email.
function mailNoticeData(d,to){return {...d,password:`נשלחה אליך במייל${to?' ('+to+')':''}`};}
function mailSentHtml(d,to,wa){
 const link=wa?invite().waUrl(mailNoticeData(d,to)):'';
 return `<div data-portal-mail-sent style="margin:10px 0;padding:12px;border:1px solid #1e6b45;border-radius:10px;background:#f2fbf5">
 <p style="margin:0 0 6px"><b>החשבון מוכן.</b> שם משתמש: <b dir="ltr">${esc(d.username)}</b></p>
 <p style="margin:0;line-height:1.6">פרטי הכניסה (שם משתמש וסיסמה) נשלחו במייל אל <b dir="ltr">${esc(to)}</b> מהכתובת <span dir="ltr">baruch@bsd-bbi.co.il</span>.</p>
 ${wa?`<p style="margin:8px 0 0">${link?`<a data-portal-wa href="${esc(link)}" target="_blank" rel="noopener" style="display:inline-block;padding:8px 14px;border-radius:8px;background:#128c4a;color:#fff;text-decoration:none;font-weight:700">פתיחה ב-WhatsApp לשליחה</a>`:'<span style="color:#a33">אין בכרטיס טלפון ישראלי תקין לשליחה ב-WhatsApp.</span>'}</p>`:''}</div>`;
}
function markup(biz){return `<section id="sellerPortalCard" class="field full" style="padding:14px;border:1px solid #c9a854;border-radius:10px;background:#fffdf5"><h3 class="section-h">פורטל בעלי עסקים</h3><label style="display:flex;gap:8px;align-items:center;font-weight:700"><input type="checkbox" id="sellerPortalEnabled" style="width:auto">פתח חשבון בפורטל</label><p data-portal-summary role="status" style="margin:6px 0">${biz?'טוען את מצב חשבון הפורטל...':'לאחר שמירת עסק פעיל עם הסכם חתום תופיע בחירה: שליחת פרטי הכניסה בוואטסאפ, במייל או בשניהם.'}</p><div data-portal-credentials></div><div data-portal-controls style="display:flex;gap:8px;flex-wrap:wrap"></div><p data-portal-email-log role="status" style="margin:6px 0;font-size:.85rem" hidden></p><small>מחיקת חשבון הפורטל משאירה את כרטיס העסק ואת הקבצים שלו. העברה לארכיון או ביטול ההסכם חוסמים את הגישה אוטומטית.</small></section>`;}
// Opens a blank tab synchronously (inside the click) so the browser allows it,
// then points it at wa.me once the server answered.
function reserveTab(){const w=window.open('about:blank','_blank');if(w){try{w.opener=null;w.document.body.innerHTML='<p dir="rtl" style="font-family:Arial;padding:30px">מכין את הודעת ה-WhatsApp...</p>';}catch(_){}}return w;}
function sendTo(tab,d){const wa=invite().waUrl(d);if(tab&&wa){tab.location.replace(wa);return true;}if(tab)tab.close();return false;}
async function mount(biz){
 const root=document.getElementById('sellerPortalCard');if(!root)return;
 const checkbox=root.querySelector('#sellerPortalEnabled');
 if(!biz){const agreement=document.getElementById('agreement_status');const sync=()=>{checkbox.disabled=agreement?.value!=='יש הסכם חתום';if(checkbox.disabled)checkbox.checked=false;};agreement?.addEventListener('change',sync);sync();return;}
 let account=null,busy=false,lastError='',emailLog=null;
 const logLine=root.querySelector('[data-portal-email-log]'),summary=root.querySelector('[data-portal-summary]'),controls=root.querySelector('[data-portal-controls]'),credBox=root.querySelector('[data-portal-credentials]');
 const eligible=()=>!biz.is_archived&&biz.agreement_status==='יש הסכם חתום';
 const exists=()=>!!account&&account.status!=='deleted';
 const draw=()=>{
  if(!busy)checkbox.checked=exists()&&account.status==='active';checkbox.disabled=busy||!eligible();
  let s='לא קיים חשבון פורטל. סימון V פותח בחירה: שליחת פרטי הכניסה בוואטסאפ, במייל או בשניהם.';
  if(exists()){s='שם משתמש: '+account.username+' · '+(account.status==='active'?(account.pending?'ממתין לסיסמה (נפתח בשיטה הקודמת)':'פעיל'):account.status==='archived'?'חסום עקב ארכיון':'חסום');if(!account.pending)s+=' · '+(account.last_login_at?'כניסה אחרונה '+when(account.last_login_at)+' · '+account.login_count+' כניסות':'טרם נכנס');}
  if(!eligible())s+=' · הגישה אפשרית רק לעסק פעיל עם הסכם חתום';
  summary.textContent=lastError||s;summary.style.color=lastError?'#a33':'';
  controls.innerHTML=exists()?`${account.status==='active'&&eligible()?`<button type="button" data-portal-preview>צפייה כבעל העסק</button>`:''}${account.status==='active'?`<button type="button" data-portal-open>${account.pending?'יצירת סיסמה ושליחה ב-WhatsApp':'איפוס סיסמה ושליחה ב-WhatsApp'}</button>${(m=>m.show?`<button type="button" data-portal-email ${m.enabled?'':'disabled aria-describedby="portalEmailNote"'}>שליחה במייל</button>${m.enabled?'':`<span id="portalEmailNote" data-portal-email-note style="align-self:center;font-size:.85rem;color:#a33">${esc(m.note)}</span>`}`:'')(emailState(biz,eligible()?account:null))}<button type="button" data-portal-block>חסימת החשבון</button>`:`<button type="button" data-portal-unblock ${!eligible()?'disabled':''}>הפעלת החשבון</button>`}<button type="button" data-portal-delete>מחיקת חשבון הפורטל</button><a href="portal-admin.html?business_id=${encodeURIComponent(biz.id)}" style="align-self:center">ניהול הפורטל של העסק ←</a>`:'';
  if(busy)controls.querySelectorAll('button').forEach(b=>b.disabled=true);
  const lt=emailLogText(emailLog);logLine.hidden=!lt;logLine.textContent=lt;logLine.style.color=emailLog&&emailLog.details?.status!=='sent'?'#a33':'#1e6b45';
 };
 // Last email attempt for this business, from the existing audit_log (admin/manager can read it).
 const loadEmailLog=async()=>{try{const r=await window.supabaseClient.from('audit_log').select('occurred_at,details').eq('action',EMAIL_LOG_ACTION).eq('record_id',biz.id).order('occurred_at',{ascending:false}).limit(1);emailLog=r.error?null:(r.data||[])[0]||null;}catch(_){emailLog=null;}};
 const reload=async()=>{const d=await api('admin_detail',{business_id:biz.id});account=d.account;await loadEmailLog();draw();
  // 08.10.2026: lets the business list update its «מחובר לפורטל» tag (display only).
  try{window.dispatchEvent(new CustomEvent('bsd:seller-portal-changed',{detail:{businessId:biz.id,active:!!account&&account.status==='active'&&!account.pending}}));}catch(_){}
 };
 const open=async tab=>{const d=await api('admin_open',{business_id:biz.id});credBox.innerHTML=credentialsHtml(d);if(!sendTo(tab,d)&&invite().waUrl(d))credBox.querySelector('[data-portal-wa]')?.focus();await reload();};
 // «מייל» chosen: open the account, then the existing email action sends the login details. If the
 // email fails, the password from the opening stays the working one and is shown (WhatsApp fallback).
 const openWith=async({wa,mail,tab})=>{
  if(!mail)return open(tab);
  const d=await api('admin_open',{business_id:biz.id});
  let to='';try{to=(await api('admin_email_access',{business_id:biz.id})).to||String(biz.owner_email||'').trim();}
  catch(e){credBox.innerHTML=credentialsHtml(d);if(wa){if(!sendTo(tab,d)&&invite().waUrl(d))credBox.querySelector('[data-portal-wa]')?.focus();}await reload();lastError=e.message;return;}
  credBox.innerHTML=mailSentHtml(d,to,wa);if(wa){const link=invite().waUrl(mailNoticeData(d,to));if(tab&&link)tab.location.replace(link);else tab?.close();}
  await reload();
 };
 const run=async(fn,tab=null)=>{lastError='';busy=true;draw();try{await fn();}catch(e){tab?.close();lastError=e.message;}finally{busy=false;draw();}};
 checkbox.onchange=async()=>{if(busy)return;const on=checkbox.checked;
  if(on&&(!exists()||account.pending)){checkbox.checked=false;const pick=await chooseChannels(biz,{reserve:true});if(!pick){draw();return;}checkbox.checked=true;run(()=>openWith(pick),pick.tab);}
  else if(on)run(async()=>{await api('admin_status',{business_id:biz.id,status:'active'});await reload();});
  else run(async()=>{await api('admin_status',{business_id:biz.id,status:'blocked'});credBox.replaceChildren();await reload();});
 };
 root.addEventListener('click',async e=>{
  const copy=e.target.closest('[data-portal-copy]');if(copy){const t=root.querySelector('[data-portal-invite]');try{await navigator.clipboard.writeText(t.value);copy.textContent='ההודעה הועתקה';}catch(_){t.select();}return;}
  const button=e.target.closest('[data-portal-controls] button');if(!button||busy)return;
  if(button.hasAttribute('data-portal-preview')){const tab=reserveTab();run(async()=>{const d=await api('admin_preview',{business_id:biz.id});const url=String(d.portal_url||'').replace(/#.*$/,'')+'#preview='+d.token;if(tab)tab.location.replace(url);else location.assign(url);},tab);}
  else if(button.hasAttribute('data-portal-open')){if(!account.pending&&!confirm('ליצור סיסמה חדשה? הסיסמה הקודמת תפסיק לעבוד מיד.'))return;const tab=reserveTab();run(()=>open(tab),tab);}
  else if(button.hasAttribute('data-portal-email')){const m=emailState(biz,account);if(!m.enabled)return;
   if(!await confirmEmail(biz,m.email,account.username))return;
   run(async()=>{try{await api('admin_email_access',{business_id:biz.id});credBox.replaceChildren();}finally{await reload();}});}
  else if(button.hasAttribute('data-portal-block'))run(async()=>{await api('admin_status',{business_id:biz.id,status:'blocked'});credBox.replaceChildren();await reload();});
  else if(button.hasAttribute('data-portal-unblock'))run(async()=>{await api('admin_status',{business_id:biz.id,status:'active'});await reload();});
  else if(button.hasAttribute('data-portal-delete')){if(!confirm('למחוק את חשבון הפורטל בלבד? כרטיס העסק וכל הקבצים יישארו.'))return;run(async()=>{await api('admin_delete',{business_id:biz.id});credBox.replaceChildren();await reload();});}
 });
 try{await reload();}catch(error){checkbox.disabled=true;summary.textContent=error.message;}
}
// New business saved with the box checked: open the account and show the ready message.
async function afterSave(id,requested){
 if(!requested)return;
 let info={};try{const r=await window.supabaseClient.from('businesses').select('internal_name,owner_email').eq('id',id).maybeSingle();info=r.data||{};}catch(_){info={};}
 const pick=await chooseChannels(info);if(!pick)return;
 const d=await api('admin_open',{business_id:id});
 let body=credentialsHtml(d);
 if(pick.mail){try{const to=(await api('admin_email_access',{business_id:id})).to||String(info.owner_email||'').trim();body=mailSentHtml(d,to,pick.wa);}catch(e){body=`<p role="alert" style="color:#a33;margin:0 0 6px">${esc(e.message)}</p>`+credentialsHtml(d);}}
 const dialog=document.createElement('dialog');dialog.style.cssText='max-width:520px;width:calc(100% - 32px);padding:22px;direction:rtl;border-radius:12px';
 dialog.innerHTML=`<h3 style="margin-top:0">העסק נשמר ונפתח חשבון בפורטל</h3>${body}<p><button type="button" data-close>סגירה</button></p>`;
 dialog.addEventListener('click',async e=>{if(e.target.closest('[data-close]'))dialog.close();if(e.target.closest('[data-portal-copy]')){try{await navigator.clipboard.writeText(dialog.querySelector('textarea').value);e.target.textContent='ההודעה הועתקה';}catch(_){}}});
 dialog.onclose=()=>dialog.remove();document.body.append(dialog);dialog.showModal();
}
window.BSDSellerPortal={markup,mount,afterSave,api,emailState,emailConfirmHtml,emailLogText,validEmail,channelChoiceHtml,mailNoticeData};
})();
