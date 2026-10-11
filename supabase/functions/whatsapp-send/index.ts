// whatsapp-send entry point. NOT deployed (branch eldad/whatsapp-cloud-api). Deploy with verify_jwt = true.
// Secrets: WHATSAPP_MODE, WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_TEST_NUMBERS, WHATSAPP_SHORT_LINK_BASE (+ optional limits).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { readConfig } from '../_shared/whatsapp.ts';
import { createStore } from '../_shared/whatsapp-store.ts';
import { createSendHandler } from './handler.ts';

const url = Deno.env.get('SUPABASE_URL')!;
const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const store: any = createStore(service);

// Access checks run AS THE CALLER (auth.uid()), with the same SQL helpers the CRM's RLS uses.
const asUser = (jwt: string) => createClient(url, anonKey, { global: { headers: { Authorization: 'Bearer ' + jwt } }, auth: { persistSession: false } });
const rpcBool = async (jwt: string, fn: string, args: Record<string, unknown>) => {
  const { data, error } = await asUser(jwt).rpc(fn, args);
  return !error && data === true;
};
const origins = (Deno.env.get('WHATSAPP_ORIGINS') || 'https://baruchezon.github.io,https://bsd-crm.vercel.app').split(',').map(s => s.trim()).filter(Boolean);

Deno.serve(createSendHandler({
  cfg: readConfig(k => Deno.env.get(k)), store, fetch, origins,
  access: {
    record: (jwt, table, id) => rpcBool(jwt, 'wa_record_access', { p_table: table, p_id: id }),
    conversation: (jwt, id) => rpcBool(jwt, 'wa_conversation_access', { p_conversation_id: id }),
    storagePath: (jwt, path) => rpcBool(jwt, 'wa_storage_path_access', { p_path: path }),
  },
}));
