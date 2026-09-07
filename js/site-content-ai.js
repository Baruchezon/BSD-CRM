'use strict';
(function(){
  const $=id=>document.getElementById(id);
  function notify(m,e=false){ if(typeof window.toast==='function') return window.toast(m,e); alert(m); }
  function value(id){ return ($(id)?.value||'').trim(); }
  function ensurePanel(){
    const body=document.querySelector('#modal .modalbody');
    if(!body||document.getElementById('aiContentPanel')) return;
    const panel=document.createElement('div');
    panel.id='aiContentPanel';
    panel.className='notice';
    panel.style.marginBottom='14px';
    panel.innerHTML=`<b>עוזר AI לתוכן</b><div class="muted" style="margin:5px 0 8px">יוצר טיוטה בלבד. שום דבר לא נשמר או מתפרסם בלי לחיצה שלך על שמור.</div><textarea id="aiTopic" class="textarea" style="min-height:72px" placeholder="מה הכתבה צריכה להסביר? לדוגמה: איך להכין עסק למכירה בלי לפגוע בפעילות השוטפת"></textarea><div class="actions" style="margin-top:8px"><button type="button" class="btn primary" id="aiDraftBtn">צור טיוטת כתבה</button><button type="button" class="btn" id="aiSeoBtn">שפר SEO</button><button type="button" class="btn" id="aiImageBtn">הצע תמונת כותרת</button></div>`;
    body.insertBefore(panel,body.firstChild);
    $('aiDraftBtn').onclick=()=>run('draft');
    $('aiSeoBtn').onclick=()=>run('seo');
    $('aiImageBtn').onclick=()=>run('image');
  }
  async function run(mode){
    const topic=value('aiTopic')||value('title');
    const current=[value('title'),value('excerpt'),$('body')?.value||''].filter(Boolean).join('\n\n');
    if(!topic&&!current) return notify('יש להזין נושא לכתבה',true);
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
      notify('הצעת AI הוכנסה לעורך. בדוק וערוך לפני שמירה.');
    }catch(e){notify('AI נכשל: '+(e?.message||String(e)),true)}finally{button.disabled=false;button.textContent=old}
  }
  document.addEventListener('DOMContentLoaded',ensurePanel);
})();
