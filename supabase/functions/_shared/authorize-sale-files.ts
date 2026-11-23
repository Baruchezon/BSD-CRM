// Check the caller, business visibility AND recipient ownership before any
// privileged file/contact lookup. Recipient consent is checked by the caller.
export async function authorizeSaleFiles(db: any, actorId: string, businessId: string, type: string, recipientId: string, fileIds: string[]) {
  const { data: p, error } = await db.from('profiles').select('role,status').eq('id', actorId).maybeSingle();
  if (error || !p || p.status !== 'active') return false;
  if (['admin','manager'].includes(p.role)) return true;
  const { data: level, error: levelError } = await db.rpc('get_business_access_level', { biz_id: businessId, uid: actorId });
  if (levelError || !['anonymous','full'].includes(level)) return false;
  if (type === 'owner') return level === 'full';
  const { data: recipient, error: recipientError } = await db.from(type === 'broker' ? 'brokers' : 'leads')
    .select('created_by,handled_by').eq('id', recipientId).maybeSingle();
  if (recipientError || !recipient || (recipient.created_by !== actorId && recipient.handled_by !== actorId)) return false;
  if (level === 'full') return true;
  const { data: files, error: filesError } = await db.from('business_sale_files')
    .select('id,confidentiality_level,document_type').eq('business_id', businessId).eq('status','active').in('id', fileIds);
  return !filesError && new Set(fileIds).size === files?.length && files.every((f: any) => f.confidentiality_level === 1 && f.document_type === 'anonymous_summary');
}
