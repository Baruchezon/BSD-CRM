'use strict';
(function(){
  const $=id=>document.getElementById(id);
  function notify(m,e=false){ if(typeof window.toast==='function') return window.toast(m,e); alert(m); }
  function value(id){ return ($(id)?.value||'').trim(); }
  function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

  function ensurePanel(){
    const body=document.querySelector('#modal .modalbody');
    if(!body||document.getElementById('aiContentPanel')) return;
    const panel=document.createElement('div');
    panel.id='aiContentPanel';
    panel.className='notice';
    panel.style.marginBottom='14px';
    panel.innerHTML=`
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap">
        <div><b>עוזר AI לתוכן</b><div class="muted" style="margin-top:4px">מתחילים מבחירת נושא, אחר כך כתיבה, תמונה ולבסוף פרסום באתר.</div></div>
        <button type="button" class="btn primary" id="aiTopicsBtn">הצע לי 8 נושאים לכתבה</button>
      </div>
      <div id="aiTopicsBox" style="display:none;margin-top:12px"></div>
      <div style="margin-top:12px"><label style="display:block;font-size:12px;color:#aab8c6;margin-bottom:5px">נושא שנבחר או נושא משלך</label><textarea id="aiTopic" class="textarea" style="min-height:72px" placeholder="אפשר לבחור נושא מהרשימה או לכתוב נושא משלך"></textarea></div>
      <div class="actions" style="margin-top:8px">
        <button type="button" class="btn primary" id="aiDraftBtn">צור כתבה מלאה מהנושא</button>
        <button type="button" class="btn" id="aiSeoBtn">שפר SEO</button>
        <button type="button" class="btn" id="aiImageBtn">צור תמונת כותרת</button>
      </div>
      <div id="aiImagePreviewWrap" style="display:none;margin-top:12px">
        <div style="font-weight:800;margin-bottom:6px">תמונת הכותרת שנוצרה</div>
        <img id="aiImagePreview" alt="תמונת כותרת" style="width:100%;max-height:360px;object-fit:cover;border-radius:12px;border:1px solid #2a506a">
      </div>
      <div id="publishResult" style="display:none;margin-top:12px"></div>`;
    body.insertBefore(panel,body.firstChild);

    const actionRow=$('saveBtn')?.parentElement;
    if(actionRow&&!document.getElementById('publishNowBtn')){
      const publish=document.createElement('button');
      publish.type='button';
      publish.className='btn primary';
      publish.id='publishNowBtn';
      publish.textContent='פרסם באתר';
      actionRow.insertBefore(publish,actionRow.firstChild);
      publish.onclick=publishNow;
    }

    $('aiTopicsBtn').onclick=suggestTopics;
    $('aiDraftBtn').onclick=()=>run('draft');
    $('aiSeoBtn').onclick=()=>run('seo');
    $('aiImageBtn').onclick=generateImage;
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
      return Array.from(document.querySelectorAll('#rows tr td:first-child b')).map(x=>x.textContent.trim()).filter(Boolean);
    }
  }

  function renderTopics(topics){
    const box=$('aiTopicsBox');
    box.style.display='block';
    box.innerHTML=`<div style="font-weight:800;margin-bottom:8px">בחר נושא אחד, ומשם המערכת תמשיך לכתיבה מלאה</div><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:9px">${topics.map((t,i)=>`
      <div style="background:#081a2a;border:1px solid #2a506a;border-radius:12px;padding:11px;display:flex;flex-direction:column;gap:7px">
        <div style="font-weight:800;line-height:1.4">${i+1}. ${esc(t.title)}</div>
        <div class="muted">${esc(t.angle||'')}</div>
        <div style="font-size:12px"><b>מילת מפתח:</b> ${esc(t.focus_keyword||'')}</div>
        <div style="font-size:12px;color:#b9c9d7">${esc(t.why||'')}</div>
        <button type="button" class="btn primary" data-ai-topic="${i}">בחר והמשך לכתיבה</button>
      </div>`).join('')}</div>`;
    box.querySelectorAll('[data-ai-topic]').forEach(btn=>btn.onclick=async()=>{
      const t=topics[Number(btn.dataset.aiTopic)];
      if(!t)return;
      $('aiTopic').value=`${t.title}\nזווית: ${t.angle||''}`.trim();
      if($('title')) $('title').value=t.title||'';
      if($('keyword')) $('keyword').value=t.focus_keyword||'';
      box.querySelectorAll('[data-ai-topic]').forEach(b=>b.disabled=true);
      await run('draft');
      box.querySelectorAll('[data-ai-topic]').forEach(b=>b.disabled=false);
    });
    box.scrollIntoView({behavior:'smooth',block:'nearest'});
  }

  async function suggestTopics(){
    const button=$('aiTopicsBtn');
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
      notify('הכנתי נושאים חדשים. בחר אחד והמערכת תמשיך לכתיבה.');
    }catch(e){notify('יצירת נושאים נכשלה: '+(e?.message||String(e)),true)}finally{button.disabled=false;button.textContent=old}
  }

  async function run(mode){
    const topic=value('aiTopic')||value('title');
    const current=[value('title'),value('excerpt'),$('body')?.value||''].filter(Boolean).join('\n\n');
    if(!topic&&!current) return notify('יש לבחור או להזין נושא לכתבה',true);
    const button=mode==='draft'?$('aiDraftBtn'):$('aiSeoBtn');
    const old=button?.textContent||'';
    if(button){button.disabled=true;button.textContent='AI עובד...';}
    try{
      const {data,error}=await window.supabaseClient.functions.invoke('generate-site-content',{body:{mode,topic,current_text:current,audience:'בעלי עסקים, יזמים, רוכשים ומשקיעים בישראל',goal:'קידום אורגני, בניית אמון והנעת פנייה מקצועית ל BSD'}});
      if(error) throw error;
      if(data?.error) throw new Error(data.error);
      if(mode==='draft'){
        if(data.title) $('title').value=data.title;
        if(data.slug) $('slug').value=data.slug;
        if(data.excerpt) $('excerpt').value=data.excerpt;
        if(data.focus_keyword) $('keyword').value=data.focus_keyword;
        if(data.seo_title) $('seoTitle').value=data.seo_title;
        if(data.seo_description) $('seoDescription').value=data.seo_description;
        if(data.article_html) $('body').value=data.article_html;
        if(data.image_prompt) $('imagePrompt').value=data.image_prompt;
      }else if(mode==='seo'){
        if(data.focus_keyword) $('keyword').value=data.focus_keyword;
        if(data.seo_title) $('seoTitle').value=data.seo_title;
        if(data.seo_description) $('seoDescription').value=data.seo_description;
        if(data.excerpt) $('excerpt').value=data.excerpt;
      }else if(mode==='image'){
        if(data.image_prompt) $('imagePrompt').value=data.image_prompt;
      }
      notify(mode==='draft'?'הכתבה נוצרה בעורך. עכשיו אפשר ליצור תמונה ולפרסם.':'הצעת AI הוכנסה לעורך.');
      return data;
    }catch(e){notify('AI נכשל: '+(e?.message||String(e)),true);throw e}
    finally{if(button){button.disabled=false;button.textContent=old;}}
  }

  async function generateImage(){
    const button=$('aiImageBtn');
    const old=button.textContent;
    button.disabled=true;
    button.textContent='יוצר תמונה...';
    try{
      if(!value('imagePrompt')) await run('image');
      const prompt=value('imagePrompt')||value('title')||value('aiTopic');
      if(!prompt) throw new Error('אין מספיק מידע ליצירת תמונה');
      const {data,error}=await window.supabaseClient.functions.invoke('generate-site-content',{body:{mode:'generate_image',image_prompt:prompt,title:value('title'),slug:value('slug')}});
      if(error) throw error;
      if(data?.error) throw new Error(data.error);
      if(!data?.image_url) throw new Error('לא התקבלה כתובת תמונה');
      $('imageUrl').value=data.image_url;
      syncImagePreview();
      notify('תמונת הכותרת נוצרה ונשמרה.');
    }catch(e){notify('יצירת התמונה נכשלה: '+(e?.message||String(e)),true)}finally{button.disabled=false;button.textContent=old}
  }

  function publicUrl(slug,sourceUrl){
    if(sourceUrl) return sourceUrl;
    return `https://www.bsd-bbi.co.il/מרכז-ידע-לעסקים/${encodeURIComponent(slug)}`;
  }

  async function publishNow(){
    const button=$('publishNowBtn');
    const old=button.textContent;
    button.disabled=true;
    button.textContent='מפרסם באתר...';
    try{
      const title=value('title'),slug=value('slug'),bodyHtml=$('body')?.value||'';
      if(!title||!slug) throw new Error('חובה למלא כותרת ו Slug');
      if(!bodyHtml.trim()) throw new Error('אין תוכן לכתבה');
      const {data:sess}=await window.supabaseClient.auth.getSession();
      const userId=sess?.session?.user?.id;
      if(!userId) throw new Error('לא מחובר');
      const payload={
        content_type:'article',status:'published',title,slug,
        focus_keyword:value('keyword')||null,author_name:value('author')||'BSD',excerpt:value('excerpt')||null,
        seo_title:value('seoTitle')||null,seo_description:value('seoDescription')||null,source_url:value('sourceUrl')||null,
        featured_image_url:value('imageUrl')||null,featured_image_prompt:value('imagePrompt')||null,
        editor_html:bodyHtml,body_html:bodyHtml,ai_status:'published',updated_by:userId,updated_at:new Date().toISOString(),published_at:new Date().toISOString()
      };
      const id=value('id');
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
      if(box){box.style.display='block';box.innerHTML=`<div style="background:#113b2a;border:1px solid #2c7652;border-radius:10px;padding:10px"><b>הכתבה פורסמה באתר</b><div style="margin-top:7px"><a class="btn primary" href="${esc(url)}?v=${Date.now()}" target="_blank" rel="noopener">פתח את הכתבה באתר</a></div></div>`;}
      notify('הכתבה פורסמה באתר בהצלחה.');
      if(typeof window.load==='function') await window.load();
    }catch(e){notify('הפרסום נכשל: '+(e?.message||String(e)),true)}finally{button.disabled=false;button.textContent=old}
  }

  document.addEventListener('input',e=>{if(e.target&&e.target.id==='imageUrl')syncImagePreview();});
  document.addEventListener('DOMContentLoaded',ensurePanel);
  setTimeout(ensurePanel,300);
})();
