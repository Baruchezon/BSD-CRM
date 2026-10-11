// go (short links) entry point. NOT deployed. Deploy with verify_jwt = false.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { createGoHandler } from './handler.ts';
import { DEFAULT_TARGET_HOSTS } from '../whatsapp-send/handler.ts';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
Deno.serve(createGoHandler({
  allowedHosts: DEFAULT_TARGET_HOSTS, fallbackUrl: 'https://www.bsd-bbi.co.il/',
  async resolve(code) {
    const { data, error } = await db.rpc('wa_resolve_short_link', { p_code: code });
    if (error) throw new Error(error.message);
    return data ? { target_url: String(data) } : null;
  },
}));
