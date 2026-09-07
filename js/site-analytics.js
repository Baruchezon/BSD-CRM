// BSD Site Analytics
// ללא כתובת IP, ללא תוכן טפסים, ללא שם, טלפון או אימייל.
// דורש את js/config.js לפני קובץ זה.
(function(){
  if(!window.BSD_CONFIG || !window.BSD_CONFIG.SUPABASE_URL || !window.BSD_CONFIG.SUPABASE_PUBLISHABLE_KEY) return;
  const VISITOR_KEY='bsd_site_visitor';
  const SESSION_KEY='bsd_site_session';
  const START_KEY='bsd_site_session_start';
  const endpoint=window.BSD_CONFIG.SUPABASE_URL.replace(/\/$/,'')+'/rest/v1/site_analytics_events';
  const apiKey=window.BSD_CONFIG.SUPABASE_PUBLISHABLE_KEY;
  function uuid(){
    if(crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g,function(c){const r=Math.random()*16|0,v=c==='x'?r:(r&3|8);return v.toString(16)});
  }
  function getKey(key,storage){let v=storage.getItem(key);if(!v){v=uuid();storage.setItem(key,v)}return v}
  const visitorId=getKey(VISITOR_KEY,localStorage);
  const sessionId=getKey(SESSION_KEY,sessionStorage);
  if(!sessionStorage.getItem(START_KEY)) sessionStorage.setItem(START_KEY,String(Date.now()));
  function device(){const w=window.innerWidth;if(w<768)return 'mobile';if(w<1100)return 'tablet';return 'desktop'}
  function refHost(){try{return document.referrer?new URL(document.referrer).hostname:''}catch(e){return ''}}
  function cleanMeta(meta){const out={};Object.entries(meta||{}).slice(0,12).forEach(([k,v])=>{if(!/^[a-zA-Z0-9_]{1,40}$/.test(k))return;if(typeof v==='string')out[k]=v.slice(0,180);else if(typeof v==='number'||typeof v==='boolean')out[k]=v});return out}
  function send(eventName,extra){
    const payload={visitor_id:visitorId,session_id:sessionId,event_name:String(eventName||'event').slice(0,60),page_path:location.pathname.slice(0,300),page_title:(document.title||'').slice(0,200),referrer_host:refHost().slice(0,180),business_id:extra&&extra.business_id?extra.business_id:null,duration_seconds:extra&&extra.duration_seconds?Math.min(86400,Math.max(0,Math.round(extra.duration_seconds))):null,device_type:device(),metadata:cleanMeta(extra&&extra.metadata)};
    fetch(endpoint,{method:'POST',keepalive:true,headers:{'Content-Type':'application/json','apikey':apiKey,'Authorization':'Bearer '+apiKey,'Prefer':'return=minimal'},body:JSON.stringify(payload)}).catch(()=>{});
  }
  window.BSDAnalytics={track:function(name,metadata){send(name,{metadata:metadata||{}})},businessView:function(id){if(id)send('business_view',{business_id:id})},leadSubmit:function(source){send('lead_submit',{metadata:{source:source||'website'}})}};
  send('page_view',{});
  document.addEventListener('click',function(e){const el=e.target.closest('[data_track]');if(!el)return;const name=el.getAttribute('data_track');if(!name)return;send(name,{business_id:el.getAttribute('data_business_id')||null,metadata:{label:(el.getAttribute('data_track_label')||el.textContent||'').trim().slice(0,120)}})},true);
  let ended=false;function endSession(){if(ended)return;ended=true;const started=Number(sessionStorage.getItem(START_KEY)||Date.now());send('session_end',{duration_seconds:(Date.now()-started)/1000})}
  window.addEventListener('pagehide',endSession);
})();
