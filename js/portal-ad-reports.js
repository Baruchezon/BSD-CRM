// Download and email remain separate from explicit per-business publication.
window.populateAdReportPortalPickers=async function(){
 const pickers=[...document.querySelectorAll('[data-portal-business]')];if(!pickers.length)return;
 try{const {data,error}=await window.supabaseClient.from('businesses').select('id,internal_name,business_number').eq('is_archived',false).order('internal_name');if(error)throw error;
  for(const select of pickers){select.replaceChildren(new Option('בחר את העסק שאליו שייך הדוח',''));for(const b of data)select.add(new Option((b.business_number||'')+' '+b.internal_name,b.id));}
 }catch{pickers.forEach(s=>{s.replaceChildren(new Option('לא ניתן לטעון עסקים כרגע',''));s.disabled=true;});}
};
window.getAdReportPdf=async function(g){if(!g.originalPdfBlob)g.originalPdfBlob=await buildPdfBlobFromPages(getPages(g));return g.originalPdfBlob;};
window.saveAdReportToSellerPortal=async function(g,blob,businessId){
 if(!businessId)throw Error('יש לבחור את העסק שאליו שייך הדוח');
 if(g.portalSavedBusinessId){if(g.portalSavedBusinessId!==businessId)throw Error('הדוח כבר פורסם לעסק אחר. יש להפיק דוח נפרד');return;}
 const sb=window.supabaseClient,url=window.BSD_CONFIG.SELLER_PORTAL_API_URL;if(!url)throw Error('שירות הפורטל טרם הופעל');
 const {data:{session}}=await sb.auth.getSession();if(!session)throw Error('נדרשת כניסה למערכת');
 const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.access_token},body:JSON.stringify({action:'admin_detail',business_id:businessId})});
 const d=await r.json();if(!r.ok||d.business?.id!==businessId)throw Error('אין הרשאה לפרסום דוח לעסק זה');
 if(d.business.is_archived)throw Error('לא ניתן לפרסם דוח לעסק בארכיון');
 if(!d.account||d.account.status==='deleted')throw Error('יש לחבר תחילה את העסק לפורטל מתוך כרטיס העסק');
 if(!confirm(`לפרסם את הדוח "${g.name}" בפורטל של "${d.business.internal_name}" בלבד?`))throw Error('הפרסום בוטל');
 if(!(blob instanceof Blob)||blob.type!=='application/pdf'||blob.size>16*1024*1024||new TextDecoder().decode(await blob.slice(0,5).arrayBuffer())!=='%PDF-')throw Error('נדרש דוח PDF תקין');
 const name='דוח פרסום '+g.name+'.pdf',path=businessId+'/seller-portal-ad-reports/'+crypto.randomUUID()+'.pdf';
 const upload=await sb.storage.from('business-files').upload(path,blob,{contentType:'application/pdf',upsert:false});if(upload.error)throw upload.error;
 const b=BUSINESSES[g.bizIndex],iso=date=>date?new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,10):null;
 const inserted=await sb.from('business_sale_files').insert({business_id:businessId,file_name:name,storage_path:path,file_type:'application/pdf',file_size:blob.size,category:'דוח פעילות פרסום',document_type:'activity_report',source:'auto_generated',status:'active',confidentiality_level:2,uploaded_by:session.user.id,portal_visible:true,portal_kind:'advertising',portal_period_from:iso(b.dateFrom),portal_period_to:iso(b.dateTo)});
 if(inserted.error){const cleanup=await sb.storage.from('business-files').remove([path]);if(cleanup.error)throw Error('הפרסום נכשל ונשאר קובץ ללא רישום שיש להסיר בניהול הקבצים');throw inserted.error;}
 g.portalSavedBusinessId=businessId;
};
