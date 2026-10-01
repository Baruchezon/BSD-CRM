// Called only after a per-business PDF is generated and the checkbox is checked.
// Select the CRM business explicitly. Never infer ownership from a CSV name.
window.saveAdReportToSellerPortal=async function(g,blob){
 if(g.portalSaved)return;
 const sb=window.supabaseClient;
 if(!window.BSD_CONFIG.SELLER_PORTAL_API_URL)throw Error('שמירת דוח לפורטל זמינה רק לאחר חיבור סביבת הבדיקה');
 const {data:{session}}=await sb.auth.getSession();if(!session)throw Error('נדרשת כניסה למערכת');
 const {data:profile,error:profileError}=await sb.from('profiles').select('role,status').eq('id',session.user.id).single();
 if(profileError||profile.status!=='active'||!['admin','manager'].includes(profile.role))throw Error('רק מנהל מורשה לאשר דוח לפורטל');
 const {data:businesses,error}=await sb.from('businesses').select('id,internal_name,business_number').eq('is_archived',false).order('internal_name');if(error)throw error;
 const business=await new Promise(resolve=>{
  const dialog=document.createElement('dialog');dialog.style.cssText='max-width:520px;width:calc(100% - 30px);padding:25px;border:1px solid #cba750;border-radius:12px;direction:rtl;';
  const title=document.createElement('h3');title.textContent='שיוך הדוח לעסק ב CRM';
  const note=document.createElement('p');note.textContent='יש לבחור במפורש את העסק שאליו שייך הדוח. הקובץ שיופיע בפורטל יהיה אותו PDF שהופק להורדה.';
  const select=document.createElement('select');select.style.cssText='width:100%;padding:12px;';select.add(new Option('בחר עסק',''));
  businesses.forEach(b=>select.add(new Option((b.business_number||'')+' '+b.internal_name,b.id)));
  const save=document.createElement('button');save.textContent='שמירה והצגה בפורטל';save.className='btn btn-navy';save.style.margin='15px';save.type='button';
  const cancel=document.createElement('button');cancel.textContent='ביטול';cancel.type='button';
  let chosen=null;save.onclick=()=>{chosen=businesses.find(b=>b.id===select.value);if(chosen)dialog.close();};cancel.onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>{dialog.remove();resolve(chosen);},{once:true});dialog.append(title,note,select,save,cancel);document.body.append(dialog);dialog.showModal();
 });
 if(!business)throw Error('שיוך הדוח בוטל. הדוח לא פורסם בפורטל');
 const name='דוח פרסום '+g.name+'.pdf',path=business.id+'/seller-portal-ad-reports/'+crypto.randomUUID()+'.pdf';
 const upload=await sb.storage.from('business-files').upload(path,blob,{contentType:'application/pdf',upsert:false});if(upload.error)throw upload.error;
 const b=BUSINESSES[g.bizIndex],iso=d=>d?new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10):null;
 const inserted=await sb.from('business_sale_files').insert({business_id:business.id,file_name:name,storage_path:path,file_type:'application/pdf',file_size:blob.size,category:'דוח פעילות פרסום',document_type:'activity_report',source:'auto_generated',status:'active',confidentiality_level:2,uploaded_by:session.user.id,portal_visible:true,portal_kind:'advertising',portal_period_from:iso(b.dateFrom),portal_period_to:iso(b.dateTo)});
 if(!inserted.error)g.portalSaved=true;
 if(inserted.error){await sb.storage.from('business-files').remove([path]);throw inserted.error;}
};
