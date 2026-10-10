// «דוחות פעילות שיווקית – סטטוס» (spec G6, 10.10.2026). Read-only, admin/manager only.
// RLS on marketing_report_runs (mrr_admin_manager_select) is the real guard; the role check here only picks the message.
(function(){
 const body=document.getElementById('mrBody');
 const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!=null)e.textContent=String(text);if(cls)e.className=cls;return e;};
 const msg=t=>{body.replaceChildren(el('p',t,'muted'));};
 const period=(f,t)=>{const a=/^(\d{4})-(\d{2})-(\d{2})/.exec(String(f||'')),b=/^(\d{4})-(\d{2})-(\d{2})/.exec(String(t||''));return a&&b?`${a[3]}.${a[2]}–${b[3]}.${b[2]}.${b[1]}`:'—';};
 const when=v=>v?new Date(v).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem',dateStyle:'short',timeStyle:'short'}):'—';
 const PDF={stored:['נשמר','mr-ok'],missing:['חסר','mr-bad']};
 const PORTAL={uploaded_verified:['הועלה ואומת (6/6)','mr-ok'],uploaded_unverified:['הועלה, ממתין לאימות','mr-warn'],verify_failed:['אימות נכשל','mr-bad']};
 async function load(){
  const sb=window.supabaseClient;
  const {data:{session}}=await sb.auth.getSession();
  if(!session){msg('נדרשת כניסה למערכת.');return;}
  const prof=await sb.from('profiles').select('role,status').eq('id',session.user.id).maybeSingle();
  if(prof.error||!prof.data||prof.data.status!=='active'||!['admin','manager'].includes(prof.data.role)){msg('המסך זמין למנהלים בלבד.');return;}
  const runs=await sb.from('marketing_report_runs').select('business_id,period_from,period_to,report_type,sha256,pdf_status,portal_status,checks,last_verified_at,last_error,updated_at').order('period_to',{ascending:false}).limit(1000);
  if(runs.error){msg('לא ניתן לטעון את הסטטוס כרגע.');return;}
  const latest=new Map();for(const r of runs.data)if(!latest.has(r.business_id))latest.set(r.business_id,r);
  const flagged=await sb.from('businesses').select('id,business_number,internal_name,marketing_service_active').eq('marketing_service_active',true);
  const ids=[...new Set([...latest.keys(),...((flagged.data||[]).map(b=>b.id))])];
  const biz=ids.length?await sb.from('businesses').select('id,business_number,internal_name').in('id',ids):{data:[]};
  const byId=new Map((biz.data||[]).map(b=>[b.id,b]));
  if(!ids.length){msg('עדיין אין דוחות שבועיים.');return;}
  const table=el('table',null,'mr-table'),head=el('tr');
  const cols=['מספר עסק','שם העסק','תקופת הדוח האחרון','פוסטים בתקופה','סטטוס PDF','העלאה לפורטל','אימות אחרון','תקלה פתוחה'];
  cols.forEach(c=>head.appendChild(el('th',c)));const thead=el('thead');thead.appendChild(head);table.appendChild(thead);
  const tb=el('tbody');
  ids.map(id=>({b:byId.get(id)||{business_number:'',internal_name:''},r:latest.get(id)||null})).sort((x,y)=>String(x.b.business_number).localeCompare(String(y.b.business_number))).forEach(({b,r})=>{
   const tr=el('tr');const cell=(i,text,cls)=>{const td=el('td',text,cls);td.dataset.label=cols[i];tr.appendChild(td);};
   const posts=r&&r.checks&&Number.isInteger(r.checks.posts_in_period)?r.checks.posts_in_period:'—';
   const pdf=r?(PDF[r.pdf_status]||[r.pdf_status||'—','']):['טרם הופק',''];const portal=r?(PORTAL[r.portal_status]||[r.portal_status||'—','']):['—',''];
   cell(0,b.business_number);cell(1,b.internal_name);cell(2,r?period(r.period_from,r.period_to):'—');cell(3,posts);cell(4,pdf[0],pdf[1]);cell(5,portal[0],portal[1]);cell(6,r?when(r.last_verified_at):'—');cell(7,r&&r.last_error?r.last_error:'אין',r&&r.last_error?'mr-bad':'');
   tb.appendChild(tr);});
  table.appendChild(tb);body.replaceChildren(table);
 }
 load().catch(()=>msg('לא ניתן לטעון את הסטטוס כרגע.'));
})();
