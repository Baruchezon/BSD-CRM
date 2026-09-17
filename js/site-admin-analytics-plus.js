'use strict';
(function(){
  const byId=id=>document.getElementById(id);
  const safeNum=v=>Number(v||0).toLocaleString('he-IL');
  const safePct=v=>Number(v||0).toLocaleString('he-IL',{maximumFractionDigits:1})+'%';
  const safeTime=seconds=>{seconds=Math.max(0,Math.round(Number(seconds||0)));const m=Math.floor(seconds/60),s=seconds%60;return m+':'+String(s).padStart(2,'0')};
  const escPlus=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const decodeSafe=v=>{try{return decodeURIComponent(v||'')}catch{return v||''}};

  function ensureUi(){
    const analytics=document.querySelector('[data-panel="analytics"]');
    if(!analytics||byId('aPagesPerSession')) return;
    const metrics=analytics.querySelector('.metrics');
    if(metrics){
      metrics.insertAdjacentHTML('beforeend',
        '<div class="metric"><span>דפים לסשן</span><b id="aPagesPerSession">0</b></div>'+ 
        '<div class="metric"><span>זמן פעילות ממוצע בדף</span><b id="aPageTime">0:00</b></div>'+ 
        '<div class="metric"><span>סשנים של דף אחד</span><b id="aBounce">0%</b></div>'+ 
        '<div class="metric"><span>מבקרים חוזרים</span><b id="aReturning">0%</b></div>'+ 
        '<div class="metric"><span>לחיצות ליצירת קשר</span><b id="aContactClicks">0</b></div>'+ 
        '<div class="metric"><span>טפסים שנשלחו</span><b id="aForms">0</b></div>'
      );
    }
    const firstGrid=analytics.querySelector('.grid2');
    if(firstGrid){
      firstGrid.insertAdjacentHTML('beforebegin',
        '<div class="grid2">'+
          '<div class="card"><div class="cardhead"><h3>דפי כניסה</h3><span class="muted">העמוד הראשון בכל ביקור</span></div><div class="cardbody" id="entryPages"></div></div>'+
          '<div class="card"><div class="cardhead"><h3>קמפיינים ומקורות UTM</h3><span class="muted">כאשר קיימים סימוני קמפיין</span></div><div class="cardbody" id="campaigns"></div></div>'+
        '</div>'+
        '<div class="grid2">'+
          '<div class="card"><div class="cardhead"><h3>זמן פעילות לפי דף</h3><span class="muted">זמן שבו העמוד היה פתוח ופעיל</span></div><div class="tablewrap"><table class="table"><thead><tr><th>דף</th><th>זמן ממוצע</th><th>מדידות</th></tr></thead><tbody id="pageEngagementRows"></tbody></table></div></div>'+
          '<div class="card"><div class="cardhead"><h3>פעולות יצירת קשר</h3><span class="muted">טלפון, WhatsApp, אימייל וטפסים</span></div><div class="cardbody" id="contactActions"></div></div>'+
        '</div>'
      );
    }
    const dashboard=document.querySelector('[data-panel="dashboard"]');
    const dashMetrics=dashboard&&dashboard.querySelector('.metrics');
    if(dashMetrics&&!byId('mAvgTime')){
      dashMetrics.insertAdjacentHTML('beforeend',
        '<div class="metric"><span>זמן ממוצע באתר</span><b id="mAvgTime">0:00</b></div>'+ 
        '<div class="metric"><span>דפים לסשן</span><b id="mPagesPerSession">0</b></div>'
      );
    }
  }

  function currentItems(){
    try{return typeof eventsFor==='function'?eventsFor():[]}catch{return []}
  }
  function groupCount(items,keyFn){
    const m=new Map();
    for(const x of items){const k=keyFn(x)||'לא ידוע';m.set(k,(m.get(k)||0)+1)}
    return [...m.entries()].sort((a,b)=>b[1]-a[1]);
  }
  function renderBarsPlus(id,rows){
    const el=byId(id);if(!el)return;
    if(!rows.length){el.innerHTML='<div class="empty">אין עדיין נתונים בתקופה שנבחרה</div>';return}
    const max=Math.max(1,...rows.map(r=>r[1]));
    el.innerHTML=rows.map(([label,value])=>'<div class="barrow"><span title="'+escPlus(label)+'">'+escPlus(label)+'</span><div class="track"><div class="fill" style="width:'+Math.max(3,value/max*100)+'%"></div></div><b>'+safeNum(value)+'</b></div>').join('');
  }
  function sessionMap(items){
    const map=new Map();
    for(const e of items){
      if(!e.session_id) continue;
      let s=map.get(e.session_id);
      if(!s){s={views:[],visitor:e.visitor_id||'',first:null,last:null};map.set(e.session_id,s)}
      if(e.event_name==='page_view'){
        s.views.push(e);
        if(!s.first||new Date(e.created_at)<new Date(s.first.created_at))s.first=e;
        if(!s.last||new Date(e.created_at)>new Date(s.last.created_at))s.last=e;
      }
    }
    return map;
  }
  function engagementByPage(items){
    const m=new Map();
    for(const e of items){
      if(e.event_name!=='page_engagement'||!Number(e.duration_seconds))continue;
      const path=e.page_path||'/';
      let x=m.get(path);if(!x){x={path,total:0,count:0,title:e.page_title||path};m.set(path,x)}
      x.total+=Number(e.duration_seconds||0);x.count++;
    }
    return [...m.values()].map(x=>({...x,avg:x.count?x.total/x.count:0})).sort((a,b)=>b.avg-a.avg);
  }
  function campaignRows(items){
    const m=new Map();
    for(const e of items){
      if(e.event_name!=='page_view')continue;
      const md=e.metadata||{};
      const source=md.utm_source||'';const medium=md.utm_medium||'';const campaign=md.utm_campaign||'';
      if(!source&&!medium&&!campaign)continue;
      const key=[source||'לא צוין',medium||'לא צוין',campaign||'ללא קמפיין'].join(' | ');
      m.set(key,(m.get(key)||0)+1);
    }
    return [...m.entries()].sort((a,b)=>b[1]-a[1]).slice(0,12);
  }
  function returningRate(items){
    if(typeof S==='undefined'||!Array.isArray(S.analytics))return 0;
    const start=items.length?Math.min(...items.map(x=>new Date(x.created_at).getTime())):Date.now();
    const currentVisitors=new Set(items.map(x=>x.visitor_id).filter(Boolean));
    if(!currentVisitors.size)return 0;
    const before=new Set(S.analytics.filter(x=>new Date(x.created_at).getTime()<start).map(x=>x.visitor_id).filter(Boolean));
    let returning=0;currentVisitors.forEach(v=>{if(before.has(v))returning++});
    return returning/currentVisitors.size*100;
  }
  function renderPlus(){
    ensureUi();
    const items=currentItems();
    const sessions=sessionMap(items);
    const pageViews=items.filter(x=>x.event_name==='page_view');
    const pageCount=pageViews.length;
    const sessionCount=sessions.size;
    const pagesPerSession=sessionCount?pageCount/sessionCount:0;
    const onePage=[...sessions.values()].filter(s=>s.views.length===1).length;
    const bounce=sessionCount?onePage/sessionCount*100:0;
    const engagement=engagementByPage(items);
    const avgPage=engagement.length?engagement.reduce((a,x)=>a+x.total,0)/engagement.reduce((a,x)=>a+x.count,0):0;
    const contacts=items.filter(x=>['phone_click','whatsapp_click','email_click'].includes(x.event_name));
    const forms=items.filter(x=>['form_submit','lead_submit'].includes(x.event_name));
    const ends=items.filter(x=>x.event_name==='session_end'&&Number(x.duration_seconds)>0);
    const avgSession=ends.length?ends.reduce((a,x)=>a+Number(x.duration_seconds||0),0)/ends.length:0;

    if(byId('aPagesPerSession'))byId('aPagesPerSession').textContent=pagesPerSession.toLocaleString('he-IL',{maximumFractionDigits:1});
    if(byId('aPageTime'))byId('aPageTime').textContent=safeTime(avgPage);
    if(byId('aBounce'))byId('aBounce').textContent=safePct(bounce);
    if(byId('aReturning'))byId('aReturning').textContent=safePct(returningRate(items));
    if(byId('aContactClicks'))byId('aContactClicks').textContent=safeNum(contacts.length);
    if(byId('aForms'))byId('aForms').textContent=safeNum(forms.length);
    if(byId('mAvgTime'))byId('mAvgTime').textContent=safeTime(avgSession);
    if(byId('mPagesPerSession'))byId('mPagesPerSession').textContent=pagesPerSession.toLocaleString('he-IL',{maximumFractionDigits:1});

    const entries=groupCount([...sessions.values()].filter(s=>s.first).map(s=>s.first),x=>decodeSafe(x.page_path||'/')).slice(0,12);
    renderBarsPlus('entryPages',entries);
    renderBarsPlus('campaigns',campaignRows(items));
    renderBarsPlus('contactActions',groupCount(contacts.concat(forms),x=>({phone_click:'לחיצה על טלפון',whatsapp_click:'לחיצה על WhatsApp',email_click:'לחיצה על אימייל',form_submit:'שליחת טופס',lead_submit:'ליד שנקלט'}[x.event_name]||x.event_name)));

    const body=byId('pageEngagementRows');
    if(body){
      body.innerHTML=engagement.length?engagement.slice(0,20).map(x=>'<tr><td><a class="page-link" target="_blank" rel="noopener" href="https://www.bsd-bbi.co.il'+escPlus(x.path)+'"><b>'+escPlus(x.title||decodeSafe(x.path))+'</b><span>'+escPlus(decodeSafe(x.path))+'</span></a></td><td><b>'+safeTime(x.avg)+'</b></td><td>'+safeNum(x.count)+'</td></tr>').join(''):'<tr><td colspan="3" class="empty">אין עדיין מדידות זמן</td></tr>';
    }
  }

  function hook(){
    ensureUi();
    if(typeof renderAnalytics==='function'){
      const originalAnalytics=renderAnalytics;
      renderAnalytics=function(){originalAnalytics();renderPlus()};
    }
    if(typeof renderDashboard==='function'){
      const originalDashboard=renderDashboard;
      renderDashboard=function(){originalDashboard();renderPlus()};
    }
    renderPlus();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(hook,0));else setTimeout(hook,0);
})();
