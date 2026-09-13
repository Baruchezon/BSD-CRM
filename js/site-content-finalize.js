'use strict';
(function(){
  const $=id=>document.getElementById(id);
  function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function normalizeBody(){
    const field=$('body');
    if(!field)return;
    const raw=field.value.trim();
    if(!raw||/<\/?(?:p|h2|h3|ul|ol|li|strong|br)\b/i.test(raw))return;
    field.value=raw.split(/\n\s*\n/).map(block=>`<p>${esc(block).replace(/\n/g,'<br>')}</p>`).join('\n');
  }
  function improveLabels(){
    const body=$('body');
    if(body){
      const label=body.closest('.field')?.querySelector('label');
      if(label)label.textContent='תוכן הכתבה';
      body.placeholder='אפשר לכתוב כאן טקסט רגיל. המערכת תסדר אותו לפרסום. תוכן שנוצר עם AI יופיע כאן מוכן לעריכה.';
    }
    const slug=$('slug');
    const slugLabel=slug?.closest('.field')?.querySelector('label');
    if(slugLabel)slugLabel.textContent='כתובת המאמר';
  }
  function bindNormalize(){
    ['saveBtn','publishNowBtn'].forEach(id=>{
      const b=$(id);if(!b||b.dataset.finalizeBound)return;
      b.dataset.finalizeBound='1';
      b.addEventListener('click',normalizeBody,true);
    });
  }
  function openRequestedArticle(){
    const id=new URLSearchParams(location.search).get('edit');
    if(!id)return;
    let tries=0;
    const timer=setInterval(()=>{
      tries++;
      const button=document.querySelector(`[data-edit="${CSS.escape(id)}"]`);
      if(button){clearInterval(timer);button.click();setTimeout(()=>document.querySelector('#modal .modal')?.scrollTo({top:0}),100);}
      else if(tries>40)clearInterval(timer);
    },150);
  }
  function init(){improveLabels();bindNormalize();openRequestedArticle();setTimeout(bindNormalize,350);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();