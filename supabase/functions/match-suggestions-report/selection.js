// Shared request validation and stable pagination. No database writes.
export async function readAll(query) {
  const data = [];
  const size = 500;
  for (let offset = 0; ; offset += size) {
    const page = await query().order('id', { ascending: true }).range(offset, offset + size - 1);
    if (page.error) return { data: [], error: page.error };
    data.push(...(page.data || []));
    if (!page.data || page.data.length < size) return { data, error: null };
  }
}
export function parseSelection(body) {
  const type = body?.target_type || '';
  const id = body?.target_id || '';
  if (!type && !id) return { type: '', id: '' }; // Existing report callers.
  if (!['buyer', 'business'].includes(type) || typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return { error: 'יש לבחור עסק או קונה מהרשימה' };
  }
  return { type, id };
}
export function visiblePhones(fullAccess, values) {
  if (!fullAccess) return [];
  return (values || []).map(v => String(v || '').trim()).filter(Boolean);
}
export function selectRecords({ buyers, businesses }, { type, id }) {
  const selectedBuyers = type === 'buyer' ? buyers.filter(b => b.id === id) : buyers;
  const selectedBusinesses = type === 'business' ? businesses.filter(b => b.id === id) : businesses;
  if ((type === 'buyer' && !selectedBuyers.length) || (type === 'business' && !selectedBusinesses.length)) {
    return { error: 'הרשומה אינה פעילה או שאין לך הרשאה לצפות בה' };
  }
  return { buyers: selectedBuyers, businesses: selectedBusinesses };
}
