'use strict';
(function(){
  const $=id=>document.getElementById(id);
  const val=id=>($(id)?.value||'').trim();
  const all=(s,r=document)=>Array.from(r.querySelectorAll(s));
  let slugTouched=false;

  function notify(message,isError=false){
    const t=$('toast');
    if(t){
      t.textContent=message;
      t.className='toast show'+(isError?' err':'');
      clearTimeout(notify.timer);
      notify.timer=setTimeout(()=>t.classList.remove('show'),4200);
    }else console[isError?'error':'log'](message);
  }

  function slugify(v){
    return String(v||'').trim().toLowerCase()
      .replace(/["'׳״.,:;!?()[\]{}<>\/\\|@#$%^&*+=~`]+/g,' ')
      .replace(/\s+/g,'-').replace(/-+/g,'-').replace(/^-+|-+$/g,'').slice(0,90)||'article';
  }

  function ensureSlug(){
    const f=$('slug');
    if(!f)return '';
    if(!f.value.trim()) f.value=slugify(val('title')||val('aiTopic'));
    return f.value.trim();
  }

  function setActionsReady(){
    const save=$('saveBtn');
    const publish=$('publishNowBtn');
    const row=save?.parentElement;
    if(save){ save.type='button'; save.disabled=false; save.style.pointerEvents='auto'; }
    if(publish){ publish.type='button'; publish.disabled=false; publish.style.pointerEvents='auto'; }
    if(row){
      row.style.position='sticky'; row.style.bottom='0'; row.style.zIndex='120';
      row.style.background='#0b1c2d'; row.style.padding='12px 8px'; row.style.margin='14px -8px -8px';
      row.style.borderTop='1px solid #345b76'; row.style.boxShadow='0 -8px 24px rgba(1,7,12,.45)';
      row.style.pointerEvents='auto';
    }
  }

  function setMode(mode){
    const wrap=$('aiTopicWrap'), box=$('aiTopicsBox'), hint=$('aiModeHint');
    all('[data-ai-mode]').forEach(b=>b.style.opacity=b.dataset.aiMode===mode?'1':'.72');
    if(mode==='manual'){
      if(wrap)wrap.style.display='none'; if(box)box.style.display='none';
      if(hint)hint.innerHTML='<b>כתיבה ידנית</b> אפשר לערוך הכל לבד. ה AI לא משנה דבר בלי לחיצה מפורשת.';
    }else if(mode==='own'){
      if(wrap)wrap.style.display='block';
      if(hint)hint.innerHTML='<b>יש לי נושא או כותרת</b> כתוב רעיון ובחר איזו עזרה לקבל מה AI.';
    }else{
      if(wrap)wrap.style.display='block';
      if(hint)hint.innerHTML='<b>בחירת נושא מוצע</b> בחירה רק מכניסה את הנושא לעורך.';
    }
  }

  function ensurePanel(){
    const body=document.querySelector('#modal .modalbody');
    if(!body)return;
    if(!$('aiContentPanel')){
      const p=document.createElement('div');
      p.id='aiContentPanel'; p.className='notice'; p.style.marginBottom='14px';
      p.innerHTML=`<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap"><div><b>יצירת מאמר</b><div class="muted" style="margin-top:4px">אפשר לכתוב לבד או להשתמש בעזרת AI בכל שלב.</div></div><button type="button" class="btn" id="aiBackToManual">חזרה לכתיבה ידנית</button></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;margin-top:12px"><button type="button" class="btn primary" data-ai-mode="manual" id="aiManualBtn">כתוב לבד</button><button type="button" class="btn" data-ai-mode="own" id="aiOwnTopicBtn">יש לי נושא או כותרת</button><button type="button" class="btn" data-ai-mode="topics" id="aiTopicsBtn">הצע לי 8 נושאים</button></div>
      <div id="aiModeHint" style="margin-top:10px"></div><div id="aiTopicsBox" style="display:none;margin-top:12px"></div>
      <div id="aiTopicWrap" style="display:none;margin-top:12px"><label style="display:block;font-size:12px;color:#aab8c6;margin-bottom:5px">הנושא או הרעיון למאמר</label><textarea id="aiTopic" class="textarea" style="min-height:74px"></textarea><div class="actions" style="margin-top:9px"><button type="button" class="btn primary" id="aiDraftBtn">צור כתבה מלאה עם AI</button><button type="button" class="btn" id="aiTitleBtn">שפר כותרת</button><button type="button" class="btn" id="aiContentBtn">שפר תוכן</button><button type="button" class="btn" id="aiSeoBtn">שפר SEO</button><button type="button" class="btn" id="aiImageBtn">צור תמונת כותרת</button></div></div>
      <div id="aiImagePreviewWrap" style="display:none;margin-top:12px"><img id="aiImagePreview" alt="תמונת כותרת" style="width:100%;max-height:360px;object-fit:contain;border-radius:12px"></div><div id="publishResult" style="display:none;margin-top:12px"></div>`;
      body.insertBefore(p,body.firstChild);
    }

    const row=$('saveBtn')?.parentElement;
    if(row&&!$('publishNowBtn')){
      const b=document.createElement('button'); b.type='button'; b.id='publishNowBtn'; b.className='btn primary'; b.textContent='פרסם באתר'; row.insertBefore(b,row.firstChild);
    }

    $('aiManualBtn').onclick=()=>setMode('manual');
    $('aiOwnTopicBtn').onclick=()=>setMode('own');
    $('aiBackToManual').onclick=()=>setMode('manual');
    $('aiTopicsBtn').onclick=()=>{setMode('topics');suggestTopics();};
    $('aiDraftBtn').onclick=()=>runAi('draft','aiDraftBtn',true);
    $('aiTitleBtn').onclick=()=>runAi('seo','aiTitleBtn',false,'title');
    $('aiContentBtn').onclick=()=>runAi('draft','aiContentBtn',false,'content');
    $('aiSeoBtn').onclick=()=>runAi('seo','aiSeoBtn',false,'seo');
    $('aiImageBtn').onclick=generateImage;
    $('saveBtn').onclick=()=>persist(false);
    $('publishNowBtn').onclick=()=>persist(true);
    setMode('manual');
    setActionsReady();
  }

  async function invoke(body){
    const {data,error}=await window.supabaseClient.functions.invoke('generate-site-content',{body});
    if(error)throw error; if(data?.error)throw new Error(data.error); return data;
  }

  async function existingTopics(){
    const {data,error}=await window.supabaseClient.from('site_content').select('title').eq('content_type','article').limit(100);
    if(error)throw error; return (data||[]).map(x=>x.title).filter(Boolean);
  }

  async function suggestTopics(){
    const b=$('aiTopicsBtn'), old=b.textContent; b.disabled=true; b.textContent='מחפש נושאים...';
    try{
      const data=await invoke({mode:'topics',existing_topics:await existingTopics(),audience:'בעלי עסקים, מוכרי עסקים, יזמים, רוכשים ומשקיעים בישראל',goal:'בניית סמכות מקצועית, SEO ופניות איכותיות ל BSD'});
      const topics=data?.topics||[]; if(!topics.length)throw new Error('לא התקבלו נושאים');
      const box=$('aiTopicsBox'); box.style.display='block';
      box.innerHTML=topics.map((t,i)=>`<div style="background:#081a2a;border:1px solid #2a506a;border-radius:12px;padding:11px;margin:8px 0"><b>${i+1}. ${String(t.title||'')}</b><div class="muted">${String(t.angle||'')}</div><button type="button" class="btn primary" data-topic="${i}" style="margin-top:7px">בחר נושא</button></div>`).join('');
      all('[data-topic]',box).forEach(btn=>btn.onclick=()=>{
        const t=topics[Number(btn.dataset.topic)]; $('aiTopic').value=t.title||''; $('title').value=t.title||''; $('keyword').value=t.focus_keyword||'';
        if(!slugTouched)$('slug').value=slugify(t.title||''); $('aiTopicWrap').style.display='block'; notify('הנושא נבחר. אפשר לכתוב לבד או להפעיל AI.');
      });
    }catch(e){notify('יצירת הנושאים נכשלה: '+(e?.message||String(e)),true);}finally{b.disabled=false;b.textContent=old;setActionsReady();}
  }

  function apply(data,kind){
    if(!data)return;
    if(kind==='title'){
      if(data.title)$('title').value=data.title; if(data.seo_title)$('seoTitle').value=data.seo_title;
    }else if(kind==='content'){
      if(data.article_html)$('body').value=data.article_html; if(data.excerpt)$('excerpt').value=data.excerpt; if(data.focus_keyword)$('keyword').value=data.focus_keyword;
    }else if(kind==='seo'){
      if(data.focus_keyword)$('keyword').value=data.focus_keyword; if(data.seo_title)$('seoTitle').value=data.seo_title; if(data.seo_description)$('seoDescription').value=data.seo_description; if(data.excerpt)$('excerpt').value=data.excerpt;
    }else{
      if(data.title)$('title').value=data.title; if(data.slug&&!slugTouched)$('slug').value=slugify(data.slug); if(data.excerpt)$('excerpt').value=data.excerpt; if(data.focus_keyword)$('keyword').value=data.focus_keyword; if(data.seo_title)$('seoTitle').value=data.seo_title; if(data.seo_description)$('seoDescription').value=data.seo_description; if(data.article_html)$('body').value=data.article_html; if(data.image_prompt)$('imagePrompt').value=data.image_prompt;
    }
    ensureSlug();
  }

  async function runAi(mode,buttonId,full=false,kind='full'){
    const b=$(buttonId),old=b.textContent; b.disabled=true;b.textContent='AI עובד...';
    try{
      const topic=val('aiTopic')||val('title'); const current=[val('title'),val('excerpt'),$('body')?.value||''].filter(Boolean).join('\n\n');
      if(!topic&&!current)throw new Error('יש להזין נושא או כותרת');
      const data=await invoke({mode,topic,current_text:current,audience:'בעלי עסקים, יזמים, רוכשים ומשקיעים בישראל',goal:'קידום אורגני ובניית אמון'});
      apply(data,full?'full':kind); notify('הצעת ה AI הוכנסה לעורך. אפשר לערוך, לשמור או לפרסם.');
    }catch(e){notify('עזרת ה AI נכשלה: '+(e?.message||String(e)),true);}finally{b.disabled=false;b.textContent=old;setActionsReady();}
  }

  async function generateImage(){
    const b=$('aiImageBtn'),old=b.textContent;b.disabled=true;b.textContent='יוצר תמונה...';
    try{
      let prompt=val('imagePrompt');
      if(!prompt){const data=await invoke({mode:'image',topic:val('aiTopic')||val('title'),current_text:$('body')?.value||''});prompt=data?.image_prompt||'';if(prompt)$('imagePrompt').value=prompt;}
      if(!prompt)throw new Error('אין הנחיה לתמונה');
      const data=await invoke({mode:'generate_image',image_prompt:prompt,title:val('title'),slug:ensureSlug()});
      if(!data?.image_url)throw new Error('לא התקבלה תמונה'); $('imageUrl').value=data.image_url; $('aiImagePreview').src=data.image_url; $('aiImagePreviewWrap').style.display='block'; notify('התמונה נוצרה ונשמרה.');
    }catch(e){notify('יצירת התמונה נכשלה: '+(e?.message||String(e)),true);}finally{b.disabled=false;b.textContent=old;setActionsReady();}
  }

  async function persist(publish){
    const save=$('saveBtn'),pub=$('publishNowBtn'); const saveText=save.textContent,pubText=pub.textContent;
    save.disabled=true;pub.disabled=true;(publish?pub:save).textContent=publish?'מפרסם באתר...':'שומר...';
    try{
      const title=val('title'),slug=ensureSlug(),body=$('body')?.value||'';
      if(!title)throw new Error('חובה למלא כותרת'); if(!slug)throw new Error('חסרה כתובת למאמר'); if(publish&&!body.trim())throw new Error('אין תוכן לכתבה');
      const {data:s,error:se}=await window.supabaseClient.auth.getSession(); if(se)throw se; const uid=s?.session?.user?.id; if(!uid)throw new Error('יש להתחבר מחדש');
      const id=val('id'); const {data:dups,error:de}=await window.supabaseClient.from('site_content').select('id').eq('slug',slug).limit(2); if(de)throw de; if((dups||[]).some(x=>x.id!==id))throw new Error('כתובת המאמר כבר קיימת');
      const status=publish?'published':(val('status')||'draft'),now=new Date().toISOString();
      const payload={content_type:'article',status,title,slug,focus_keyword:val('keyword')||null,author_name:val('author')||'BSD',excerpt:val('excerpt')||null,seo_title:val('seoTitle')||null,seo_description:val('seoDescription')||null,source_url:val('sourceUrl')||null,featured_image_url:val('imageUrl')||null,featured_image_prompt:val('imagePrompt')||null,editor_html:body,body_html:body,ai_status:publish?'published':'saved',updated_by:uid,updated_at:now}; if(status==='published')payload.published_at=now;
      let r;if(id)r=await window.supabaseClient.from('site_content').update(payload).eq('id',id).select('id,title,slug,status').single();else{payload.created_by=uid;r=await window.supabaseClient.from('site_content').insert(payload).select('id,title,slug,status').single();} if(r.error)throw r.error;
      $('id').value=r.data.id;$('status').value=r.data.status||status;
      if(publish){const url=`https://www.bsd-bbi.co.il/מרכז-ידע-לעסקים/${encodeURIComponent(r.data.slug)}`;const box=$('publishResult');box.style.display='block';box.innerHTML=`<div style="background:#113b2a;border:1px solid #2c7652;border-radius:10px;padding:10px"><b>הכתבה נשמרה ופורסמה באתר</b><div style="margin-top:8px"><a class="btn primary" href="${url}?v=${Date.now()}" target="_blank">פתח את הכתבה באתר</a></div></div>`;notify('הכתבה פורסמה באתר בהצלחה.');}
      else notify('הכתבה נשמרה בהצלחה.');
    }catch(e){notify((publish?'הפרסום נכשל: ':'השמירה נכשלה: ')+(e?.message||String(e)),true);}finally{save.disabled=false;pub.disabled=false;save.textContent=saveText;pub.textContent=pubText;setActionsReady();}
  }

  document.addEventListener('input',e=>{if(e.target?.id==='slug')slugTouched=true;if(e.target?.id==='title'&&!slugTouched&&!val('id'))$('slug').value=slugify(e.target.value);});
  document.addEventListener('DOMContentLoaded',()=>{ensurePanel();$('newBtn')?.addEventListener('click',()=>setTimeout(()=>{slugTouched=false;setMode('manual');setActionsReady();},0));});
  setTimeout(ensurePanel,250);
})();
