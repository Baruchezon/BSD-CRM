// Seller portal controls inside the CRM business card (admin/manager only; the
// API enforces the same rule). v2 (04.10.2026): checking "פתח חשבון בפורטל"
// opens the account in one click: the server creates a username and a random
// password, and a ready WhatsApp message opens for BSD to send. Nothing is ever
// sent automatically.
(()=>{'use strict';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const when=v=>v?new Date(v).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}):'';
const ERRORS={email_missing:'אין מייל תקין בכרטיס העסק',sender_not_ready:'שליחת מיילים מהכתובת baruch@bsd-bbi.co.il עדיין לא הופעלה. המייל לא נשלח והסיסמה לא השתנתה',send_failed:'המייל לא נשלח והסיסמה לא השתנתה. אפשר לנסות שוב או לשלוח ב-WhatsApp',sent_not_saved:'המייל נשלח אבל הסיסמה החדשה לא נשמרה. הסיסמה הקודמת עדיין עובדת. יש ללחוץ שוב על «שליחה במייל»',try_later:'נשלחו כמה מיילים ברצף. אפשר לנסות שוב בעוד רבע שעה',invalid_action:'הפעולה עדיין לא הופעלה בשרת. המייל לא נשלח',signed_agreement_required:'נדרש עסק פעיל עם הסכם חתום',account_required:'אין חשבון פורטל לעסק זה',status_unavailable:'לא הצלחנו לבדוק כרגע את מצב המסירה. אפשר לנסות שוב בעוד רגע',no_resend_id:'למייל הזה אין מספר שליחה, ולכן אין מצב מסירה',not_found:'הרשומה לא נמצאה',preview_unavailable:'החשבון אינו פתוח לצפייה. נדרש חשבון פורטל פעיל לעסק עם הסכם חתום'};
async function api(action,payload={}){
 const url=window.BSD_CONFIG.SELLER_PORTAL_API_URL;if(!url)throw Error('שירות הפורטל טרם הופעל. פרטי העסק נשמרים כרגיל');
 const {data:{session}}=await window.supabaseClient.auth.getSession();if(!session)throw Error('יש להתחבר למערכת');
 let r;try{r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.access_token},body:JSON.stringify({action,...payload})});}catch(_){throw Object.assign(Error('אין חיבור לשרת. בודקים את האינטרנט ומנסים שוב'),{code:'network'});}
 const d=await r.json().catch(()=>({}));
 if(!r.ok)throw Object.assign(Error(ERRORS[d.error]||'פעולת הפורטל לא הושלמה'),{code:d.error||'http_'+r.status,reason:d.reason||''});return d;
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
// 08.10.2026 (ברוך, תיקון): before ANY portal email (the «שליחה במייל» button and the «מייל» option of
// «פתח חשבון בפורטל») the FULL email is shown as the owner will get it: from, to, BCC copy, subject and
// body, rendered by the server from the same template (admin_email_preview; the password is a
// placeholder because it is created only at send time). Nothing is sent before «אישור ושליחה».
// After every send a result window always says «✅ נשלח מייל» or «❌ לא נשלח», from Resend's answer
// plus a follow-up delivery check (admin_email_status). The card lists «מיילים שנשלחו» from audit_log.
const EMAIL_STATUS_ACTION='portal_access_email_status';
const PENDING_EVENTS=['queued','scheduled','sent','delivery_delayed'],BAD_EVENTS=['bounced','failed','canceled'];
const DELIVERY={queued:['⏳','בתור לשליחה'],scheduled:['⏳','מתוזמן לשליחה'],sent:['📤','יצא מהשרת, עדיין אין אישור מסירה'],delivery_delayed:['⏳','המסירה מתעכבת'],delivered:['✅','נמסר לתיבת הנמען'],opened:['✅','נמסר ונפתח'],clicked:['✅','נמסר, והנמען לחץ על קישור'],bounced:['❌','נדחה: הכתובת לא קיימת או שהתיבה לא מקבלת מיילים'],complained:['⚠️','נמסר, והנמען סימן אותו כספאם'],failed:['❌','השליחה נכשלה'],canceled:['❌','השליחה בוטלה']};
const deliveryText=ev=>{const x=DELIVERY[ev];return x?`${x[0]} ${x[1]}`:(ev?`מצב: ${ev}`:'');};
// Provider reasons come in English; the common ones get a short Hebrew line.
function reasonText(reason){
 const r=String(reason||'');if(!r)return '';
 if(r==='network_error')return 'אין חיבור לשירות המיילים';
 if(/not verified|verify/i.test(r))return 'כתובת השולח לא מאומתת בשירות המיילים';
 if(/rate|too many/i.test(r))return 'יותר מדי מיילים בזמן קצר';
 if(/api key|unauthori[sz]ed|forbidden/i.test(r))return 'מפתח השליחה לא תקין';
 if(/invalid.*(to|email|recipient)|recipient/i.test(r))return 'כתובת המייל של הנמען לא תקינה';
 return 'שירות המיילים דחה את השליחה';
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const row=(k,v)=>`<p style="margin:0;padding:6px 0;border-bottom:1px solid #eee;text-align:right;line-height:1.5"><span style="color:#555">${esc(k)}:</span> <b style="overflow-wrap:anywhere">${v}</b></p>`;
const ltr=v=>`<span dir="ltr" style="unicode-bidi:isolate">${esc(v)}</span>`;
// «צוות BSD <baruch@bsd-bbi.co.il>»: Hebrew name, then the address left-to-right.
const fromHtml=v=>{const m=/^(.*?)\s*<([^<>]+)>\s*$/.exec(String(v||''));return m?`${esc(m[1])} ${ltr('<'+m[2]+'>')}`:ltr(v);};
// The email body in a fully sandboxed frame (no scripts, no forms), exactly as the HTML the owner gets.
const bodyFrame=(html,h)=>`<iframe data-email-body sandbox="" title="תוכן המייל" srcdoc="${esc(html)}" style="display:block;width:100%;height:${h};border:1px solid #d5dbe3;border-radius:8px;background:#f3f5f8"></iframe>`;
const BTN='min-height:44px;padding:8px 18px;border-radius:8px';
const DLG='max-width:620px;width:calc(100% - 24px);max-height:calc(100% - 24px);overflow:auto;padding:16px;direction:rtl;border-radius:12px;border:1px solid #c9a854;box-sizing:border-box';
// d = admin_email_preview answer.
function emailPreviewHtml(d,biz){
 return `<h3 style="margin:0 0 8px">בדיקת המייל לפני שליחה</h3>
 <div style="margin:0 0 10px">${biz?.internal_name?row('העסק',esc(biz.internal_name)):''}${row('מאת',fromHtml(d.from))}${row('אל',ltr(d.to))}${d.bcc?row('עותק מוסתר (BCC)',ltr(d.bcc)):''}${row('נושא',esc(d.subject))}</div>
 <p style="margin:0 0 6px;font-weight:700">כך המייל ייראה אצל בעל העסק:</p>
 ${bodyFrame(d.html,'min(42vh,380px)')}
 <p style="margin:8px 0;font-size:.9rem;line-height:1.5;background:#f7f9fb;border-radius:8px;padding:8px 10px">הסיסמה נוצרת רק ברגע השליחה, ולכן כאן כתוב במקומה «${esc(d.password_note||'')}». במייל עצמו תופיע הסיסמה האמיתית.</p>
 ${d.username_known?`<p data-new-password-warning style="margin:0 0 10px;font-size:.95rem;line-height:1.5;background:#fff4e5;border:1px solid #e8b25a;color:#7a4a00;border-radius:8px;padding:8px 10px;font-weight:700">⚠️ בשליחה תיווצר סיסמה חדשה, והסיסמה הקודמת תפסיק לעבוד.</p>`:''}
 <p style="display:flex;gap:8px;flex-wrap:wrap;margin:0;position:sticky;bottom:-16px;background:#fff;padding:8px 0 10px;border-top:1px solid #eee"><button type="button" data-email-send style="${BTN};font-weight:700;background:#0f2a44;color:#fff;border:0">אישור ושליחה</button><button type="button" data-email-cancel style="${BTN}">ביטול</button></p>`;
}
// Shows the server preview, resolves {tab} after «אישור ושליחה» or null on «ביטול»/Esc/error.
// With reserve, the WhatsApp tab is reserved inside the «אישור ושליחה» click.
function previewAndConfirm(businessId,biz,{reserve=false}={}){return new Promise(resolve=>{
 const dialog=document.createElement('dialog');dialog.setAttribute('data-portal-email-confirm','');dialog.style.cssText=DLG;
 dialog.innerHTML='<p role="status" style="margin:0">⏳ טוען את תוכן המייל...</p>';let pick=null;
 dialog.addEventListener('click',e=>{if(e.target.closest('[data-email-send]')){pick={tab:reserve?reserveTab():null};dialog.close();}else if(e.target.closest('[data-email-cancel],[data-close]'))dialog.close();});
 dialog.onclose=()=>{dialog.remove();resolve(pick);};document.body.append(dialog);dialog.showModal();
 api('admin_email_preview',{business_id:businessId}).then(d=>{if(dialog.open)dialog.innerHTML=emailPreviewHtml(d,biz);})
  .catch(e=>{if(dialog.open)dialog.innerHTML=`<h3 style="margin:0 0 8px">❌ לא נשלח</h3><p role="alert" style="margin:0 0 12px;color:#a33">${esc(e.message)}</p><p style="margin:0"><button type="button" data-close style="${BTN}">סגירה</button></p>`;});
});}
// Result window. s.phase: sending | checking | status | failed.
function mailResultHtml(s){
 const box=(color,bg,inner)=>`<div style="padding:12px;border:2px solid ${color};border-radius:10px;background:${bg}">${inner}</div>`;
 const close=`<p style="margin:12px 0 0"><button type="button" data-close style="${BTN};font-weight:700">סגירה</button></p>`;
 if(s.phase==='sending')return box('#c9a854','#fffdf5','<p role="status" style="margin:0;font-size:1.1rem;font-weight:700">⏳ שולח את המייל...</p>');
 if(s.phase==='failed'){
  const e=s.error||{},why=e.code==='network'?'לא התקבלה תשובה מהשרת. ייתכן שהמייל יצא בכל זאת: בודקים ברשימה «מיילים שנשלחו» בכרטיס.':e.message,r=reasonText(e.reason);
  return box('#a33','#fff5f5',`<p role="alert" style="margin:0 0 6px;font-size:1.25rem;font-weight:700;color:#a33">❌ לא נשלח</p><p style="margin:0;line-height:1.6">${esc(why)}</p>${r?`<p style="margin:6px 0 0;line-height:1.6">סיבה: ${esc(r)} <small dir="ltr" style="color:#777">(${esc(e.reason)})</small></p>`:''}`)+close;
 }
 const d=s.res||{},who=`<p style="margin:6px 0 0;line-height:1.6">אל: ${ltr(d.to)}</p>${d.bcc?`<p style="margin:2px 0 0;line-height:1.6;font-size:.9rem;color:#444">עותק נשלח אל: ${ltr(d.bcc)}</p>`:''}`;
 if(s.phase==='checking')return box('#c9a854','#fffdf5',`<p role="status" style="margin:0;font-size:1.1rem;font-weight:700">⏳ שירות המיילים קיבל את המייל. בודק מסירה...</p>${who}`);
 if(BAD_EVENTS.includes(s.event))return box('#a33','#fff5f5',`<p role="alert" style="margin:0 0 6px;font-size:1.25rem;font-weight:700;color:#a33">❌ לא נשלח</p><p style="margin:0">${esc(deliveryText(s.event))}</p>${who}<p style="margin:6px 0 0;font-size:.9rem;line-height:1.5">הסיסמה החדשה כבר נשמרה. אפשר לבדוק את המייל בכרטיס ולשלוח שוב, או ללחוץ «איפוס סיסמה ושליחה ב-WhatsApp».</p>`)+close;
 const st=s.event?`מצב מסירה: ${esc(deliveryText(s.event))}${PENDING_EVENTS.includes(s.event)?' · ממשיך לבדוק':''}${s.checked_at?` <small style="color:#555">(נבדק ${esc(when(s.checked_at))})</small>`:''}`:`מצב מסירה: לא הצלחנו לבדוק כרגע. אפשר ללחוץ «רענון מצב» ברשימה «מיילים שנשלחו».`;
 return box('#1e6b45','#f2fbf5',`<p role="status" style="margin:0 0 6px;font-size:1.25rem;font-weight:700;color:#1e6b45">✅ נשלח מייל</p>${who}<p data-mail-delivery style="margin:6px 0 0;line-height:1.6">${st}</p>`)+close;
}
// Sends through admin_email_access, then checks delivery (2.5s, then up to ~30s while it is still
// on its way). Always ends with ✅ or ❌ on screen. onChange refreshes the card list.
async function sendAndReport(businessId,onChange){
 const dialog=document.createElement('dialog');dialog.setAttribute('data-portal-mail-result','');dialog.setAttribute('aria-live','polite');dialog.style.cssText=DLG.replace('max-width:620px','max-width:460px');
 let state={phase:'sending'};const set=s=>{state=s;if(dialog.isConnected)dialog.innerHTML=mailResultHtml(s);};
 const closed=new Promise(r=>{dialog.onclose=()=>{dialog.remove();r();};});
 dialog.addEventListener('click',e=>{if(e.target.closest('[data-close]'))dialog.close();});
 dialog.addEventListener('cancel',e=>{if(state.phase==='sending')e.preventDefault();});
 document.body.append(dialog);set(state);dialog.showModal();
 let res;
 try{res=await api('admin_email_access',{business_id:businessId});}
 catch(error){set({phase:'failed',error});try{await onChange?.();}catch(_){}return {ok:false,error,closed};}
 set({phase:'checking',res});
 const check=async()=>{try{const s=await api('admin_email_status',{business_id:businessId,log_id:res.log_id});set({phase:'status',res,event:s.last_event,checked_at:s.checked_at});return s.last_event;}catch(_){if(state.phase!=='status'||!state.event)set({phase:'status',res});return '';}finally{try{await onChange?.();}catch(_){}}};
 await sleep(2500);const first=await check();
 if(!first||PENDING_EVENTS.includes(first))(async()=>{for(const ms of [4000,8000,15000]){await sleep(ms);if(!dialog.isConnected&&!onChange)return;const ev=await check();if(ev&&!PENDING_EVENTS.includes(ev))return;}})();
 return {ok:true,data:res,event:first,closed};
}
// «מיילים שנשלחו»: rows = audit_log portal_access_email (+ newest portal_access_email_status per send).
function sentRows(rows){
 const latest={};for(const r of rows||[])if(r.action===EMAIL_STATUS_ACTION){const id=r.details?.log_id;if(id&&(!latest[id]||String(r.details?.checked_at||r.occurred_at)>String(latest[id].details?.checked_at||latest[id].occurred_at)))latest[id]=r;}
 return (rows||[]).filter(r=>r.action===EMAIL_LOG_ACTION).sort((a,b)=>String(b.occurred_at).localeCompare(String(a.occurred_at))).map(r=>({...r,delivery:latest[r.id]?.details?.last_event||'',checked_at:latest[r.id]?.details?.checked_at||''}));
}
function sendStatusText(r){
 const d=r.details||{};
 if(d.status==='sent'){if(BAD_EVENTS.includes(r.delivery))return '❌ לא נמסר · '+deliveryText(r.delivery);return '✅ נשלח'+(r.delivery?' · '+deliveryText(r.delivery):' · מצב מסירה לא נבדק עדיין');}
 if(d.status==='sent_not_saved')return '⚠️ נשלח, אבל הסיסמה החדשה לא נשמרה (הקודמת עדיין עובדת)';
 return '❌ לא נשלח'+(d.reason?' · '+(d.reason==='sender_not_ready'?'שליחת המיילים לא הופעלה':reasonText(d.reason)):'');
}
function sentListHtml(rows,{open=false}={}){
 if(!rows.length)return '';
 const item=r=>{const d=r.details||{},bad=d.status!=='sent'||BAD_EVENTS.includes(r.delivery);
  return `<li data-mail-row="${esc(r.id)}" style="list-style:none;margin:0 0 6px;padding:8px 10px;border:1px solid #e3e8ee;border-radius:8px;background:#fff">
  <div style="display:flex;flex-wrap:wrap;gap:4px 10px;line-height:1.5"><b>${esc(when(r.occurred_at))}</b><span>אל ${ltr(d.to||'')}</span></div>
  <div style="line-height:1.5;color:#333;overflow-wrap:anywhere">נושא: ${esc(d.subject||'(לא נשמר)')}</div>
  <div data-mail-status style="line-height:1.5;font-weight:700;color:${bad?'#a33':'#1e6b45'}">${esc(sendStatusText(r))}${r.checked_at?` <small style="font-weight:400;color:#555">(נבדק ${esc(when(r.checked_at))})</small>`:''}</div>
  <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px">${d.resend_id?`<button type="button" data-mail-refresh="${esc(r.id)}" style="min-height:36px">רענון מצב</button>`:''}<button type="button" data-mail-view="${esc(r.id)}" style="min-height:36px">צפייה במייל</button></div></li>`;};
 const first=rows.slice(0,3),rest=rows.slice(3);
 return `<div data-portal-sent style="margin:10px 0 6px;padding:10px;border:1px solid #e3e8ee;border-radius:10px;background:#f7f9fb"><h4 style="margin:0 0 8px;font-size:1rem">מיילים שנשלחו (${rows.length})</h4>
 <ul style="margin:0;padding:0">${first.map(item).join('')}</ul>${rest.length?`<details ${open?'open':''} data-mail-more><summary style="cursor:pointer;min-height:32px">עוד ${rest.length}</summary><ul style="margin:6px 0 0;padding:0">${rest.map(item).join('')}</ul></details>`:''}
 <small style="display:block;color:#555;line-height:1.5">עותק מכל מייל נשלח גם לתיבה baruch@bsd-bbi.co.il. הסיסמה לא נשמרת במערכת.</small></div>`;
}
function mailViewHtml(r){
 const d=r.details||{};
 const body=d.body_html?bodyFrame(d.body_html,'min(55vh,440px)'):d.body_text?`<pre style="white-space:pre-wrap;font-family:inherit;margin:0;padding:10px;border:1px solid #d5dbe3;border-radius:8px;background:#fff;max-height:50vh;overflow:auto">${esc(d.body_text)}</pre>`:`<p style="margin:0;padding:10px;border-radius:8px;background:#f7f9fb;line-height:1.6">התוכן של מייל זה לא נשמר, כי הוא נשלח לפני העדכון. נשלחו בו: קישור לאתר BSD, שם המשתמש <b dir="ltr">${esc(d.username||'')}</b> וסיסמה חדשה.</p>`;
 return `<h3 style="margin:0 0 8px">המייל שנשלח</h3><div style="margin:0 0 10px">${row('מתי',esc(when(r.occurred_at)))}${row('מאת',fromHtml(d.from?`צוות BSD <${d.from}>`:''))}${row('אל',ltr(d.to||''))}${d.bcc?row('עותק מוסתר (BCC)',ltr(d.bcc)):''}${row('נושא',esc(d.subject||'(לא נשמר)'))}${row('מצב',esc(sendStatusText(r)))}</div>
 ${body}<p style="margin:8px 0 0;font-size:.85rem;color:#555">הסיסמה מוסתרת: היא לא נשמרת במערכת.</p><p style="margin:10px 0 0"><button type="button" data-close style="${BTN}">סגירה</button></p>`;
}
function showMailView(r){const dialog=document.createElement('dialog');dialog.setAttribute('data-portal-mail-view','');dialog.style.cssText=DLG;dialog.innerHTML=mailViewHtml(r);dialog.addEventListener('click',e=>{if(e.target.closest('[data-close]'))dialog.close();});dialog.onclose=()=>dialog.remove();document.body.append(dialog);dialog.showModal();}
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
// reserved inside that click (as before), so the browser does not block it; when «מייל» is chosen too,
// it is reserved in the «אישור ושליחה» click of the email preview instead.
function chooseChannels(biz,{reserve=false}={}){return new Promise(resolve=>{
 const dialog=document.createElement('dialog');dialog.setAttribute('data-portal-open-choice','');dialog.style.cssText='max-width:440px;width:calc(100% - 32px);max-height:calc(100% - 32px);overflow:auto;padding:20px;direction:rtl;border-radius:12px;border:1px solid #c9a854;box-sizing:border-box';
 dialog.innerHTML=channelChoiceHtml(biz);let pick=null;
 const wa=dialog.querySelector('[data-ch-wa]'),mail=dialog.querySelector('[data-ch-mail]'),none=dialog.querySelector('[data-ch-none]'),okBtn=dialog.querySelector('[data-ch-ok]');
 const sync=()=>{const any=wa.checked||(mail.checked&&!mail.disabled);okBtn.disabled=!any;none.hidden=any;};
 dialog.addEventListener('change',sync);
 dialog.addEventListener('click',e=>{
  if(e.target.closest('[data-ch-ok]')){const w=wa.checked,m=mail.checked&&!mail.disabled;if(!w&&!m){sync();return;}pick={wa:w,mail:m,tab:w&&!m&&reserve?reserveTab():null};dialog.close();}
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
function markup(biz){return `<section id="sellerPortalCard" class="field full" style="padding:14px;border:1px solid #c9a854;border-radius:10px;background:#fffdf5"><h3 class="section-h">פורטל בעלי עסקים</h3><label style="display:flex;gap:8px;align-items:center;font-weight:700"><input type="checkbox" id="sellerPortalEnabled" style="width:auto">פתח חשבון בפורטל</label><p data-portal-summary role="status" style="margin:6px 0">${biz?'טוען את מצב חשבון הפורטל...':'לאחר שמירת עסק פעיל עם הסכם חתום תופיע בחירה: שליחת פרטי הכניסה בוואטסאפ, במייל או בשניהם.'}</p><div data-portal-credentials></div><div data-portal-controls style="display:flex;gap:8px;flex-wrap:wrap"></div><div data-portal-email-list></div><small>מחיקת חשבון הפורטל משאירה את כרטיס העסק ואת הקבצים שלו. העברה לארכיון או ביטול ההסכם חוסמים את הגישה אוטומטית.</small></section>`;}
// Opens a blank tab synchronously (inside the click) so the browser allows it,
// then points it at wa.me once the server answered.
function reserveTab(){const w=window.open('about:blank','_blank');if(w){try{w.opener=null;w.document.body.innerHTML='<p dir="rtl" style="font-family:Arial;padding:30px">מכין את הודעת ה-WhatsApp...</p>';}catch(_){}}return w;}
function sendTo(tab,d){const wa=invite().waUrl(d);if(tab&&wa){tab.location.replace(wa);return true;}if(tab)tab.close();return false;}
async function mount(biz){
 const root=document.getElementById('sellerPortalCard');if(!root)return;
 const checkbox=root.querySelector('#sellerPortalEnabled');
 if(!biz){const agreement=document.getElementById('agreement_status');const sync=()=>{checkbox.disabled=agreement?.value!=='יש הסכם חתום';if(checkbox.disabled)checkbox.checked=false;};agreement?.addEventListener('change',sync);sync();return;}
 let account=null,busy=false,lastError='',emailRows=[],autoChecked=false;
 const listBox=root.querySelector('[data-portal-email-list]'),summary=root.querySelector('[data-portal-summary]'),controls=root.querySelector('[data-portal-controls]'),credBox=root.querySelector('[data-portal-credentials]');
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
  drawList();
 };
 // «מיילים שנשלחו»: portal emails of this business from the existing audit_log (admin/manager can read it).
 const drawList=()=>{const open=!!listBox.querySelector('[data-mail-more][open]');listBox.innerHTML=sentListHtml(emailRows,{open});};
 const loadEmailLog=async()=>{try{const r=await window.supabaseClient.from('audit_log').select('id,action,occurred_at,details').in('action',[EMAIL_LOG_ACTION,EMAIL_STATUS_ACTION]).eq('record_id',biz.id).order('occurred_at',{ascending:false}).limit(80);emailRows=r.error?[]:sentRows(r.data||[]);}catch(_){emailRows=[];}};
 const refreshList=async()=>{await loadEmailLog();drawList();};
 const refreshStatus=async(id,button)=>{if(button){button.disabled=true;button.textContent='בודק...';}
  let note='';try{await api('admin_email_status',{business_id:biz.id,log_id:id});}catch(e){note=e.message;}
  await refreshList();if(note){const st=listBox.querySelector(`[data-mail-row="${CSS.escape(id)}"] [data-mail-status]`);if(st){st.insertAdjacentHTML('beforeend',`<small role="alert" style="display:block;font-weight:400;color:#a33">${esc(note)}</small>`);}}};
 // Once per card: recent sends (48h) without a final delivery status are checked automatically.
 const autoCheck=async()=>{if(autoChecked)return;autoChecked=true;const recent=emailRows.filter(r=>r.details?.status==='sent'&&r.details?.resend_id&&(!r.delivery||PENDING_EVENTS.includes(r.delivery))&&Date.now()-Date.parse(r.occurred_at)<48*3600000).slice(0,3);
  for(const r of recent){try{await api('admin_email_status',{business_id:biz.id,log_id:r.id});}catch(_){}}if(recent.length)await refreshList();};
 const reload=async()=>{const d=await api('admin_detail',{business_id:biz.id});account=d.account;await loadEmailLog();draw();autoCheck();
  // 08.10.2026: lets the business list update its «מחובר לפורטל» tag (display only).
  try{window.dispatchEvent(new CustomEvent('bsd:seller-portal-changed',{detail:{businessId:biz.id,active:!!account&&account.status==='active'&&!account.pending}}));}catch(_){}
 };
 const open=async tab=>{const d=await api('admin_open',{business_id:biz.id});credBox.innerHTML=credentialsHtml(d);if(!sendTo(tab,d)&&invite().waUrl(d))credBox.querySelector('[data-portal-wa]')?.focus();await reload();};
 // «מייל» chosen (after the email preview was approved): open the account, then the existing email action
 // sends the login details with the ✅/❌ result window. If the email fails, the password from the opening
 // stays the working one and is shown (WhatsApp fallback).
 const openWith=async({wa,mail,tab})=>{
  if(!mail)return open(tab);
  const d=await api('admin_open',{business_id:biz.id});
  const sent=await sendAndReport(biz.id,refreshList);
  if(!sent.ok){credBox.innerHTML=credentialsHtml(d);if(wa){if(!sendTo(tab,d)&&invite().waUrl(d))credBox.querySelector('[data-portal-wa]')?.focus();}await reload();lastError=sent.error.message;return;}
  const to=sent.data.to||String(biz.owner_email||'').trim();
  credBox.innerHTML=mailSentHtml(d,to,wa);if(wa){const link=invite().waUrl(mailNoticeData(d,to));if(tab&&link)tab.location.replace(link);else tab?.close();}
  await reload();if(BAD_EVENTS.includes(sent.event))lastError='המייל נדחה ולא נמסר. אפשר ללחוץ «איפוס סיסמה ושליחה ב-WhatsApp»';
 };
 const run=async(fn,tab=null)=>{lastError='';busy=true;draw();try{await fn();}catch(e){tab?.close();lastError=e.message;}finally{busy=false;draw();}};
 checkbox.onchange=async()=>{if(busy)return;const on=checkbox.checked;
  if(on&&(!exists()||account.pending)){checkbox.checked=false;const pick=await chooseChannels(biz,{reserve:true});if(!pick){draw();return;}
   if(pick.mail){const ok=await previewAndConfirm(biz.id,biz,{reserve:pick.wa});if(!ok){draw();return;}pick.tab=ok.tab;}
   checkbox.checked=true;run(()=>openWith(pick),pick.tab);}
  else if(on)run(async()=>{await api('admin_status',{business_id:biz.id,status:'active'});await reload();});
  else run(async()=>{await api('admin_status',{business_id:biz.id,status:'blocked'});credBox.replaceChildren();await reload();});
 };
 root.addEventListener('click',async e=>{
  const refresh=e.target.closest('[data-mail-refresh]');if(refresh){refreshStatus(refresh.getAttribute('data-mail-refresh'),refresh);return;}
  const view=e.target.closest('[data-mail-view]');if(view){const r=emailRows.find(x=>x.id===view.getAttribute('data-mail-view'));if(r)showMailView(r);return;}
  const copy=e.target.closest('[data-portal-copy]');if(copy){const t=root.querySelector('[data-portal-invite]');try{await navigator.clipboard.writeText(t.value);copy.textContent='ההודעה הועתקה';}catch(_){t.select();}return;}
  const button=e.target.closest('[data-portal-controls] button');if(!button||busy)return;
  if(button.hasAttribute('data-portal-preview')){const tab=reserveTab();run(async()=>{const d=await api('admin_preview',{business_id:biz.id});const url=String(d.portal_url||'').replace(/#.*$/,'')+'#preview='+d.token;if(tab)tab.location.replace(url);else location.assign(url);},tab);}
  else if(button.hasAttribute('data-portal-open')){if(!account.pending&&!confirm('ליצור סיסמה חדשה? הסיסמה הקודמת תפסיק לעבוד מיד.'))return;const tab=reserveTab();run(()=>open(tab),tab);}
  else if(button.hasAttribute('data-portal-email')){const m=emailState(biz,account);if(!m.enabled)return;
   if(!await previewAndConfirm(biz.id,biz))return;
   run(async()=>{try{await sendAndReport(biz.id,refreshList);credBox.replaceChildren();}finally{await reload();}});}
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
 if(pick.mail&&!await previewAndConfirm(id,info))return;
 const d=await api('admin_open',{business_id:id});
 let body=credentialsHtml(d);
 if(pick.mail){const sent=await sendAndReport(id,null);await sent.closed;body=sent.ok?mailSentHtml(d,sent.data.to||String(info.owner_email||'').trim(),pick.wa):`<p role="alert" style="color:#a33;margin:0 0 6px">❌ המייל לא נשלח: ${esc(sent.error.message)}</p>`+credentialsHtml(d);}
 const dialog=document.createElement('dialog');dialog.style.cssText='max-width:520px;width:calc(100% - 32px);padding:22px;direction:rtl;border-radius:12px';
 dialog.innerHTML=`<h3 style="margin-top:0">העסק נשמר ונפתח חשבון בפורטל</h3>${body}<p><button type="button" data-close>סגירה</button></p>`;
 dialog.addEventListener('click',async e=>{if(e.target.closest('[data-close]'))dialog.close();if(e.target.closest('[data-portal-copy]')){try{await navigator.clipboard.writeText(dialog.querySelector('textarea').value);e.target.textContent='ההודעה הועתקה';}catch(_){}}});
 dialog.onclose=()=>dialog.remove();document.body.append(dialog);dialog.showModal();
}
window.BSDSellerPortal={markup,mount,afterSave,api,emailState,emailPreviewHtml,mailResultHtml,sentRows,sentListHtml,sendStatusText,mailViewHtml,deliveryText,reasonText,validEmail,channelChoiceHtml,mailNoticeData};
})();
