// supabase-js (service role) implementation of the WhatsApp store. Only the edge functions use it.
// Tables come from migration 20261011120000_whatsapp_cloud_api.sql (NOT applied yet).
import type { Conversation, RecordTable, WaRecord, WaStore } from './whatsapp.ts';
import { randomCode, toE164 } from './whatsapp.ts';

export const BUCKET = 'business-files';
const SELECT: Record<RecordTable, string> = {
  leads: 'id,full_name,first_name,phone,phone2,whatsapp_channel,is_archived,type,client_number,agreement_status,agreement_number,whatsapp_opt_in,whatsapp_opt_in_at,whatsapp_opt_out_at,whatsapp_marketing_opt_in',
  businesses: 'id,owner_name,owner_phone,whatsapp_channel,is_archived,business_number,agreement_status,agreement_number,whatsapp_opt_in,whatsapp_opt_in_at,whatsapp_opt_out_at,whatsapp_marketing_opt_in',
  brokers: 'id,full_name,first_name,phone,whatsapp_channel,is_archived,agreement_status,agreement_number,whatsapp_opt_in,whatsapp_opt_in_at,whatsapp_opt_out_at,whatsapp_marketing_opt_in',
};

export function mapRecord(table: RecordTable, r: any): WaRecord {
  return {
    table, id: r.id,
    name: table === 'businesses' ? r.owner_name : (r.full_name || r.first_name || null),
    phones: table === 'leads' ? [r.phone, r.phone2] : table === 'businesses' ? [r.owner_phone] : [r.phone],
    channel: r.whatsapp_channel === 'api' ? 'api' : 'personal', is_archived: !!r.is_archived,
    lead_type: table === 'leads' ? (r.type ?? null) : null,
    client_number: table === 'leads' ? (r.client_number != null ? String(r.client_number) : null) : table === 'businesses' ? (r.business_number != null ? String(r.business_number) : null) : null,
    agreement_status: r.agreement_status ?? null, agreement_number: r.agreement_number ?? null,
    opt_in: r.whatsapp_opt_in === true, opt_in_at: r.whatsapp_opt_in_at ?? null, opt_out_at: r.whatsapp_opt_out_at ?? null,
    marketing_opt_in: r.whatsapp_marketing_opt_in === true,
  };
}

