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
  let activeMs=0;
  let activeSince=document.visibilityState==='visible'?Date.now():null;

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
  function campaignMeta(){
    try{
      const q=new URLSearchParams(location.search);
      const out={};
      [['utm_source','utm_source'],['utm_medium','utm_medium'],['utm_campaign','utm_campaign']].forEach(([key,param])=>{const v=q.get(param);if(v)out[key]=v.slice(0,120)});
      return out;
    }catch(e){return {}}
  }
  function send(eventName,extra){
    const duration=extra&&extra.duration_seconds;
    const payload={
      visitor_id:visitorId,
      session_id:sessionId,
      event_name:String(eventName||'event').slice(0,60),
      page_path:location.pathname.slice(0,300),
      page_title:(document.title||'').slice(0,200),
      referrer_host:refHost().slice(0,180),
      business_id:extra&&extra.business_id?extra.business_id:null,
      duration_seconds:duration===0||duration?Math.min(86400,Math.max(0,Math.round(duration))):null,
      device_type:device(),
      metadata:cleanMeta(extra&&extra.metadata)
    };
    fetch(endpoint,{method:'POST',keepalive:true,headers:{'Content-Type':'application/json','apikey':apiKey,'Authorization':'Bearer '+apiKey,'Prefer':'return=minimal'},body:JSON.stringify(payload)}).catch(()=>{});
  }
  function activeSeconds(){
    let total=activeMs;
    if(activeSince!==null)total+=Date.now()-activeSince;
    return Math.max(0,total/1000);
  }

  window.BSDAnalytics={
    track:function(name,metadata){send(name,{metadata:metadata||{}})},
    businessView:function(id){if(id)send('business_view',{business_id:id})},
    leadSubmit:function(source){send('lead_submit',{metadata:{source:source||'website'}})}
  };

  send('page_view',{metadata:campaignMeta()});

  document.addEventListener('visibilitychange',function(){
    if(document.visibilityState==='visible'){
      if(activeSince===null)activeSince=Date.now();
    }else if(activeSince!==null){
      activeMs+=Date.now()-activeSince;
      activeSince=null;
    }
  });

  document.addEventListener('click',function(e){
    const tracked=e.target.closest('[data_track]');
    if(tracked){
      const name=tracked.getAttribute('data_track');
      if(name)send(name,{business_id:tracked.getAttribute('data_business_id')||null,metadata:{label:(tracked.getAttribute('data_track_label')||tracked.textContent||'').trim().slice(0,120)}});
      return;
    }
    const a=e.target.closest('a[href]');
    if(!a)return;
    const href=(a.getAttribute('href')||'').trim();
    const label=(a.textContent||a.getAttribute('aria-label')||'').trim().slice(0,120);
    if(/^tel:/i.test(href))return send('phone_click',{metadata:{label}});
    if(/^mailto:/i.test(href))return send('email_click',{metadata:{label}});
    if(/(?:wa\.me|whatsapp\.com)/i.test(href))return send('whatsapp_click',{metadata:{label}});
    try{
      const u=new URL(href,location.href);
      if(/^https?:$/i.test(u.protocol)&&u.hostname&&u.hostname!==location.hostname)send('outbound_click',{metadata:{host:u.hostname.slice(0,120),label}});
    }catch(err){}
  },true);

  document.addEventListener('submit',function(e){
    const f=e.target;
    if(!f||f.tagName!=='FORM')return;
    send('form_submit',{metadata:{form_id:(f.id||f.getAttribute('name')||'form').slice(0,80)}});
  },true);

  let ended=false;
  function endSession(){
    if(ended)return;
    ended=true;
    if(activeSince!==null){activeMs+=Date.now()-activeSince;activeSince=null;}
    const now=Date.now();
    const sessionStarted=Number(sessionStorage.getItem(START_KEY)||now);
    send('page_engagement',{duration_seconds:activeSeconds()});
    send('session_end',{duration_seconds:(now-sessionStarted)/1000});
  }
  window.addEventListener('pagehide',endSession);
})();
