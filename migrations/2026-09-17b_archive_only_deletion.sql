begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

drop policy if exists "businesses_delete" on public.businesses;
create policy "businesses_delete" on public.businesses
for delete to authenticated
using (
  is_archived = true
  and (
    exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('admin','manager'))
    or created_by = (select auth.uid())
    or handled_by = (select auth.uid())
  )
);

drop policy if exists "leads_delete" on public.leads;
create policy "leads_delete" on public.leads
for delete to authenticated
using (
  is_archived = true
  and (
    public.is_admin()
    or (
      type = 'seller' and (
        exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'manager')
        or created_by = (select auth.uid())
        or handled_by = (select auth.uid())
      )
    )
    or (type in ('buyer','partner') and created_by = (select auth.uid()))
  )
);

create or replace function public.enforce_business_archive_integrity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(new.listing_status, 'active') in ('removed','sold') and not new.is_archived then
    new.is_archived := true;
    if new.archive_reason is null or trim(new.archive_reason) = '' then
      new.archive_reason := case
        when new.listing_status = 'sold' then 'הועבר אוטומטית לארכיון לאחר סימון העסק כנמכר'
        else 'הועבר אוטומטית לארכיון לאחר סימון העסק כלא פעיל'
      end;
    end if;
  end if;

  if old.is_archived is distinct from new.is_archived then
    if new.is_archived and not old.is_archived then
      if new.archive_reason is null or trim(new.archive_reason) = '' then
        raise exception 'נדרשת סיבה להעברה לארכיון';
      end if;
      new.archived_by := auth.uid();
      new.archived_at := now();
      new.public_listing_active := false;
    elsif old.is_archived and not new.is_archived then
      if not (
        exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
        or old.archived_by = auth.uid()
      ) then
        raise exception 'שחזור מהארכיון מותר רק לאדמין או למי שהעביר את הכרטיס לארכיון';
      end if;
      new.archived_at := null;
      new.archived_by := null;
      new.archive_reason := null;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_business_archive_integrity() from public, anon, authenticated;

update public.businesses
set is_archived = true,
    archive_reason = case
      when listing_status = 'sold' then 'הועבר אוטומטית לארכיון לאחר סימון העסק כנמכר'
      else 'הועבר אוטומטית לארכיון לאחר סימון העסק כלא פעיל'
    end
where is_archived = false
  and listing_status in ('removed','sold');

commit;
