'use strict';
(function(){
  const $=id=>document.getElementById(id);
  const qs=(sel,root=document)=>root.querySelector(sel);
  const qsa=(sel,root=document)=>Array.from(root.querySelectorAll(sel));
  let slugTouched=false;
  let editorMode='manual';

  function notify(message,isError=false){
    const toast=$('toast');
    if(toast){
      toast.textContent=message;
      toast.className='toast show'+(isError?' err':'');
      clearTimeout(notify.timer);
      notify.timer=setTimeout(()=>toast.classList.remove('show'),3600);
      return;
    }
    console[isError?'error':'log'](message);
  }

  function value(id){ return ($(id)?.value||'').trim(); }
  function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function slugify(v){
    return String(v||'')
      .trim()
      .toLowerCase()
      .replace(/["'׳״.,:;!?()[\]{}<>\/\\|@#$%^&*+=~`]+/g,' ')
      .replace(/\s+/g,'-')
      .replace(/-+/g,'-')
      .replace(/^-+|-+$/g,'')
      .slice(0,90) || 'article';
  }

  function ensureSlug(){
    const slug=$('slug');
    if(!slug) return '';
    if(!slug.value.trim()) slug.value=slugify(value('title')||value('aiTopic'));
    return slug.value.trim();
  }

  function setMode(mode){
    editorMode=mode;
    const topicWrap=$('aiTopicWrap');
    const topicsBox=$('aiTopicsBox');
    const hint=$('aiModeHint');
    qsa('[data-ai-mode]').forEach(btn=>btn.style.opacity=btn.dataset.aiMode===mode?'1':'.72');

    if(mode==='manual'){
      if(topicWrap) topicWrap.style.display='none';
      if(topicsBox) topicsBox.style.display='none';
      if(hint) hint.innerHTML='<b>כתיבה ידנית</b> אפשר לכתוב ולערוך את כל השדות לבד. ה AI לא משנה דבר עד שלוחצים במפורש על אחת מפעולות העזרה.';
      setTimeout(()=>$('title')?.focus(),30);
    }else if(mode==='own'){
      if(topicWrap) topicWrap.style.display='block';
      if(hint) hint.innerHTML='<b>יש לי נושא או כותרת</b> כתוב את הרעיון שלך. אפשר לבקש מה AI ליצור כתבה מלאה, לשפר רק את הכותרת, לשפר את התוכן או לטפל ב SEO.';
      setTimeout(()=>$('aiTopic')?.focus(),30);
    }else if(mode==='topics'){
      if(topicWrap) topicWrap.style.display='block';
      if(hint) hint.innerHTML='<b>בחירת נושא מוצע</b> בחירת נושא רק מכניסה אותו לעורך. היא לא מפעילה כתיבה אוטומטית ולא נועלת את המסך.';
    }
  }

  function resetAiPanel(){
    if($('aiTopic')) $('aiTopic').value='';
    if($('aiTopicsBox')){ $('aiTopicsBox').innerHTML=''; $('aiTopicsBox').style.display='none'; }
    if($('publishResult')){ $('publishResult').innerHTML=''; $('publishResult').style.display='none'; }
    slugTouched=false;
    setMode('manual');
    syncImagePreview();
  }

  function ensurePanel(){
    const body=qs('#modal .modalbody');
    if(!body||$('aiContentPanel')) return;

    const panel=document.createElement('div');
    panel.id='aiContentPanel';
    panel.className='notice';
    panel.style.marginBottom='14px';
    panel.innerHTML=`
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap">
        <div>
          <b style="font-size:15px">יצירת מאמר</b>
          <div class="muted" style="margin-top:4px">בחר איך לעבוד. בכל מצב אפשר לעבור מיד לכתיבה ידנית.</div>
        </div>
        <button type="button" class="btn" id="aiBackToManual">חזרה לכתיבה ידנית</button>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;margin-top:12px">
        <button type="button" class="btn primary" data-ai-mode="manual" id="aiManualBtn">כתוב לבד</button>
        <button type="button" class="btn" data-ai-mode="own" id="aiOwnTopicBtn">יש לי נושא או כותרת</button>
        <button type="button" class="btn" data-ai-mode="topics" id="aiTopicsBtn">הצע לי 8 נושאים</button>
      </div>

      <div id="aiModeHint" style="margin-top:10px;line-height:1.55"></div>
      <div id="aiTopicsBox" style="display:none;margin-top:12px"></div>

      <div id="aiTopicWrap" style="display:none;margin-top:12px">
        <label style="display:block;font-size:12px;color:#aab8c6;margin-bottom:5px">הנושא או הרעיון למאמר</label>
        <textarea id="aiTopic" class="textarea" style="min-height:74px" placeholder="למשל: איך להכין עסק למכירה בלי לפגוע בפעילות השוטפת"></textarea>
        <div class="actions" style="margin-top:9px">
          <button type="button" class="btn primary" id="aiDraftBtn">צור כתבה מלאה עם AI</button>
          <button type="button" class="btn" id="aiTitleBtn">שפר כותרת</button>
          <button type="button" class="btn" id="aiContentBtn">שפר תוכן</button>
          <button type="button" class="btn" id="aiSeoBtn">שפר SEO</button>
          <button type="button" class="btn" id="aiImageBtn">צור תמונת כותרת</button>
        </div>
      </div>

      <div id="aiImagePreviewWrap" style="display:none;margin-top:12px">
        <div style="font-weight:800;margin-bottom:6px">תמונת הכותרת שנוצרה</div>
        <img id="aiImagePreview" alt="תמונת כותרת" style="width:100%;max-height:360px;object-fit:contain;background:#071423;border-radius:12px;border:1px solid #2a506a">
      </div>
      <div id="publishResult" style="display:none;margin-top:12px"></div>`;
    body.insertBefore(panel,body.firstChild);

    const actionRow=$('saveBtn')?.parentElement;
    if(actionRow&&!$('publishNowBtn')){
      const publish=document.createElement('button');
      publish.type='button';
      publish.className='btn primary';
      publish.id='publishNowBtn';
      publish.textContent='פרסם באתר';
      actionRow.insertBefore(publish,actionRow.firstChild);
      publish.onclick=publishNow;
    }

    $('aiManualBtn').onclick=()=>setMode('manual');
    $('aiOwnTopicBtn').onclick=()=>setMode('own');
    $('aiBackToManual').onclick=()=>setMode('manual');
    $('aiTopicsBtn').onclick=async()=>{setMode('topics');await suggestTopics();};
    $('aiDraftBtn').onclick=()=>createFullDraft();
    $('aiTitleBtn').onclick=()=>improveTitle();
    $('aiContentBtn').onclick=()=>improveContent();
    $('aiSeoBtn').onclick=()=>improveSeo();
    $('aiImageBtn').onclick=generateImage;

    setMode('manual');
    syncImagePreview();
  }

  function syncImagePreview(){
    const url=value('imageUrl');
    const wrap=$('aiImagePreviewWrap'),img=$('aiImagePreview');
    if(!wrap||!img)return;
    if(url){ img.src=url; wrap.style.display='block'; }
    else{ img.removeAttribute('src'); wrap.style.display='none'; }
  }

  async function existingTopics(){
    try{
      const {data,error}=await window.supabaseClient.from('site_content').select('title').eq('content_type','article').limit(100);
      if(error) throw error;
      return (data||[]).map(x=>x.title).filter(Boolean);
    }catch(e){
      return qsa('#rows tr td:first-child b').map(x=>x.textContent.trim()).filter(Boolean);
    }
  }

  function renderTopics(topics){
    const box=$('aiTopicsBox');
    if(!box)return;
    box.style.display='block';
    box.innerHTML=`<div style="font-weight:800;margin-bottom:8px">בחר נושא. אחרי הבחירה אפשר לערוך לבד או לבקש מה AI להמשיך.</div><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:9px">${topics.map((t,i)=>`
      <div style="background:#081a2a;border:1px solid #2a506a;border-radius:12px;padding:11px;display:flex;flex-direction:column;gap:7px">
        <div style="font-weight:800;line-height:1.4">${i+1}. ${esc(t.title)}</div>
        <div class="muted">${esc(t.angle||'')}</div>
        <div style="font-size:12px"><b>מילת מפתח:</b> ${esc(t.focus_keyword||'')}</div>
        <div style="font-size:12px;color:#b9c9d7">${esc(t.why||'')}</div>
        <button type="button" class="btn primary" data-ai-topic="${i}">בחר נושא</button>
      </div>`).join('')}</div>`;

    qsa('[data-ai-topic]',box).forEach(btn=>btn.onclick=()=>{
      const t=topics[Number(btn.dataset.aiTopic)];
      if(!t)return;
      $('aiTopic').value=`${t.title}${t.angle?`\nזווית: ${t.angle}`:''}`;
      if($('title')) $('title').value=t.title||'';
      if($('keyword')) $('keyword').value=t.focus_keyword||'';
      if(!$('id')?.value && !slugTouched && $('slug')) $('slug').value=slugify(t.title||'');
      qsa('[data-ai-topic]',box).forEach(b=>{b.classList.remove('primary');b.textContent='בחר נושא';});
      btn.classList.add('primary');
      btn.textContent='נבחר';
      if($('aiModeHint')) $('aiModeHint').innerHTML='<b>הנושא נכנס לעורך.</b> אפשר לשנות את הכותרת והתוכן ידנית, או ללחוץ על יצירת כתבה מלאה עם AI.';
      $('aiTopicWrap').style.display='block';
      notify('הנושא נבחר ונכנס לעורך. שום דבר לא נכתב אוטומטית.');
      setTimeout(()=>$('title')?.scrollIntoView({behavior:'smooth',block:'center'}),60);
    });
    box.scrollIntoView({behavior:'smooth',block:'nearest'});
  }

  async function suggestTopics(){
    const button=$('aiTopicsBtn');
    if(!button)return;
    const old=button.textContent;
    button.disabled=true;
    button.textContent='מחפש נושאים מתאימים...';
    try{
      const existing=await existingTopics();
      const {data,error}=await window.supabaseClient.functions.invoke('generate-site-content',{body:{mode:'topics',existing_topics:existing,audience:'בעלי עסקים, מוכרי עסקים, יזמים, רוכשים ומשקיעים בישראל',goal:'לבנות סמכות מקצועית ל BSD, לחזק קידום אורגני ולהביא פניות איכותיות'}});
      if(error) throw error;
      if(data?.error) throw new Error(data.error);
      if(!Array.isArray(data?.topics)||!data.topics.length) throw new Error('לא התקבלו נושאים');
      renderTopics(data.topics);
      notify('הוכנו נושאים חדשים. בחר נושא אחד להמשך.');
    }catch(e){
      notify('יצירת נושאים נכשלה: '+(e?.message||String(e)),true);
      if($('aiModeHint')) $('aiModeHint').innerHTML='<b>לא הצלחנו כרגע להציע נושאים.</b> הכתיבה הידנית עדיין זמינה במלואה, ואפשר גם לעבור למסלול יש לי נושא או כותרת.';
    }finally{
      button.disabled=false;
      button.textContent=old;
    }
  }

  function currentText(){
    return [value('title'),value('excerpt'),$('body')?.value||''].filter(Boolean).join('\n\n');
  }

  async function requestAi(mode,buttonId){
    const topic=value('aiTopic')||value('title');
    const current=currentText();
    if(!topic&&!current){notify('יש לבחור או להזין נושא לכתבה',true);return null;}
    const button=$(buttonId);
    const old=button?.textContent||'';
    if(button){button.disabled=true;button.textContent='AI עובד...';}
    try{
      const {data,error}=await window.supabaseClient.functions.invoke('generate-site-content',{body:{mode,topic,current_text:current,audience:'בעלי עסקים, יזמים, רוכשים ומשקיעים בישראל',goal:'קידום אורגני, בניית אמון והנעת פנייה מקצועית ל BSD'}});
      if(error) throw error;
      if(data?.error) throw new Error(data.error);
      return data||null;
    }catch(e){
      notify('עזרת ה AI נכשלה: '+(e?.message||String(e))+'. אפשר להמשיך לכתוב ידנית בלי לאבד דבר.',true);
      return null;
    }finally{
      if(button){button.disabled=false;button.textContent=old;}
    }
  }

  function applyCore(data,{title=true,body=true,seo=true,imagePrompt=true}={}){
    if(!data)return;
    if(title&&data.title) $('title').value=data.title;
    if(!$('id')?.value && !slugTouched && data.slug) $('slug').value=slugify(data.slug);
    if(data.excerpt) $('excerpt').value=data.excerpt;
    if(data.focus_keyword) $('keyword').value=data.focus_keyword;
    if(seo&&data.seo_title) $('seoTitle').value=data.seo_title;
    if(seo&&data.seo_description) $('seoDescription').value=data.seo_description;
    if(body&&data.article_html) $('body').value=data.article_html;
    if(imagePrompt&&data.image_prompt) $('imagePrompt').value=data.image_prompt;
    ensureSlug();
  }

  async function createFullDraft(){
    const data=await requestAi('draft','aiDraftBtn');
    if(!data)return;
    applyCore(data,{title:true,body:true,seo:true,imagePrompt:true});
    notify('הכתבה המלאה הוכנסה לעורך. אפשר לערוך כל חלק לפני שמירה או פרסום.');
  }

  async function improveTitle(){
    const data=await requestAi('seo','aiTitleBtn');
    if(!data)return;
    if(data.title) $('title').value=data.title;
    if(data.seo_title) $('seoTitle').value=data.seo_title;
    if(!$('id')?.value && !slugTouched) $('slug').value=slugify(value('title'));
    notify('הכותרת שופרה. אפשר להמשיך לערוך אותה ידנית.');
  }

  async function improveContent(){
    if(!value('body')){
      notify('אין עדיין תוכן לשיפור. אפשר ליצור כתבה מלאה מהנושא.',true);
      return;
    }
    const originalTitle=value('title');
    const data=await requestAi('draft','aiContentBtn');
    if(!data)return;
    if(data.article_html) $('body').value=data.article_html;
    if(data.excerpt) $('excerpt').value=data.excerpt;
    if(data.focus_keyword) $('keyword').value=data.focus_keyword;
    if(data.image_prompt) $('imagePrompt').value=data.image_prompt;
    if(originalTitle) $('title').value=originalTitle;
    notify('התוכן שופר והוכנס לעורך. הכותרת המקורית נשמרה.');
  }

  async function improveSeo(){
    const data=await requestAi('seo','aiSeoBtn');
    if(!data)return;
    if(data.focus_keyword) $('keyword').value=data.focus_keyword;
    if(data.seo_title) $('seoTitle').value=data.seo_title;
    if(data.seo_description) $('seoDescription').value=data.seo_description;
    if(data.excerpt) $('excerpt').value=data.excerpt;
    notify('שדות ה SEO והתקציר עודכנו. תוכן הכתבה לא הוחלף.');
  }

  async function generateImage(){
    const button=$('aiImageBtn');
    if(!button)return;
    const old=button.textContent;
    button.disabled=true;
    button.textContent='יוצר תמונה...';
    try{
      if(!value('imagePrompt')){
        const data=await requestAi('image','aiImageBtn');
        if(data?.image_prompt) $('imagePrompt').value=data.image_prompt;
      }
      const prompt=value('imagePrompt')||value('title')||value('aiTopic');
      if(!prompt) throw new Error('אין מספיק מידע ליצירת תמונה');
      const {data,error}=await window.supabaseClient.functions.invoke('generate-site-content',{body:{mode:'generate_image',image_prompt:prompt,title:value('title'),slug:ensureSlug()}});
      if(error) throw error;
      if(data?.error) throw new Error(data.error);
      if(!data?.image_url) throw new Error('לא התקבלה כתובת תמונה');
      $('imageUrl').value=data.image_url;
      syncImagePreview();
      notify('תמונת הכותרת נוצרה ונשמרה.');
    }catch(e){
      notify('יצירת התמונה נכשלה: '+(e?.message||String(e)),true);
    }finally{
      button.disabled=false;
      button.textContent=old;
    }
  }

  function publicUrl(slug,sourceUrl){
    if(sourceUrl) return sourceUrl;
    return `https://www.bsd-bbi.co.il/מרכז-ידע-לעסקים/${encodeURIComponent(slug)}`;
  }

  async function publishNow(){
    const button=$('publishNowBtn');
    if(!button)return;
    const old=button.textContent;
    button.disabled=true;
    button.textContent='מפרסם באתר...';
    try{
      const title=value('title');
      const slug=ensureSlug();
      const bodyHtml=$('body')?.value||'';
      if(!title) throw new Error('חובה למלא כותרת');
      if(!slug) throw new Error('לא ניתן ליצור כתובת למאמר');
      if(!bodyHtml.trim()) throw new Error('אין תוכן לכתבה');

      const {data:sess}=await window.supabaseClient.auth.getSession();
      const userId=sess?.session?.user?.id;
      if(!userId) throw new Error('לא מחובר');

      const id=value('id');
      const {data:conflicts,error:conflictError}=await window.supabaseClient.from('site_content').select('id').eq('slug',slug).limit(2);
      if(conflictError) throw conflictError;
      if((conflicts||[]).some(x=>x.id!==id)) throw new Error('כתובת ה Slug כבר קיימת. שנה מעט את הכותרת או את ה Slug.');

      const payload={
        content_type:'article',status:'published',title,slug,
        focus_keyword:value('keyword')||null,author_name:value('author')||'BSD',excerpt:value('excerpt')||null,
        seo_title:value('seoTitle')||null,seo_description:value('seoDescription')||null,source_url:value('sourceUrl')||null,
        featured_image_url:value('imageUrl')||null,featured_image_prompt:value('imagePrompt')||null,
        editor_html:bodyHtml,body_html:bodyHtml,ai_status:editorMode==='manual'?'manual_published':'ai_assisted_published',
        updated_by:userId,updated_at:new Date().toISOString(),published_at:new Date().toISOString()
      };

      let res;
      if(id){
        res=await window.supabaseClient.from('site_content').update(payload).eq('id',id).select('id,title,slug,source_url').single();
      }else{
        payload.created_by=userId;
        res=await window.supabaseClient.from('site_content').insert(payload).select('id,title,slug,source_url').single();
      }
      if(res.error) throw res.error;

      if($('id')) $('id').value=res.data.id;
      if($('status')) $('status').value='published';
      const url=publicUrl(res.data.slug,res.data.source_url);
      const box=$('publishResult');
      if(box){
        box.style.display='block';
        box.innerHTML=`<div style="background:#113b2a;border:1px solid #2c7652;border-radius:10px;padding:10px;line-height:1.5"><b>הכתבה נשמרה ופורסמה באתר</b><div class="muted" style="margin-top:4px">אפשר לפתוח אותה עכשיו, להמשיך לערוך ולפרסם שוב בכל עת.</div><div class="actions" style="margin-top:8px"><a class="btn primary" href="${esc(url)}?v=${Date.now()}" target="_blank" rel="noopener">פתח את הכתבה באתר</a><button type="button" class="btn" id="closeReloadBtn">סגור ורענן רשימה</button></div></div>`;
        $('closeReloadBtn').onclick=()=>location.reload();
      }
      notify('הכתבה פורסמה באתר בהצלחה.');
    }catch(e){
      notify('הפרסום נכשל: '+(e?.message||String(e)),true);
    }finally{
      button.disabled=false;
      button.textContent=old;
    }
  }

  document.addEventListener('input',e=>{
    if(!e.target)return;
    if(e.target.id==='imageUrl') syncImagePreview();
    if(e.target.id==='slug') slugTouched=true;
    if(e.target.id==='title' && !$('id')?.value && !slugTouched && $('slug')) $('slug').value=slugify(e.target.value);
    if(e.target.id==='aiTopic' && !$('title')?.value && !slugTouched && $('slug')) $('slug').value=slugify(e.target.value.split('\n')[0]);
  });

  document.addEventListener('click',e=>{
    const editBtn=e.target.closest?.('[data-edit]');
    if(editBtn) setTimeout(()=>{slugTouched=true;setMode('manual');syncImagePreview();},0);
  });

  document.addEventListener('DOMContentLoaded',()=>{
    ensurePanel();
    $('newBtn')?.addEventListener('click',()=>setTimeout(resetAiPanel,0));
  });
  setTimeout(()=>{
    ensurePanel();
    $('newBtn')?.addEventListener('click',()=>setTimeout(resetAiPanel,0),{once:false});
  },300);
})();
