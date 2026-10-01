import {randomText,temporaryPassword,hashPassword,verifyPassword,sessionAllowed,fileAllowed} from '../../supabase/functions/seller-portal-api/security.ts';
const assert=(v:unknown,m='assertion failed')=>{if(!v)throw Error(m);};
Deno.test('credentials are random, unique samples and password is one-way',async()=>{
 const names=new Set<string>();for(let i=0;i<1000;i++){const n=randomText(1,'123456789')+randomText(4,'0123456789');assert(/^[1-9][0-9]{4}$/.test(n));names.add(n);const p=temporaryPassword();assert(p.length===5&&/[A-Za-z]/.test(p)&&/[2-9]/.test(p));}assert(names.size>980);
 const p='Abc234xyz!',h=await hashPassword(p);assert(!h.includes(p));assert(await verifyPassword(p,h));assert(!await verifyPassword('wrong',h));assert(await hashPassword(p)!==h);
});
Deno.test('each document is scoped to business and explicit approval',()=>{
 const id='11111111-1111-1111-1111-111111111111',f={business_id:id,status:'active',deleted_at:null,portal_visible:true,file_type:'application/pdf',storage_path:id+'/files/a.pdf'};
 assert(fileAllowed(f,id));assert(!fileAllowed(f,'other'));for(const change of [{portal_visible:false},{status:'deleted'},{deleted_at:'today'},{storage_path:'other/a.pdf'},{file_type:'text/html'},{storage_path:id+'/../other.pdf'}])assert(!fileAllowed({...f,...change},id));
});
Deno.test('archive, blocking, missing agreement, idle timeout and expiry reject existing sessions',()=>{
 const now=Date.now(),s={expires_at:new Date(now+3600000).toISOString(),last_activity_at:new Date(now).toISOString(),revoked_at:null},a={status:'active'},b={is_archived:false,agreement_status:'יש הסכם חתום'};assert(sessionAllowed(s,a,b,now));assert(!sessionAllowed(s,a,{...b,is_archived:true},now));assert(!sessionAllowed(s,a,{...b,agreement_status:'אין הסכם'},now));assert(!sessionAllowed(s,{status:'blocked'},b,now));assert(!sessionAllowed({...s,revoked_at:'today'},a,b,now));assert(!sessionAllowed(s,a,b,now+31*60000));assert(!sessionAllowed({...s,expires_at:new Date(now-1).toISOString()},a,b,now));
});
