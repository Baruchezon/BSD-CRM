/* BSD meeting preparation form, isolated from production. */
(function () {
  'use strict';
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const pick = (obj, keys) => keys.map(k => obj[k]).find(v => v !== null && v !== undefined && String(v).trim() !== '') ?? '';
  const fields = [
    ['מחיר מבוקש',['asking_price','price','sale_price']],
    ['תחום פעילות',['field','business_type','industry']],
    ['שטח העסק',['area_sqm','area','size_sqm']],
    ['מחזור שנתי',['annual_revenue','revenue','turnover']],
    ['רווח תפעולי',['operating_profit']],
    ['רווח נקי',['net_profit']],
    ['מספר עובדים',['employees_count','employee_count','employees']],
    ['שכר דירה',['monthly_rent','rent']],
    ['תקופת שכירות',['lease_term','lease_end_date']],
    ['מלאי וציוד',['equipment','inventory']],
    ['סיבת מכירה',['sale_reason','reason_for_sale']]
  ];
  const printStyles = String.raw`
    @page { size: A4; margin: 12mm; }
    html,body {direction:rtl;font-family:Arial,sans-serif;color:#17243a;background:#fff;font-size:14pt;}
    h1{font-size:18pt;margin:0 0 8px;border-bottom:3px solid #bea05b;padding-bottom:8px}
    h2{font-size:15pt;margin:12px 0 6px}
    .meta{font-size:14pt;margin-bottom:8px}.tbl{width:100%;border-collapse:collapse;font-size:14pt}
    .tbl td,.tbl th{border:1px solid #bbc2cb;padding:5px;vertical-align:top;text-align:right}
    .tbl th{background:#f0f1f4}.remarks{height:26px;min-width:90px}.tbl td:nth-child(2){width:56%}.tbl td:nth-child(3){width:30%}
    .history{font-size:14pt;white-space:pre-wrap;overflow-wrap:anywhere}.source{margin:5px 0;line-height:1.5;break-inside:avoid}
    .line{border-bottom:1px solid #aeb4bf;height:28px}
    .meeting-section{break-inside:avoid}.screenonly{margin:12px 0}
    @media print{.screenonly{display:none!important}.page-break{break-before:page} body,table,td,th,p,div,span,strong{font-size:14pt!important;line-height:1.35}}
  `;
  const formattedDate = d => d ? new Date(d + (d.length === 10 ? 'T12:00:00' : '')).toLocaleDateString('he-IL') : '';
  const dateToday = () => new Date().toLocaleDateString('en-CA');
  const noteText = m => [m.summary_text,m.decisions,m.notes].filter(Boolean).join(' | ');
  function template(biz, meetings, edits) {
    const concise = (v,max=380) => {
      const text=String(v||'').replace(/\s+/g,' ').trim();
      if(text.length<=max)return text;
      const cut=text.slice(0,max);return cut.slice(0,Math.max(cut.lastIndexOf('. '),cut.lastIndexOf(' '),max-45)).trim()+'…';
    };
    const rows = fields.map(([label,keys]) => `<tr><td>${esc(label)}</td><td>${esc(pick(biz,keys))||'לא ידוע'}</td><td class="remarks">${esc(edits?.[label]||'')}</td></tr>`).join('');
    const calls=meetings.filter(m => /שיח|טלפון/i.test(m.meeting_type||'') && noteText(m).trim()).slice(0,2);
    const conversation=calls.length ? calls.map(m=>`${formattedDate(m.meeting_date)}: ${concise(noteText(m),360)}`).join(' | ') :
      (meetings.find(m=>noteText(m).trim()) ? `תיעוד קודם (${formattedDate(meetings.find(m=>noteText(m).trim()).meeting_date)}): ${concise(noteText(meetings.find(m=>noteText(m).trim())),300)}` : 'לא נמצא סיכום שיחה מתועד');
    const sections=[
      ['מהות שיחת הטלפון',conversation],
      ['מה העסק עושה',concise(biz.short_description,330)],
      ['חקר שוק קצר',concise(biz.pre_research,280)],
      ['ביקורות וממצאים',concise(biz.market_reviews||biz.reviews_summary||'',160)]
    ];
    const name=pick(biz,['internal_name','business_name','name'])||'עסק';
    const details=[['שם העסק',name],['איש קשר',biz.owner_name],['טלפון',biz.owner_phone],['אימייל',biz.owner_email],['ח.פ / ת.ז',biz.id_number],['כתובת',biz.address],['תחום פעילות',biz.field],['קטגוריה',biz.category]];
    const detailRows=details.map(([label,value])=>`<tr><th>${esc(label)}</th><td>${esc(value||'לא ידוע')}</td><td class="remarks"></td></tr>`).join('');
    const sectionRows=sections.map(([label,value])=>`<tr><th>${esc(label)}</th><td>${esc(value||'לא תועד')}</td><td class="remarks"></td></tr>`).join('');
    return `<h1>BSD | טופס פגישה עם בעל עסק</h1>
      <div class="meta"><strong>תאריך פגישה:</strong> ${esc(edits?.date||'________________')} &nbsp; <strong>מספר עסק:</strong> ${esc(biz.business_number||'')}</div>
      <section><h2>פרטי העסק ואיש הקשר</h2><table class="tbl"><thead><tr><th>פרט</th><th>מידע קיים</th><th>תיקון / השלמה</th></tr></thead><tbody>${detailRows}</tbody></table></section>
      <section><h2>רקע לפגישה</h2><table class="tbl"><thead><tr><th>נושא</th><th>מה ידוע לנו</th><th>תיקון / הערות</th></tr></thead><tbody>${sectionRows}</tbody></table></section>
      <section><h2>נתונים עסקיים</h2><table class="tbl"><thead><tr><th>נושא</th><th>מידע קיים</th><th>תיקון / השלמה</th></tr></thead><tbody>${rows}</tbody></table></section>
      <section class="meeting-section"><h2>עיקרי הפגישה והשלמות</h2>${edits?.summary?`<p style="white-space:pre-wrap">${esc(edits.summary)}</p>`:Array.from({length:4},()=>'<div class="line"></div>').join('')}</section>
      <section class="meeting-section"><h2>החלטות והמשך טיפול</h2>${edits?.next?`<p style="white-space:pre-wrap">${esc(edits.next)}</p>`:Array.from({length:2},()=>'<div class="line"></div>').join('')}</section>`;
  }
  let active = null;
  async function open(biz) {
    if (!biz || !biz.id) throw Error('יש לפתוח עסק שמור');
    const db = window.supabaseClient;
    if (!db) throw Error('אין חיבור מאומת למסד הנתונים');
    const {data,error} = await db.from('match_meetings').select('id,meeting_date,meeting_type,summary_text,decisions,notes')
      .eq('business_id',biz.id).is('deleted_at',null).order('meeting_date',{ascending:false}).limit(30);
    if (error) throw error;
    const meetings = data || [];
    const existing = document.getElementById('bsdMeetingPrepOverlay');
    if(existing) existing.remove();
    const overlay=document.createElement('div'); overlay.id='bsdMeetingPrepOverlay';
    overlay.dir='rtl';
    overlay.style.cssText='position:fixed;inset:0;z-index:999999;background:#f3f5f8;overflow:auto;padding:16px;font-family:Arial,sans-serif';
    overlay.innerHTML = `<style id="bsdPrepStyle">${printStyles}</style>
      <div style="max-width:850px;margin:auto">
      <div class="screenonly" style="display:flex;flex-wrap:wrap;gap:8px">
        <button type="button" id="bsdPrepClose">סגור</button>
        <button type="button" id="bsdPrepPrint">הדפסה / שמירה כ PDF</button>
        <button type="button" id="bsdPrepSave">שמור סיכום בכרטיס העסק</button>
        <span id="bsdPrepStatus" role="status" aria-live="polite"></span>
      </div>
      <div class="screenonly" style="display:grid;gap:8px;background:white;padding:12px;border:1px solid #d5dbe5;border-radius:8px">
        <label>תאריך פגישה <input id="bsdPrepDate" type="date" value="${dateToday()}"></label>
        <label>סוג פגישה <select id="bsdPrepType"><option>פגישה</option><option>שיחת טלפון</option><option>שיחת וידאו</option><option>פגישת המשך</option></select></label>
        <label>סיכום הפגישה <textarea id="bsdPrepSummary" rows="5" style="width:100%"></textarea></label>
        <label>החלטות והמשך טיפול <textarea id="bsdPrepNext" rows="3" style="width:100%"></textarea></label>
      </div>
      <div id="bsdPrepPaper" style="background:white;padding:12mm;margin:10px auto;width:210mm;max-width:100%;box-sizing:border-box">${template(biz,meetings,{})}</div>
      </div>`;
    document.body.appendChild(overlay);
    // Add a temporary history entry for the meeting form. Browser Back should
    // close the form and reveal the same business card, not navigate to Leads.
    const parentState = history.state && typeof history.state === 'object' ? history.state : {};
    const meetingHistory = parentState.bsdCardType === 'business';
    if (meetingHistory) history.pushState({ ...parentState, bsdMeetingPrep: true }, '', location.href);
    let closing = false;
    const onBack = () => {
      if (closing) return;
      closing = true;
      window.removeEventListener('popstate', onBack);
      overlay.remove();
    };
    if (meetingHistory) window.addEventListener('popstate', onBack);
    const closePrep = () => {
      if (closing) return;
      closing = true;
      window.removeEventListener('popstate', onBack);
      overlay.remove();
      if (meetingHistory && history.state && history.state.bsdMeetingPrep) history.back();
    };
    active={biz,meetings,overlay};
    const el=id=>overlay.querySelector('#'+id);
    const edits=()=>({date:el('bsdPrepDate').value,summary:el('bsdPrepSummary').value,next:el('bsdPrepNext').value});
    const refresh=()=>{el('bsdPrepPaper').innerHTML=template(biz,meetings,edits());};
    el('bsdPrepSummary').addEventListener('input',refresh);
    el('bsdPrepNext').addEventListener('input',refresh);
    el('bsdPrepDate').addEventListener('change',refresh);
    el('bsdPrepClose').onclick=closePrep;
    el('bsdPrepPrint').onclick=()=>{
      refresh();
      const w=window.open('','_blank');
      if(!w){el('bsdPrepStatus').textContent='יש לאפשר חלון קופץ להדפסה';return;}
      w.document.write('<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8"><title>BSD פגישה</title><style>'+printStyles+'</style><body>'+el('bsdPrepPaper').innerHTML+'</body></html>');
      w.document.close();w.focus();w.print();
    };
    el('bsdPrepSave').onclick=async()=>{
      const e=edits();
      if(!e.summary.trim()){el('bsdPrepStatus').textContent='יש להקליד סיכום לפני שמירה';return;}
      if(!window.confirm('לשמור סיכום פגישה חדש בכרטיס העסק?'))return;
      const row={business_id:biz.id,meeting_type:el('bsdPrepType').value,meeting_date:e.date,summary_text:e.summary,decisions:e.next,status:'טיוטה'};
      el('bsdPrepSave').disabled=true;
      try{
        const {error}=await db.from('match_meetings').insert(row);
        if(error)throw error;
        el('bsdPrepStatus').textContent='הסיכום נשמר בכרטיס העסק';
        if(typeof window.loadBizMeetings==='function')await window.loadBizMeetings(biz.id);
      }catch(err){el('bsdPrepStatus').textContent='השמירה נכשלה: '+(err.message||err);}
      finally{el('bsdPrepSave').disabled=false;}
    };
  }
  window.BSDMeetingPrep={open};
})();