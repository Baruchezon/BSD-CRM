'use strict';
(function(){
  let renderWrapped=false;

  function syncHealth(){
    const boxes=Array.from(document.querySelectorAll('#analyticsHealth'));
    if(boxes.length<2)return;
    const source=boxes.find(x=>x.innerHTML.trim())||boxes[0];
    boxes.forEach(x=>{if(x!==source){x.className=source.className;x.innerHTML=source.innerHTML;}});
  }

  function routeContentLinks(){
    document.querySelectorAll('a[href*="site-content-editor.html"]').forEach(a=>{
      const href=a.getAttribute('href')||'';
      const q=href.includes('?')?'?'+href.split('?')[1]:'';
      a.setAttribute('href','site-content-studio.html'+q);
    });
  }

  function ensureQuickLinks(){
    const actions=document.querySelector('.top .actions');
    if(!actions||document.getElementById('siteAdminLiveLink'))return;
    const live=document.createElement('a');
    live.id='siteAdminLiveLink';
    live.className='btn';
    live.href='https://www.bsd-bbi.co.il/';
    live.target='_blank';
    live.rel='noopener';
    live.textContent='פתח אתר חי';
    actions.insertBefore(live,actions.firstChild);

    const gsc=document.createElement('a');
    gsc.id='siteAdminGscLink';
    gsc.className='btn';
    gsc.href='https://search.google.com/search-console?resource_id=https%3A%2F%2Fwww.bsd-bbi.co.il%2F';
    gsc.target='_blank';
    gsc.rel='noopener';
    gsc.textContent='Google Search Console';
    actions.insertBefore(gsc,live.nextSibling);
  }

  function ensureAnalyticsEnhancements(){
    const panel=document.querySelector('[data-panel="analytics"]');
    if(!panel||document.getElementById('bsdAnalyticsExtended'))return;
    const wrap=document.createElement('div');
    wrap.id='bsdAnalyticsExtended';
    wrap.innerHTML=`
      <div class="section-note" style="margin-top:18px">מדדים מתקדמים מתוך האנליטיקה הפנימית של BSD. נתוני זמן פעיל בדף יתחילו להצטבר מהגרסה החדשה ואינם כוללים מבקרים שלא אישרו סטטיסטיקה.</div>
      <div class="metrics">
        <div class="metric"><span>עמודים לסשן</span><b id="xPagesPerSession">0</b></div>
        <div class="metric"><span>סשנים של עמוד אחד</span><b id="xSinglePageRate">0%</b></div>
        <div class="metric"><span>מבקרים חדשים</span><b id="xNewVisitors">0</b></div>
        <div class="metric"><span>מבקרים חוזרים</span><b id="xReturningVisitors">0</b></div>
        <div class="metric"><span>סשנים מעורבים</span><b id="xEngagedRate">0%</b></div>
        <div class="metric"><span>זמן פעיל ממוצע בדף</span><b id="xAvgPageTime">0:00</b></div>
      </div>
      <div class="grid2">
        <div class="card"><div class="cardhead"><h3>דפי כניסה מובילים</h3><span class="muted">הדף הראשון בכל סשן</span></div><div class="cardbody" id="xEntryPages"></div></div>
        <div class="card"><div class="cardhead"><h3>דפי יציאה מובילים</h3><span class="muted">הדף האחרון בכל סשן</span></div><div class="cardbody" id="xExitPages"></div></div>
      </div>
      <div class="grid2">
        <div class="card"><div class="cardhead"><h3>מקורות שהביאו פניות</h3><span class="muted">לפי הסשן שבו נקלטה הפנייה</span></div><div class="cardbody" id="xLeadSources"></div></div>
        <div class="card"><div class="cardhead"><h3>פעולות באתר</h3><span class="muted">טלפון, WhatsApp, טפסים וקישורים</span></div><div class="cardbody" id="xActions"></div></div>
      </div>
      <div class="grid2">
        <div class="card"><div class="cardhead"><h3>שעות פעילות</h3><span class="muted">צפיות לפי שעה</span></div><div class="cardbody" id="xHours"></div></div>
        <div class="card"><div class="cardhead"><h3>קמפיינים UTM</h3><span class="muted">מקור וקמפיין כשקיימים בפרסום</span></div><div class="cardbody" id="xCampaigns"></div></div>
      </div>
      <div class="card">
        <div class="cardhead"><h3>זמן שהייה פעיל לפי דף</h3><span class="muted">זמן שבו הדף היה גלוי למבקר</span></div>
        <div class="tablewrap"><table class="table"><thead><tr><th>דף</th><th>זמן ממוצע</th><th>מדידות</th><th>זמן מצטבר</th></tr></thead><tbody id="xPageTimeRows"></tbody></table></div>
      </div>`;
    panel.appendChild(wrap);
  }

  const n=v=>Number(v||0);
  const fmtNum=v=>n(v).toLocaleString('he-IL');
  const fmtPct=v=>n(v).toLocaleString('he-IL',{maximumFractionDigits:1})+'%';
  const fmtTime=s=>{s=Math.max(0,Math.round(n(s)));return Math.floor(s/60)+':'+String(s%60).padStart(2,'0')};
  const decodeSafe=v=>{try{return decodeURIComponent(v||'')}catch{return v||''}};

  function countRows(values){
    const m=new Map();
    values.forEach(v=>{const k=v||'לא ידוע';m.set(k,(m.get(k)||0)+1)});
    return [...m.entries()].sort((a,b)=>b[1]-a[1]);
  }

  function renderBarsLocal(id,rows){
    const el=document.getElementById(id);if(!el)return;
    if(typeof bars==='function'){bars(id,rows.slice(0,12));return;}
    if(!rows.length){el.innerHTML='<div class="empty">אין עדיין נתונים בתקופה שנבחרה</div>';return;}
    const mx=Math.max(1,...rows.map(x=>x[1]));
    el.innerHTML=rows.slice(0,12).map(([k,v])=>`<div class="barrow"><span title="${String(k).replace(/"/g,'&quot;')}">${k}</span><div class="track"><div class="fill" style="width:${Math.max(3,v/mx*100)}%"></div></div><b>${fmtNum(v)}</b></div>`).join('');
  }

  function sessionRows(items){
    const map=new Map();
    for(const e of items){
      if(!e.session_id)continue;
      let s=map.get(e.session_id);
      if(!s){s={id:e.session_id,visitor:e.visitor_id||'',events:[],pages:[],firstTs:Infinity,lastTs:0,duration:0,lead:false,action:false,referrer:''};map.set(e.session_id,s)}
      const ts=new Date(e.created_at).getTime();
      s.events.push(e);s.firstTs=Math.min(s.firstTs,ts);s.lastTs=Math.max(s.lastTs,ts);
      if(e.event_name==='page_view'){
        s.pages.push(e);
        if(!s.referrer&&e.referrer_host)s.referrer=e.referrer_host;
      }
      if(e.event_name==='session_end'&&n(e.duration_seconds)>s.duration)s.duration=n(e.duration_seconds);
      if(e.event_name==='lead_submit')s.lead=true;
      if(['lead_submit','form_submit','phone_click','whatsapp_click','email_click','business_click'].includes(e.event_name))s.action=true;
    }
    return [...map.values()].map(s=>{
      s.pages.sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));
      if(!s.duration&&Number.isFinite(s.firstTs)&&s.lastTs>s.firstTs)s.duration=(s.lastTs-s.firstTs)/1000;
      s.entry=s.pages[0]||null;s.exit=s.pages[s.pages.length-1]||null;
      return s;
    });
  }

  function activePeriodStart(){
    try{if(typeof periodStart==='function'&&typeof S!=='undefined')return periodStart(S.rangeDays)}catch(e){}
    const d=new Date();d.setHours(0,0,0,0);d.setDate(d.getDate()-6);return d.getTime();
  }

  function visitorSplit(items){
    const first=new Map();
    try{
      if(typeof S!=='undefined')for(const e of S.analytics||[]){if(!e.visitor_id)continue;const ts=new Date(e.created_at).getTime();if(!first.has(e.visitor_id)||ts<first.get(e.visitor_id))first.set(e.visitor_id,ts)}
    }catch(e){}
    const visitors=new Set(items.map(e=>e.visitor_id).filter(Boolean));
    const start=activePeriodStart();let fresh=0,returning=0;
    visitors.forEach(id=>{const ts=first.get(id);if(ts!==undefined&&ts<start)returning++;else fresh++});
    return{fresh,returning};
  }

  function pageEngagementStats(items){
    const map=new Map();
    for(const e of items){
      if(e.event_name!=='page_engagement'||n(e.duration_seconds)<=0)continue;
      const key=e.page_path||'/';let x=map.get(key);
      if(!x){x={path:key,title:e.page_title||decodeSafe(key),sum:0,count:0};map.set(key,x)}
      x.sum+=n(e.duration_seconds);x.count++;
    }
    return[...map.values()].map(x=>({...x,avg:x.sum/x.count})).sort((a,b)=>b.count-a.count||b.avg-a.avg);
  }

  function renderPageTimes(rows){
    const el=document.getElementById('xPageTimeRows');if(!el)return;
    if(!rows.length){el.innerHTML='<tr><td colspan="4" class="empty">נתוני זמן פעיל יתחילו להופיע לאחר הצטברות גלישות בגרסה החדשה</td></tr>';return;}
    el.innerHTML=rows.slice(0,20).map(x=>`<tr><td><a class="page-link" target="_blank" rel="noopener" href="https://www.bsd-bbi.co.il${x.path||'/'}"><b>${x.title||decodeSafe(x.path)}</b><span>${decodeSafe(x.path)}</span></a></td><td>${fmtTime(x.avg)}</td><td>${fmtNum(x.count)}</td><td>${fmtTime(x.sum)}</td></tr>`).join('');
  }

  function renderExtendedAnalytics(){
    ensureAnalyticsEnhancements();
    if(typeof S==='undefined'||!Array.isArray(S.analytics))return;
    const items=typeof eventsFor==='function'?eventsFor():S.analytics;
    const sessions=sessionRows(items);
    const pageViews=items.filter(e=>e.event_name==='page_view');
    const totalViews=pageViews.length;
    const pagesPer=sessions.length?totalViews/sessions.length:0;
    const single=sessions.length?sessions.filter(s=>s.pages.length<=1).length/sessions.length*100:0;
    const engaged=sessions.length?sessions.filter(s=>s.duration>=10||s.pages.length>=2||s.action).length/sessions.length*100:0;
    const split=visitorSplit(items);
    const pageTimes=pageEngagementStats(items);
    const avgPage=pageTimes.reduce((a,x)=>a+x.sum,0)/(pageTimes.reduce((a,x)=>a+x.count,0)||1);
    const sessionDurations=sessions.map(s=>s.duration).filter(x=>x>0);
    const avgSession=sessionDurations.length?sessionDurations.reduce((a,b)=>a+b,0)/sessionDurations.length:0;

    const set=(id,value)=>{const el=document.getElementById(id);if(el)el.textContent=value};
    set('xPagesPerSession',pagesPer.toLocaleString('he-IL',{maximumFractionDigits:2}));
    set('xSinglePageRate',fmtPct(single));
    set('xNewVisitors',fmtNum(split.fresh));
    set('xReturningVisitors',fmtNum(split.returning));
    set('xEngagedRate',fmtPct(engaged));
    set('xAvgPageTime',pageTimes.length?fmtTime(avgPage):'—');
    set('aTime',fmtTime(avgSession));

    renderBarsLocal('xEntryPages',countRows(sessions.filter(s=>s.entry).map(s=>decodeSafe(s.entry.page_path||'/'))));
    renderBarsLocal('xExitPages',countRows(sessions.filter(s=>s.exit).map(s=>decodeSafe(s.exit.page_path||'/'))));
    renderBarsLocal('xLeadSources',countRows(sessions.filter(s=>s.lead).map(s=>s.referrer||'ישיר')));

    const actionLabels={phone_click:'לחיצה לחיוג',whatsapp_click:'לחיצה ל WhatsApp',email_click:'לחיצה לאימייל',form_submit:'שליחת טופס',lead_submit:'פנייה שנקלטה',business_view:'צפייה בעסק',business_click:'לחיצה על עסק',outbound_click:'קישור חיצוני'};
    renderBarsLocal('xActions',countRows(items.filter(e=>actionLabels[e.event_name]).map(e=>actionLabels[e.event_name])));
    renderBarsLocal('xHours',countRows(pageViews.map(e=>String(new Date(e.created_at).getHours()).padStart(2,'0')+':00')).sort((a,b)=>a[0].localeCompare(b[0])));

    const campaigns=pageViews.map(e=>{
      const m=e.metadata||{};const src=m.utm_source||'';const camp=m.utm_campaign||'';
      if(!src&&!camp)return'';
      return[src||'ללא מקור',camp].filter(Boolean).join(' / ');
    }).filter(Boolean);
    renderBarsLocal('xCampaigns',countRows(campaigns));
    renderPageTimes(pageTimes);
  }

  function wrapRenderAll(){
    if(renderWrapped)return;
    try{
      if(typeof renderAll==='function'){
        const base=renderAll;
        renderAll=function(){const result=base.apply(this,arguments);setTimeout(renderExtendedAnalytics,0);return result};
        renderWrapped=true;
      }
    }catch(e){}
  }

  document.addEventListener('click',e=>{
    if(e.target.closest?.('[data-tab],[data-range]'))setTimeout(()=>{syncHealth();routeContentLinks();renderExtendedAnalytics();},30);
  });

  const boot=()=>{
    ensureQuickLinks();ensureAnalyticsEnhancements();wrapRenderAll();
    setTimeout(()=>{syncHealth();routeContentLinks();renderExtendedAnalytics();},300);
    setTimeout(()=>{routeContentLinks();renderExtendedAnalytics();},1400);
    setTimeout(renderExtendedAnalytics,3500);
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
  setInterval(()=>{syncHealth();routeContentLinks();},5000);
})();
