-- Seller agreement: legal name stays off the listing name, and the signing page
-- can load the owner's name and phone by a token instead of putting them in the URL.

alter table public.businesses
  add column if not exists legal_name text;

alter table public.leads
  add column if not exists entity_type text;

comment on column public.businesses.legal_name is
  'שם משפטי / חברה שהמוכר הקליד בהסכם. לא מחליף את internal_name (שם התצוגה).';
comment on column public.businesses.entity_type is
  'סוג המספר במסמך: ח.פ. או עוסק מורשה.';
comment on column public.businesses.id_number is
  'ח.פ. או מספר עוסק מורשה (9 ספרות).';
comment on column public.leads.entity_type is
  'סוג המספר: ח.פ. או עוסק מורשה (ולקונה גם ת.ז.).';

create table if not exists public.agreement_signer_prefill (
  token text primary key,
  record_table text not null check (record_table in ('businesses', 'leads', 'brokers')),
  record_id uuid not null,
  expires_at timestamptz not null default (now() + interval '60 days'),
  created_at timestamptz not null default now()
);

alter table public.agreement_signer_prefill enable row level security;
revoke all on public.agreement_signer_prefill from anon, authenticated;

create or replace function public.create_agreement_signer_prefill(p_table text, p_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  v_token text;
  b bytea;
  i int;
  tries int := 0;
begin
  if auth.uid() is null or not public.is_active_user() or public.is_viewer_only() then
    raise exception 'אין הרשאה';
  end if;
  if p_table not in ('businesses', 'leads', 'brokers') or p_id is null then
    raise exception 'כרטיס לא תקין';
  end if;
  if not public.wa_record_access(p_table, p_id) then
    raise exception 'אין הרשאה לכרטיס';
  end if;
  loop
    b := gen_random_bytes(18);
    v_token := '';
    for i in 0..17 loop
      v_token := v_token || substr(alphabet, 1 + (get_byte(b, i) % 57), 1);
    end loop;
    begin
      insert into public.agreement_signer_prefill (token, record_table, record_id)
      values (v_token, p_table, p_id);
      return v_token;
    exception when unique_violation then
      tries := tries + 1;
      if tries > 5 then raise; end if;
    end;
  end loop;
end;
$function$;

create or replace function public.get_agreement_signer_prefill(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  r public.agreement_signer_prefill%rowtype;
  v_name text;
  v_phone text;
begin
  if p_token is null or char_length(btrim(p_token)) < 12 or char_length(p_token) > 64 then
    return null;
  end if;
  select * into r
  from public.agreement_signer_prefill
  where token = btrim(p_token)
    and expires_at > now();
  if not found then
    return null;
  end if;
  if r.record_table = 'businesses' then
    select b.owner_name, b.owner_phone into v_name, v_phone
    from public.businesses b where b.id = r.record_id;
  elsif r.record_table = 'leads' then
    select coalesce(nullif(btrim(l.full_name), ''), nullif(btrim(concat_ws(' ', l.first_name, l.last_name)), '')), l.phone
      into v_name, v_phone
    from public.leads l where l.id = r.record_id;
  elsif r.record_table = 'brokers' then
    select coalesce(nullif(btrim(br.full_name), ''), nullif(btrim(concat_ws(' ', br.first_name, br.last_name)), '')), br.phone
      into v_name, v_phone
    from public.brokers br where br.id = r.record_id;
  else
    return null;
  end if;
  return jsonb_build_object('name', coalesce(v_name, ''), 'phone', coalesce(v_phone, ''));
end;
$function$;

revoke all on function public.create_agreement_signer_prefill(text, uuid) from public, anon;
grant execute on function public.create_agreement_signer_prefill(text, uuid) to authenticated;

revoke all on function public.get_agreement_signer_prefill(text) from public;
grant execute on function public.get_agreement_signer_prefill(text) to anon, authenticated;
