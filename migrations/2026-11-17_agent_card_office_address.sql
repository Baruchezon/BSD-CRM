alter table public.agent_digital_cards
 add column if not exists office_address text not null default '';
grant update (office_address) on table public.agent_digital_cards to authenticated;
update public.agent_digital_cards
set office_address='מצדה 9, מגדל ב.ס.ר 3, בני ברק'
where owner_user_id in (select id from public.profiles where email='baruch@bsd-bbi.co.il')
  and coalesce(office_address,'')='';
