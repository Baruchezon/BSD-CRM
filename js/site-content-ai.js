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
        <div><b>עוזר AI לתוכן</b><div class="muted" style="margin-top:4px">מתחילים מבחירת נושא, ורק אחר כך עוברים לכתיבה, SEO ותמונה.</div></div>
        <button type="button" class="btn primary" id="aiTopicsBtn">הצע לי 8 נושאים לכתבה</button>
      </div>
      <div id="aiTopicsBox" style="display:none;margin-top:12px"></div>
      <div style="margin-top:12px"><label style="display:block;font-size:12px;color:#aab8c6;margin-bottom:5px">נושא שנבחר או נושא משלך</label><textarea id="aiTopic" class="textarea" style="min-height:72px" placeholder="אפשר לבחור נושא מהרשימה או לכתוב נושא משלך"></textarea></div>
      <div class="actions" style="margin-top:8px"><button type="button" class="btn primary" id="aiDraftBtn">צור כתבה מלאה מהנושא</button><button type="button" class="btn" id="aiSeoBtn">שפר SEO</button><button type="button" class="btn" id="aiImageBtn">הצע תמונת כותרת</button></div>`;
    body.insertBefore(panel,body.firstChild);
    $('aiTopicsBtn').onclick=suggestTopics;
    $('aiDraftBtn').onclick=()=>run('draft');
    $('aiSeoBtn').onclick=()=>run('seo');
    $('aiImageBtn').onclick=()=>run('image');
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
    const button=mode==='draft'?$('aiDraftBtn'):mode==='seo'?$('aiSeoBtn'):$('aiImageBtn');
    const old=button.textContent; button.disabled=true; button.textContent='AI עובד...';
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
      notify(mode==='draft'?'הכתבה נוצרה בעורך. בדוק אותה ולחץ שמור כשתהיה מרוצה.':'הצעת AI הוכנסה לעורך. בדוק לפני שמירה.');
    }catch(e){notify('AI נכשל: '+(e?.message||String(e)),true)}finally{button.disabled=false;button.textContent=old}
  }
  document.addEventListener('DOMContentLoaded',ensurePanel);
})();
