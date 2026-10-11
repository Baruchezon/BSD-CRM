-- Close the profile permission hole (approved in writing by Baruch 11.10.2026 06:44).
-- profiles_update_self_or_admin + the table UPDATE grant let every CRM user update his own profiles row, and the old
-- protect_profile_privileged_fields() only protected role/status. A user could grant himself can_upload_sale_files,
-- can_view_anonymous_businesses, document_access_level etc. from the browser console.
-- Now only an admin (is_admin()) or the service role may change role, status, internal_code, document_access_level,
-- must_change_password and every can_* column (including future can_* columns). For anyone else these fields are
-- silently kept at their old value (same behaviour the trigger already had for role/status), so normal self-edits
-- (name, phone, city, company, job title, licence, last_login_at/login_count on login) keep working.
-- Same function name and trigger; only the body changes. Rollback: docs/profiles-permission-guard-rollback.sql.
create or replace function public.protect_profile_privileged_fields()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  locked jsonb;
begin
  -- service_role (edge functions such as create-user) may change everything; access to them is checked in their code.
  if coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;
  if public.is_admin() then
    return new;
  end if;
  -- everyone else: keep permission fields at their old values (prevents self-escalation).
  select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) into locked
    from jsonb_each(to_jsonb(old)) e
   where e.key in ('role','status','internal_code','document_access_level','must_change_password')
      or e.key like 'can\_%';
  new := jsonb_populate_record(new, locked);
  return new;
end;
$function$;
