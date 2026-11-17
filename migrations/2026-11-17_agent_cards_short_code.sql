-- Short public aliases for published BSD digital business cards.
-- Short codes are public identifiers, never CRM identities or secrets.
alter table public.agent_digital_cards
  add column if not exists short_code text;

update public.agent_digital_cards
set short_code='ezon'
where short_code is null
  and owner_user_id in (
    select id from public.profiles
    where lower(email)='baruch@bsd-bbi.co.il'
      and status::text='active'
  );

update public.agent_digital_cards
set short_code='c'||substr(replace(gen_random_uuid()::text,'-',''),1,9)
where short_code is null;

alter table public.agent_digital_cards
  alter column short_code set default ('c'||substr(replace(gen_random_uuid()::text,'-',''),1,9));

alter table public.agent_digital_cards
  alter column short_code set not null;

create unique index if not exists agent_digital_cards_short_code_unique
  on public.agent_digital_cards (short_code);

do $guard$ begin
  if not exists (
    select 1 from pg_constraint
    where conname='agent_digital_cards_short_code_format'
      and conrelid='public.agent_digital_cards'::regclass
  ) then
    alter table public.agent_digital_cards
      add constraint agent_digital_cards_short_code_format
      check (short_code ~ '^[a-z][a-z0-9-]{2,23}$');
  end if;
end $guard$;
-- Intentionally do not grant UPDATE on short_code to authenticated users.
