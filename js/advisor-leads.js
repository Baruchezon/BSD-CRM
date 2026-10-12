(() => {
  const mount = async (host) => {
    if(host.dataset.loaded)return;host.dataset.loaded='1';
    const client=window.supabaseClient;if(!client)return;
    const {data,error}=await client.from('advisor_inquiries').select('id,question,message,transcript,status,reply,created_at').eq('lead_id',host.dataset.advisorLead).order('created_at',{ascending:false});
    if(error||!data?.length)return;
    host.style.cssText='background:#edf3fa;border:1px solid #bdcfe4;border-radius:12px;padding:14px;margin-bottom:12px;';
    const h=document.createElement('h4');h.textContent='שאלות מהיועץ באתר';h.style.margin='0 0 12px';host.append(h);
    for(const inquiry of data){
      const section=document.createElement('section');section.style.cssText='border-bottom:1px solid #cbd8e6;padding:10px 0;';
      const time=document.createElement('small');time.textContent=new Date(inquiry.created_at).toLocaleString('he-IL')+' · '+inquiry.status;
      const question=document.createElement('p');question.textContent=inquiry.question;question.style.whiteSpace='pre-wrap';
      section.append(time,question);
      if(inquiry.message){const p=document.createElement('p');p.textContent=inquiry.message;section.append(p);}
      if(inquiry.transcript?.length){const d=document.createElement('details');const s=document.createElement('summary');s.textContent='היסטוריית השיחה, בהסכמת הפונה';const p=document.createElement('p');p.textContent=inquiry.transcript.map(m=>(m.role==='user'?'הפונה: ':'היועץ: ')+m.content).join('\n\n');p.style.cssText='white-space:pre-wrap;max-height:220px;overflow:auto;';d.append(s,p);section.append(d);}
      const label=document.createElement('label');label.textContent='המענה שלך';label.style.display='block';const text=document.createElement('textarea');text.value=inquiry.reply||'';text.rows=4;text.style.cssText='width:100%;box-sizing:border-box;font:inherit;font-size:16px;border:1px solid #bac9da;border-radius:8px;padding:10px;';label.append(text);section.append(label);
      const row=document.createElement('div');row.style.cssText='display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;';
      const status=document.createElement('p');status.setAttribute('role','status');status.style.fontSize='13px';
      const save=document.createElement('button');save.type='button';save.className='btn btn-navy';save.textContent='שמירת המענה';
      save.addEventListener('click',async()=>{save.disabled=true;const r=await client.from('advisor_inquiries').update({reply:text.value.trim()}).eq('id',inquiry.id);status.textContent=r.error?'המענה לא נשמר':'המענה נשמר';save.disabled=false;});
      const wa=document.createElement('a');wa.className='btn btn-gold';wa.textContent='מענה בוואטסאפ';wa.target='_blank';wa.rel='noopener noreferrer';wa.href='#';
      wa.addEventListener('click',e=>{const phone=(document.getElementById('wlPhone')?.value||'').replace(/\D/g,'').replace(/^0/,'972');if(!/^9725\d{8}$/.test(phone)||!text.value.trim()){e.preventDefault();status.textContent='יש למלא מענה ולוודא טלפון נייד תקין.';return;}wa.href='https://wa.me/'+phone+'?text='+encodeURIComponent('שלום, בהמשך לשאלתך ביועץ העסקי של BSD:\n\n'+text.value.trim()+'\n\nברוך איזון | BSD');});
      const note=document.createElement('small');note.textContent='שליחה מהוואטסאפ המחובר למכשיר. כרגע יש להשתמש בחשבון 0542424999. פתיחת השיחה אינה אישור שליחה.';
      const done=document.createElement('button');done.type='button';done.className='btn btn-ghost';done.textContent='סימון שנשלח מענה';done.addEventListener('click',async()=>{done.disabled=true;const r=await client.from('advisor_inquiries').update({reply:text.value.trim(),status:'נשלח מענה'}).eq('id',inquiry.id);status.textContent=r.error?'הסימון לא נשמר':'סומן שנשלח מענה';done.disabled=false;});
      row.append(save,wa,done);section.append(row,note,status);host.append(section);
    }
  };
  const observe=()=>{const box=document.getElementById('modalBox');if(!box)return;new MutationObserver(()=>box.querySelectorAll('[data-advisor-lead]').forEach(mount)).observe(box,{childList:true,subtree:true});box.querySelectorAll('[data-advisor-lead]').forEach(mount);};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',observe);else observe();
})();
