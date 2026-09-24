-- Allow changing agreement_status away from «יש הסכם חתום» even when
-- agreement_pdf_path is set (so admins can send a new agreement).
-- Auto-promote to signed only when a PDF is newly attached.
-- Sync lead agreement_sent / agreement_signed when status is explicitly changed.

create or replace function public.enforce_signed_agreement_state()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  -- Auto-promote to signed only when a PDF path is newly attached.
  if nullif(new.agreement_pdf_path, '') is not null
     and (
       tg_op = 'INSERT'
       or nullif(old.agreement_pdf_path, '') is null
     ) then
    new.agreement_status := 'יש הסכם חתום';
    if tg_table_name = 'leads' then
      new.agreement_sent := true;
      new.agreement_signed := true;
      new.agreement_signed_date := coalesce(new.agreement_signed_date, current_date);
    end if;
    return new;
  end if;

  -- Explicit status change: do not revert; sync lead flags to match status.
  if tg_op = 'UPDATE'
     and tg_table_name = 'leads'
     and new.agreement_status is distinct from old.agreement_status then
    if new.agreement_status = 'יש הסכם חתום' then
      new.agreement_sent := true;
      new.agreement_signed := true;
      new.agreement_signed_date := coalesce(new.agreement_signed_date, current_date);
    elsif new.agreement_status = 'נשלח הסכם לחתימה' then
      new.agreement_sent := true;
      new.agreement_signed := false;
    else
      -- «אין הסכם» or empty/other
      new.agreement_sent := false;
      new.agreement_signed := false;
    end if;
  end if;

  return new;
end;
$function$;
