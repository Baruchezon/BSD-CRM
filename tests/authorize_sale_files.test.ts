import { authorizeSaleFiles } from '../supabase/functions/_shared/authorize-sale-files.ts';
function assert(ok: unknown) { if (!ok) throw new Error('file authorization regression'); }
function fixture({ role='agent_authorized', status='active', level='anonymous', owner='agent', files=[{id:'f',confidentiality_level:1,document_type:'anonymous_summary'}] } = {}) {
  return {
    rpc: () => Promise.resolve({data:level}),
    from: (table: string) => {
      const data = table === 'profiles' ? {role,status} : table === 'leads' ? {created_by:owner} : files;
      const q: any = { then: (resolve: any) => Promise.resolve({data}).then(resolve) };
      for (const method of ['select','eq','in','maybeSingle']) q[method]=()=>q;
      return q;
    }
  };
}
Deno.test('anonymous files can be sent only to the agents own buyer', async()=>{
  assert(await authorizeSaleFiles(fixture(),'agent','biz','buyer','mine',['f']));
  assert(!await authorizeSaleFiles(fixture({owner:'somebody_else'}),'agent','biz','buyer','foreign',['f']));
});
Deno.test('anonymous access cannot produce links to confidential or missing files',async()=>{
  assert(!await authorizeSaleFiles(fixture({files:[{id:'f',confidentiality_level:2,document_type:'full_summary'}]}),'agent','biz','buyer','mine',['f']));
  assert(!await authorizeSaleFiles(fixture({files:[]}),'agent','biz','buyer','mine',['missing']));
  assert(!await authorizeSaleFiles(fixture({level:'none'}),'agent','biz','buyer','mine',['f']));
});
Deno.test('full business access still does not open another agents buyer; inactive users fail',async()=>{
  assert(await authorizeSaleFiles(fixture({level:'full'}),'agent','biz','buyer','mine',['f']));
  assert(!await authorizeSaleFiles(fixture({level:'full',owner:'other'}),'agent','biz','buyer','foreign',['f']));
  assert(!await authorizeSaleFiles(fixture({status:'blocked'}),'agent','biz','buyer','mine',['f']));
  assert(!await authorizeSaleFiles(fixture(),'agent','biz','owner','owner',['f']));
});
