-- Keep signed agreements immutable against stale browser saves and track PDF email delivery.
alter table public.businesses
  add column if not exists agreement_email_sent_at timestamptz,
  add column if not exists agreement_email_last_error text;

alter table public.leads
  add column if not exists agreement_email_sent_at timestamptz,
  add column if not exists agreement_email_last_error text;

alter table public.brokers
  add column if not exists agreement_email_sent_at timestamptz,
  add column if not exists agreement_email_last_error text;

create or replace function public.enforce_signed_agreement_state()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if nullif(new.agreement_pdf_path, '') is not null then
    new.agreement_status := 'יש הסכם חתום';
    if tg_table_name = 'leads' then
      new.agreement_sent := true;
      new.agreement_signed := true;
      new.agreement_signed_date := coalesce(new.agreement_signed_date, current_date);
    end if;
  elsif nullif(old.agreement_pdf_path, '') is not null
        and old.agreement_status = 'יש הסכם חתום'
        and new.agreement_status is distinct from old.agreement_status then
    new.agreement_status := old.agreement_status;
    if tg_table_name = 'leads' then
      new.agreement_sent := true;
      new.agreement_signed := true;
      new.agreement_signed_date := coalesce(old.agreement_signed_date, current_date);
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_businesses_signed_agreement_state on public.businesses;
create trigger trg_businesses_signed_agreement_state
before insert or update on public.businesses
for each row execute function public.enforce_signed_agreement_state();

drop trigger if exists trg_leads_signed_agreement_state on public.leads;
create trigger trg_leads_signed_agreement_state
before insert or update on public.leads
for each row execute function public.enforce_signed_agreement_state();

drop trigger if exists trg_brokers_signed_agreement_state on public.brokers;
create trigger trg_brokers_signed_agreement_state
before insert or update on public.brokers
for each row execute function public.enforce_signed_agreement_state();

update public.businesses
set agreement_status = 'יש הסכם חתום'
where nullif(agreement_pdf_path, '') is not null
  and agreement_status is distinct from 'יש הסכם חתום';

update public.leads
set agreement_status = 'יש הסכם חתום',
    agreement_sent = true,
    agreement_signed = true,
    agreement_signed_date = coalesce(agreement_signed_date, agreement_pdf_uploaded_at::date, current_date)
where nullif(agreement_pdf_path, '') is not null
  and (
    agreement_status is distinct from 'יש הסכם חתום'
    or agreement_sent is distinct from true
    or agreement_signed is distinct from true
    or agreement_signed_date is null
  );

update public.brokers
set agreement_status = 'יש הסכם חתום'
where nullif(agreement_pdf_path, '') is not null
  and agreement_status is distinct from 'יש הסכם חתום';