export function createStore(db: any): WaStore & Record<string, any> {
  const store = {
    async record(table: RecordTable, id: string) {
      const { data, error } = await db.from(table).select(SELECT[table]).eq('id', id).maybeSingle();
      if (error) throw new Error('record: ' + error.message);
      return data ? mapRecord(table, data) : null;
    },
    async suppressed(e164: string) {
      const { data, error } = await db.rpc('wa_phone_suppressed', { p_phones: [e164] });
      if (error) throw new Error('wa_phone_suppressed: ' + error.message);
      return data === true;
    },
    async conversationById(id: string) {
      const { data } = await db.from('whatsapp_conversations').select('id,phone_e164,record_table,record_id,last_inbound_at').eq('id', id).maybeSingle();
      return data || null;
    },
    async conversationOrNull(e164: string) {
      const { data } = await db.from('whatsapp_conversations').select('id,phone_e164,record_table,record_id,last_inbound_at').eq('phone_e164', e164).maybeSingle();
      return data || null;
    },
    async conversation(e164: string, link?: { table: RecordTable; id: string } | null): Promise<Conversation> {
      const sel = 'id,phone_e164,record_table,record_id,last_inbound_at';
      let { data } = await db.from('whatsapp_conversations').select(sel).eq('phone_e164', e164).maybeSingle();
      if (!data) {
        const ins = await db.from('whatsapp_conversations').insert({ phone_e164: e164, record_table: link?.table ?? null, record_id: link?.id ?? null, link_source: link ? 'outbound' : null }).select(sel).maybeSingle();
        if (ins.error && ins.error.code !== '23505') throw new Error('conversation insert: ' + ins.error.message);
        data = ins.data || (await db.from('whatsapp_conversations').select(sel).eq('phone_e164', e164).maybeSingle()).data;
      } else if (link && !data.record_id) {
        await db.from('whatsapp_conversations').update({ record_table: link.table, record_id: link.id, ambiguous: false, candidates: null, link_source: 'outbound' }).eq('id', data.id);
        data = { ...data, record_table: link.table, record_id: link.id };
      }
      return data;
    },
    async countOutbound(f: { sinceIso: string; sentBy?: string; templatesOnly?: boolean }) {
      let q = db.from('whatsapp_messages').select('id', { count: 'exact', head: true })
        .eq('direction', 'outbound').gte('created_at', f.sinceIso).not('status', 'in', '(refused,failed)');
      if (f.sentBy) q = q.eq('sent_by', f.sentBy);
      if (f.templatesOnly) q = q.eq('message_type', 'template');
      const { count, error } = await q;
      if (error) throw new Error('count: ' + error.message);
      return count || 0;
    },
    async byRequestId(id: string) {
      const { data } = await db.from('whatsapp_messages').select('id,status,provider_message_id').eq('client_request_id', id).maybeSingle();
      return data || null;
    },
    async insertMessage(row: Record<string, unknown>) {
      const { data, error } = await db.from('whatsapp_messages').insert(row).select('id').maybeSingle();
      if (error) { if (error.code === '23505') return { conflict: true as const }; throw new Error('insert message: ' + error.message); }
      return { id: data.id as string };
    },
    async updateMessage(id: string, patch: Record<string, unknown>) {
      const { error } = await db.from('whatsapp_messages').update(patch).eq('id', id);
      if (error) throw new Error('update message: ' + error.message);
    },
    async touchConversation(id: string, patch: Record<string, unknown>) {
      const { error } = await db.from('whatsapp_conversations').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
      if (error) throw new Error('touch conversation: ' + error.message);
    },
    async sendLog(row: Record<string, unknown>) {
      const { error } = await db.from('whatsapp_send_log').insert(row);
      if (error) throw new Error('send log: ' + error.message);
    },
    // ---- used by whatsapp-send only ----
    async signedUrl(path: string, seconds: number, download?: string) {
      const { data, error } = await db.storage.from(BUCKET).createSignedUrl(path, seconds, download ? { download } : undefined);
      if (error || !data?.signedUrl) throw new Error('signed url: ' + (error?.message || 'none'));
      return data.signedUrl as string;
    },
    async signedUploadUrl(path: string) {
      const { data, error } = await db.storage.from(BUCKET).createSignedUploadUrl(path);
      if (error || !data) throw new Error('signed upload url: ' + (error?.message || 'none'));
      return { path: data.path, token: data.token, signedUrl: data.signedUrl };
    },
    async objectInfo(path: string): Promise<{ size: number; mime: string } | null> {
      const dir = path.split('/').slice(0, -1).join('/'), name = path.split('/').pop()!;
      const { data } = await db.storage.from(BUCKET).list(dir, { search: name, limit: 5 });
      const o = (data || []).find((x: any) => x.name === name);
      return o ? { size: Number(o.metadata?.size || 0), mime: String(o.metadata?.mimetype || 'application/octet-stream') } : null;
    },
    async createShortLink(row: { target_url: string; kind: string; record_table: string | null; record_id: string | null; created_by: string | null; expires_at: string }) {
      for (let i = 0; i < 5; i++) {
        const code = randomCode(10);
        const { error } = await db.from('whatsapp_short_links').insert({ code, ...row });
        if (!error) return code;
        if (error.code !== '23505') throw new Error('short link: ' + error.message);
      }
      throw new Error('short link: no free code');
    },
    async latestShortLink(kind: string, table: string, id: string) {
      const { data } = await db.from('whatsapp_short_links').select('code,created_at,expires_at').eq('kind', kind).eq('record_table', table).eq('record_id', id)
        .is('revoked_at', null).gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false }).limit(1).maybeSingle();
      return data || null;
    },
    async message(id: string) {
      const { data } = await db.from('whatsapp_messages').select('id,conversation_id,direction,message_type,storage_path,media_filename,media_mime,media_size,lead_id,business_id,broker_id').eq('id', id).maybeSingle();
      return data || null;
    },
    async profile(userId: string) {
      const { data } = await db.from('profiles').select('id,role,status,can_send_agreement,full_name').eq('id', userId).maybeSingle();
      return data || null;
    },
    async userFromJwt(jwt: string) {
      const { data } = await db.auth.getUser(jwt);
      return data?.user?.id || null;
    },
    async phonesFor(record: WaRecord) { return record.phones.map(toE164).filter(Boolean) as string[]; },
  };
  return store;
}
