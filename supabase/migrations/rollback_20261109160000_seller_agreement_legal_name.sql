-- Rolls back seller-agreement legal name + signer prefill.
-- Dropping businesses.legal_name and leads.entity_type deletes values stored there.

drop function if exists public.get_agreement_signer_prefill(text);
drop function if exists public.create_agreement_signer_prefill(text, uuid);
drop table if exists public.agreement_signer_prefill;

alter table public.leads drop column if exists entity_type;
alter table public.businesses drop column if exists legal_name;
