'use strict';
(function(){
  const $=id=>document.getElementById(id);
  const val=id=>($(id)?.value||'').trim();

  function toast(message,isError=false){
    const t=$('toast');
    if(t){
      t.textContent=message;
      t.className='toast show'+(isError?' err':'');
      clearTimeout(toast.timer);
      toast.timer=setTimeout(()=>t.classList.remove('show'),4200);
    }else{
      console[isError?'error':'log'](message);
    }
  }

  function slugify(input){
    return String(input||'')
      .trim()
      .toLowerCase()
      .replace(/["'׳״.,:;!?()[\]{}<>\/\\|@#$%^&*+=~`]+/g,' ')
      .replace(/\s+/g,'-')
      .replace(/-+/g,'-')
      .replace(/^-+|-+$/g,'')
      .slice(0,90) || 'article';
  }

  function ensureSlug(){
    const field=$('slug');
    if(!field)return '';
    if(!field.value.trim()) field.value=slugify(val('title'));
    return field.value.trim();
  }

  function makeActionsAlwaysAvailable(){
    const save=$('saveBtn');
    if(!save)return;
    save.type='button';
    save.disabled=false;
    save.style.pointerEvents='auto';
    save.style.position='relative';
    save.style.zIndex='102';

    const row=save.parentElement;
    if(row){
      row.id='articleActionBar';
      row.style.position='sticky';
      row.style.bottom='0';
      row.style.zIndex='100';
      row.style.background='#0b1c2d';
      row.style.padding='12px 8px';
      row.style.margin='14px -8px -8px';
      row.style.borderTop='1px solid #345b76';
      row.style.boxShadow='0 -8px 24px rgba(1,7,12,.45)';
      row.style.pointerEvents='auto';
    }

    const publish=$('publishNowBtn');
    if(publish){
      publish.type='button';
      publish.disabled=false;
      publish.style.pointerEvents='auto';
      publish.style.position='relative';
      publish.style.zIndex='102';
    }
  }

  async function persistArticle(publish){
    const save=$('saveBtn');
    const publishBtn=$('publishNowBtn');
    const active=publish?publishBtn:save;
    if(!active)return;

    const saveText=save?.textContent||'שמור';
    const publishText=publishBtn?.textContent||'פרסם באתר';
    if(save) save.disabled=true;
    if(publishBtn) publishBtn.disabled=true;
    active.textContent=publish?'מפרסם באתר...':'שומר...';

    try{
      if(!window.supabaseClient) throw new Error('החיבור למסד הנתונים לא נטען');
      const title=val('title');
      const slug=ensureSlug();
      const bodyHtml=$('body')?.value||'';
      if(!title) throw new Error('חובה למלא כותרת');
      if(!slug) throw new Error('לא ניתן ליצור כתובת למאמר');
      if(publish && !bodyHtml.trim()) throw new Error('אין תוכן לכתבה');

      const {data:sess,error:sessionError}=await window.supabaseClient.auth.getSession();
      if(sessionError) throw sessionError;
      const userId=sess?.session?.user?.id;
      if(!userId) throw new Error('החיבור למערכת פג. יש להתחבר מחדש');

      const id=val('id');
      const {data:conflicts,error:conflictError}=await window.supabaseClient
        .from('site_content').select('id').eq('slug',slug).limit(2);
      if(conflictError) throw conflictError;
      if((conflicts||[]).some(row=>row.id!==id)) throw new Error('כתובת המאמר כבר קיימת. שנה מעט את הכותרת או את ה Slug');

      const currentStatus=val('status')||'draft';
      const status=publish?'published':currentStatus;
      const now=new Date().toISOString();
      const payload={
        content_type:'article',
        status,
        title,
        slug,
        focus_keyword:val('keyword')||null,
        author_name:val('author')||'BSD',
        excerpt:val('excerpt')||null,
        seo_title:val('seoTitle')||null,
        seo_description:val('seoDescription')||null,
        source_url:val('sourceUrl')||null,
        featured_image_url:val('imageUrl')||null,
        featured_image_prompt:val('imagePrompt')||null,
        editor_html:bodyHtml,
        body_html:bodyHtml,
        ai_status:publish?'published':'saved',
        updated_by:userId,
        updated_at:now
      };
      if(status==='published') payload.published_at=now;

      let result;
      if(id){
        result=await window.supabaseClient.from('site_content').update(payload).eq('id',id).select('id,title,slug,status').single();
      }else{
        payload.created_by=userId;
        result=await window.supabaseClient.from('site_content').insert(payload).select('id,title,slug,status').single();
      }
      if(result.error) throw result.error;
      if(!result.data?.id) throw new Error('המערכת לא החזירה אישור שמירה');

      $('id').value=result.data.id;
      if($('status')) $('status').value=result.data.status||status;

      if(publish){
        const url=`https://www.bsd-bbi.co.il/מרכז-ידע-לעסקים/${encodeURIComponent(result.data.slug)}`;
        const box=$('publishResult');
        if(box){
          box.style.display='block';
          box.innerHTML=`<div style="background:#113b2a;border:1px solid #2c7652;border-radius:10px;padding:10px;line-height:1.5"><b>הכתבה נשמרה ופורסמה באתר</b><div style="margin-top:8px"><a class="btn primary" href="${url}?v=${Date.now()}" target="_blank" rel="noopener">פתח את הכתבה באתר</a></div></div>`;
        }
        toast('הכתבה נשמרה ופורסמה באתר בהצלחה');
      }else{
        toast(status==='published'?'השינויים נשמרו במאמר המפורסם':'הכתבה נשמרה בהצלחה');
      }
    }catch(error){
      console.error('BSD article save/publish error',error);
      toast((publish?'הפרסום נכשל: ':'השמירה נכשלה: ')+(error?.message||String(error)),true);
    }finally{
      if(save){ save.disabled=false; save.textContent=saveText; }
      if(publishBtn){ publishBtn.disabled=false; publishBtn.textContent=publishText; }
      makeActionsAlwaysAvailable();
    }
  }

  document.addEventListener('click',function(event){
    const button=event.target.closest?.('#saveBtn,#publishNowBtn');
    if(!button)return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    persistArticle(button.id==='publishNowBtn');
  },true);

  document.addEventListener('DOMContentLoaded',()=>{
    setTimeout(makeActionsAlwaysAvailable,0);
    setTimeout(makeActionsAlwaysAvailable,350);
  });

  const observer=new MutationObserver(()=>makeActionsAlwaysAvailable());
  document.addEventListener('DOMContentLoaded',()=>{
    const modal=$('modal');
    if(modal) observer.observe(modal,{childList:true,subtree:true});
  });

  setTimeout(makeActionsAlwaysAvailable,700);
})();
