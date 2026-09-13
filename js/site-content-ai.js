'use strict';
(function(){
  const $=id=>document.getElementById(id);
  const val=id=>($(id)?.value||'').trim();
  const all=(sel,root=document)=>Array.from(root.querySelectorAll(sel));
  let slugTouched=false;
  let mode='manual';
  let generating=false;

  function notify(message,isError=false){
    const t=$('toast');
    if(!t){console[isError?'error':'log'](message);return;}
    t.textContent=message;
    t.className='toast show'+(isError?' err':'');
    clearTimeout(notify.timer);
    notify.timer=setTimeout(()=>t.classList.remove('show'),4600);
  }

  function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function slugify(v){return String(v||'').trim().toLowerCase().replace(/["'׳״.,:;!?()[\]{}<>\/\\|@#$%^&*+=~`]+/g,' ').replace(/\s+/g,'-').replace(/-+/g,'-').replace(/^-+|-+$/g,'').slice(0,90)||'article';}
  function ensureSlug(){const f=$('slug');if(!f)return '';if(!f.value.trim())f.value=slugify(val('title')||val('aiTopic'));return f.value.trim();}
  function currentText(){return [val('title'),val('excerpt'),$('body')?.value||''].filter(Boolean).join('\n\n');}

  function setActionBar(){
    const save=$('saveBtn'),publish=$('publishNowBtn'),row=save?.parentElement;
    if(save){save.type='button';save.style.pointerEvents='auto';}
    if(publish){publish.type='button';publish.style.pointerEvents='auto';}
    if(row){
      row.style.position='sticky';row.style.bottom='0';row.style.zIndex='150';row.style.background='#0b1c2d';
      row.style.padding='12px 8px';row.style.margin='16px -8px -8px';row.style.borderTop='1px solid #345b76';
      row.style.boxShadow='0 -8px 24px rgba(1,7,12,.5)';row.style.pointerEvents='auto';
    }
  }

  function setWorking(on,text='AI מכין את הכתבה המלאה...'){
    generating=on;
    const box=$('aiProgress');
    if(box){box.hidden=!on;box.textContent=text;}
    all('#aiContentPanel button').forEach(b=>{if(!['saveBtn','publishNowBtn'].includes(b.id))b.disabled=on;});
  }

  function setMode(next){
    mode=next;
    const own=$('aiTopicWrap'),topics=$('aiTopicsBox'),hint=$('aiModeHint');
    all('[data-ai-mode]').forEach(b=>{b.classList.toggle('primary',b.dataset.aiMode===next);});
    if(next==='manual'){
      if(own)own.style.display='none';if(topics)topics.style.display='none';
      if(hint)hint.innerHTML='<b>כתיבה עצמאית</b><br>כתוב ישירות בשדות למטה. אם תרצה לפרסם וחסרים שדות SEO, המערכת תשלים אותם לפני הפרסום.';
      setTimeout(()=>$('title')?.focus(),50);
    }else if(next==='own'){
      if(own)own.style.display='block';if(topics)topics.style.display='none';
      if(hint)hint.innerHTML='<b>יש לי נושא, כותרת או חומר גלם</b><br>כתוב כאן רעיון, ובמידת הצורך הוסף תוכן משלך בשדה הכתבה. לחיצה על הכפתור תפיק כתבה מלאה ותמלא את כל שדות ה SEO.';
      setTimeout(()=>$('aiTopic')?.focus(),50);
    }else{
      if(own)own.style.display='block';
      if(hint)hint.innerHTML='<b>הצעות נושאים</b><br>בחר נושא אחד. מיד לאחר הבחירה המערכת תפיק אוטומטית כתבה מלאה ותמלא כותרת, תקציר, תוכן וכל שדות ה SEO.';
    }
  }

  function resetPanel(){
    slugTouched=false;mode='manual';generating=false;
    if($('aiTopic'))$('aiTopic').value='';
    if($('aiTopicsBox')){$('aiTopicsBox').innerHTML='';$('aiTopicsBox').style.display='none';}
    if($('publishResult')){$('publishResult').innerHTML='';$('publishResult').style.display='none';}
    if($('aiProgress'))$('aiProgress').hidden=true;
    setMode('manual');setActionBar();
  }

  function ensurePanel(){
    const body=document.querySelector('#modal .modalbody');
    if(!body)return;
    if(!$('aiContentPanel')){
      const panel=document.createElement('section');
      panel.id='aiContentPanel';panel.className='notice';panel.style.marginBottom='14px';
      panel.innerHTML=`
        <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap">
          <div><b style="font-size:16px">עוזר יצירת תוכן BSD</b><div class="muted" style="margin-top:4px">שלושה מסלולים פשוטים. תמיד אפשר לערוך את התוצאה לפני שמירה או פרסום.</div></div>
          <button type="button" class="btn" id="aiBackToManual">מעבר לכתיבה עצמאית</button>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(185px,1fr));gap:8px;margin-top:12px">
          <button type="button" class="btn primary" data-ai-mode="manual" id="aiManualBtn">אני כותב לבד</button>
          <button type="button" class="btn" data-ai-mode="own" id="aiOwnTopicBtn">יש לי נושא או תוכן</button>
          <button type="button" class="btn" data-ai-mode="topics" id="aiTopicsBtn">הצע לי 8 נושאים</button>
        </div>
        <div id="aiModeHint" style="margin-top:10px;line-height:1.55"></div>
        <div id="aiProgress" hidden style="margin-top:10px;padding:10px;border-radius:10px;background:#081a2a;border:1px solid #2a506a;font-weight:800"></div>
        <div id="aiTopicsBox" style="display:none;margin-top:12px"></div>
        <div id="aiTopicWrap" style="display:none;margin-top:12px">
          <label style="display:block;font-size:12px;color:#aab8c6;margin-bottom:5px">נושא, כותרת או הנחיה לכתבה</label>
          <textarea id="aiTopic" class="textarea" style="min-height:88px" placeholder="למשל: איך להכין עסק למכירה בצורה דיסקרטית. אפשר גם להדביק כאן חומר גלם או נקודות חשובות."></textarea>
          <div class="actions" style="margin-top:9px">
            <button type="button" class="btn primary" id="aiDraftBtn">הפק כתבה מלאה ומלא את כל השדות</button>
            <button type="button" class="btn" id="aiSeoBtn">שפר SEO בלבד</button>
            <button type="button" class="btn" id="aiImageBtn">צור תמונת כותרת</button>
          </div>
        </div>
        <div id="aiImagePreviewWrap" style="display:none;margin-top:12px"><div style="font-weight:800;margin-bottom:6px">תמונת הכותרת</div><img id="aiImagePreview" alt="תמונת כותרת" style="width:100%;max-height:360px;object-fit:contain;background:#071423;border-radius:12px;border:1px solid #2a506a"></div>
        <div id="publishResult" style="display:none;margin-top:12px"></div>`;
      body.insertBefore(panel,body.firstChild);
    }

    const row=$('saveBtn')?.parentElement;
    if(row&&!$('publishNowBtn')){
      const publish=document.createElement('button');publish.type='button';publish.id='publishNowBtn';publish.className='btn primary';publish.textContent='פרסם באתר';row.insertBefore(publish,row.firstChild);
    }

    $('aiManualBtn').onclick=()=>setMode('manual');
    $('aiOwnTopicBtn').onclick=()=>setMode('own');
    $('aiBackToManual').onclick=()=>setMode('manual');
    $('aiTopicsBtn').onclick=()=>{setMode('topics');suggestTopics();};
    $('aiDraftBtn').onclick=()=>generateFullArticle('own');
    $('aiSeoBtn').onclick=()=>improveSeo();
    $('aiImageBtn').onclick=generateImage;
    $('saveBtn').onclick=()=>persist(false);
    $('publishNowBtn').onclick=()=>persist(true);
    setMode('manual');setActionBar();
  }

  async function invokeGenerate(body){
    const {data,error}=await window.supabaseClient.functions.invoke('generate-site-content',{body});
    if(error)throw error;if(data?.error)throw new Error(data.error);return data;
  }

  async function invokeSave(body){
    const {data,error}=await window.supabaseClient.functions.invoke('save-site-content',{body});
    if(error)throw error;if(data?.error)throw new Error(data.error);return data;
  }

  async function existingTopics(){
    const {data,error}=await window.supabaseClient.from('site_content').select('title').eq('content_type','article').limit(150);
    if(error)throw error;return(data||[]).map(x=>x.title).filter(Boolean);
  }

  function applyFull(data){
    if(!data)return;
    if(data.title)$('title').value=data.title;
    if(data.slug&&!slugTouched)$('slug').value=slugify(data.slug);
    if(data.excerpt)$('excerpt').value=data.excerpt;
    if(data.focus_keyword)$('keyword').value=data.focus_keyword;
    if(data.seo_title)$('seoTitle').value=data.seo_title;
    if(data.seo_description)$('seoDescription').value=data.seo_description;
    if(data.article_html)$('body').value=data.article_html;
    if(data.image_prompt)$('imagePrompt').value=data.image_prompt;
    ensureSlug();
  }

  function applySeo(data){
    if(!data)return;
    if(data.title&&!val('title'))$('title').value=data.title;
    if(data.focus_keyword)$('keyword').value=data.focus_keyword;
    if(data.seo_title)$('seoTitle').value=data.seo_title;
    if(data.seo_description)$('seoDescription').value=data.seo_description;
    if(data.excerpt)$('excerpt').value=data.excerpt;
    if(data.image_prompt&&!val('imagePrompt'))$('imagePrompt').value=data.image_prompt;
    ensureSlug();
  }

  async function suggestTopics(){
    const button=$('aiTopicsBtn'),old=button.textContent;button.disabled=true;button.textContent='מכין הצעות...';
    try{
      const data=await invokeGenerate({mode:'topics',existing_topics:await existingTopics(),audience:'בעלי עסקים, מוכרי עסקים, יזמים, רוכשים ומשקיעים בישראל',goal:'תוכן מקצועי שימושי שמחזק סמכות, קידום אורגני ופניות איכותיות ל BSD'});
      const topics=data?.topics||[];if(!topics.length)throw new Error('לא התקבלו נושאים');
      const box=$('aiTopicsBox');box.style.display='block';
      box.innerHTML=`<div style="font-weight:800;margin-bottom:8px">בחר נושא אחד. הכתבה המלאה תיווצר אוטומטית.</div><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:9px">${topics.map((t,i)=>`<article style="background:#081a2a;border:1px solid #2a506a;border-radius:12px;padding:11px;display:flex;flex-direction:column;gap:7px"><b style="line-height:1.4">${i+1}. ${esc(t.title)}</b><div class="muted">${esc(t.angle||'')}</div><div style="font-size:12px"><b>מילת מפתח:</b> ${esc(t.focus_keyword||'')}</div><div style="font-size:12px;color:#b9c9d7">${esc(t.why||'')}</div><button type="button" class="btn primary" data-topic="${i}">בחר והפק כתבה</button></article>`).join('')}</div>`;
      all('[data-topic]',box).forEach(btn=>btn.onclick=async()=>{
        const t=topics[Number(btn.dataset.topic)];if(!t)return;
        $('aiTopic').value=[t.title,t.angle?`זווית: ${t.angle}`:''].filter(Boolean).join('\n');
        $('title').value=t.title||'';$('keyword').value=t.focus_keyword||'';
        if(!slugTouched)$('slug').value=slugify(t.title||'');
        all('[data-topic]',box).forEach(b=>{b.disabled=true;b.textContent='בחר והפק כתבה';});
        btn.textContent='מכין כתבה מלאה...';
        await generateFullArticle('topic');
        all('[data-topic]',box).forEach(b=>{b.disabled=false;b.textContent='בחר והפק כתבה';});
        btn.textContent='נבחר והוכן';
      });
      box.scrollIntoView({behavior:'smooth',block:'nearest'});
    }catch(e){notify('יצירת הנושאים נכשלה: '+(e?.message||String(e)),true);}finally{button.disabled=false;button.textContent=old;setActionBar();}
  }

  async function generateFullArticle(origin){
    if(generating)return;
    const topic=val('aiTopic')||val('title');const current=currentText();
    if(!topic&&!current){notify('יש להזין נושא, כותרת או תוכן',true);return;}
    setWorking(true,origin==='topic'?'הנושא נבחר. מכין כעת כתבה מלאה ואת כל שדות ה SEO...':'מכין כתבה מלאה ואת כל שדות ה SEO...');
    try{
      const data=await invokeGenerate({mode:'draft',topic,current_text:current,audience:'בעלי עסקים, מוכרי עסקים, יזמים, רוכשים ומשקיעים בישראל',goal:'כתבה מקצועית, שימושית ואמינה שמתאימה לקידום אורגני ולמרכז הידע של BSD'});
      applyFull(data);
      if($('status'))$('status').value='draft';
      notify('הכתבה הושלמה. כל השדות המרכזיים ונתוני ה SEO מולאו ואפשר לערוך, לשמור או לפרסם.');
      setTimeout(()=>$('title')?.scrollIntoView({behavior:'smooth',block:'start'}),80);
    }catch(e){notify('יצירת הכתבה נכשלה: '+(e?.message||String(e))+'. התוכן שכבר הוזן נשמר בעורך.',true);}finally{setWorking(false);setActionBar();}
  }

  async function improveSeo(silent=false){
    const topic=val('aiTopic')||val('title');const current=currentText();
    if(!topic&&!current){if(!silent)notify('אין עדיין תוכן לשיפור',true);return false;}
    if(!silent)setWorking(true,'משלים ומשפר את שדות ה SEO...');
    try{
      const data=await invokeGenerate({mode:'seo',topic,current_text:current,audience:'בעלי עסקים, מוכרי עסקים, יזמים, רוכשים ומשקיעים בישראל',goal:'SEO טבעי, שימושיות גבוהה ותיאור מדויק של הכתבה'});
      applySeo(data);if(!silent)notify('שדות ה SEO והתקציר עודכנו.');return true;
    }catch(e){if(!silent)notify('שיפור ה SEO נכשל: '+(e?.message||String(e)),true);return false;}finally{if(!silent)setWorking(false);setActionBar();}
  }

  async function generateImage(){
    if(generating)return;
    const button=$('aiImageBtn'),old=button.textContent;button.disabled=true;button.textContent='יוצר תמונה...';
    try{
      let prompt=val('imagePrompt');
      if(!prompt){const data=await invokeGenerate({mode:'image',topic:val('aiTopic')||val('title'),current_text:currentText()});prompt=data?.image_prompt||'';if(prompt)$('imagePrompt').value=prompt;}
      if(!prompt)throw new Error('אין מספיק מידע ליצירת תמונה');
      const data=await invokeGenerate({mode:'generate_image',image_prompt:prompt,title:val('title'),slug:ensureSlug()});
      if(!data?.image_url)throw new Error('לא התקבלה תמונה');
      $('imageUrl').value=data.image_url;$('aiImagePreview').src=data.image_url;$('aiImagePreviewWrap').style.display='block';notify('תמונת הכותרת נוצרה ונשמרה.');
    }catch(e){notify('יצירת התמונה נכשלה: '+(e?.message||String(e)),true);}finally{button.disabled=false;button.textContent=old;setActionBar();}
  }

  async function ensureSeoForPublish(){
    const missing=!val('seoTitle')||!val('seoDescription')||!val('keyword')||!val('excerpt');
    if(!missing)return true;
    const progress=$('aiProgress');if(progress){progress.hidden=false;progress.textContent='משלים אוטומטית SEO לפני הפרסום...';}
    const ok=await improveSeo(true);
    if(progress)progress.hidden=true;
    return ok;
  }

  async function persist(publish){
    if(generating){notify('המערכת עדיין מכינה את הכתבה. נסה שוב לאחר סיום יצירת התוכן.',true);return;}
    const save=$('saveBtn'),pub=$('publishNowBtn');const saveText=save.textContent,pubText=pub.textContent;
    save.disabled=true;pub.disabled=true;(publish?pub:save).textContent=publish?'מפרסם באתר...':'שומר...';
    try{
      const title=val('title'),body=$('body')?.value||'';
      if(!title)throw new Error('חובה למלא כותרת');if(publish&&!body.trim())throw new Error('אין תוכן לכתבה');
      ensureSlug();
      if(publish){const seoReady=await ensureSeoForPublish();if(!seoReady)throw new Error('לא ניתן להשלים את שדות ה SEO. הכתבה לא פורסמה כדי לא לפרסם תוכן חלקי.');}
      const data=await invokeSave({
        publish,id:val('id')||null,status:val('status')||'draft',title:val('title'),slug:ensureSlug(),excerpt:val('excerpt'),
        focus_keyword:val('keyword'),author_name:val('author')||'BSD',seo_title:val('seoTitle'),seo_description:val('seoDescription'),
        source_url:val('sourceUrl'),featured_image_url:val('imageUrl'),featured_image_prompt:val('imagePrompt'),body_html:$('body')?.value||'',
        ai_status:mode==='manual'?'manual':'ai_assisted'
      });
      const article=data?.article;if(!article?.id)throw new Error('השרת לא החזיר אישור שמירה');
      $('id').value=article.id;$('slug').value=article.slug;$('status').value=article.status;
      if(publish){
        const url=`https://www.bsd-bbi.co.il/מרכז-ידע-לעסקים/${encodeURIComponent(article.slug)}`;
        const result=$('publishResult');result.style.display='block';result.innerHTML=`<div style="background:#113b2a;border:1px solid #2c7652;border-radius:10px;padding:11px;line-height:1.5"><b>הכתבה נשמרה ופורסמה באתר</b><div class="muted" style="margin-top:4px">היא זמינה במרכז הידע וניתנת לעריכה מחדש בכל עת.</div><div style="margin-top:8px"><a class="btn primary" href="${esc(url)}?v=${Date.now()}" target="_blank" rel="noopener">פתח את הכתבה באתר</a></div></div>`;
        notify('הכתבה נשמרה ופורסמה באתר בהצלחה.');
      }else notify('הכתבה נשמרה כטיוטה או במצב שבחרת.');
      if(typeof window.load==='function')await window.load();
    }catch(e){notify((publish?'הפרסום נכשל: ':'השמירה נכשלה: ')+(e?.message||String(e)),true);}finally{save.disabled=false;pub.disabled=false;save.textContent=saveText;pub.textContent=pubText;setActionBar();}
  }

  document.addEventListener('input',e=>{
    if(e.target?.id==='slug')slugTouched=true;
    if(e.target?.id==='title'&&!slugTouched&&!val('id')&&$('slug'))$('slug').value=slugify(e.target.value);
  });
  document.addEventListener('click',e=>{if(e.target.closest?.('[data-edit]'))setTimeout(()=>{slugTouched=true;setMode('manual');setActionBar();},0);});
  document.addEventListener('DOMContentLoaded',()=>{ensurePanel();$('newBtn')?.addEventListener('click',()=>setTimeout(resetPanel,0));});
  setTimeout(ensurePanel,250);
})();