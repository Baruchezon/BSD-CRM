// Choose the newest active record of each semantic document type, before visibility checks.
// Anonymous and full summaries share a category but are separate types.
export function latestFiles(files:any[]){
 const sorted=[...files].sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at)||String(b.id).localeCompare(String(a.id)));
 const seen=new Set<string>();
 return sorted.filter(f=>{
  const type=f.document_type||f.category||f.file_name;
  const key=[f.business_id,f.portal_kind||'document',type].join(':');
  if(seen.has(key))return false;seen.add(key);return true;
 });
}
