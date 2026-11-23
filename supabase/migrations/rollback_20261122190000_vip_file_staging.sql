-- Rollback of 20261122190000_vip_file_staging. Removes the functions (the edge function then fails closed: 403/500).
-- Tables and rows are KEPT (no hard deletes). Uploaded files stay in Storage; to withdraw them, see ROLLBACK note:
--   select public.vip_file_revoke(sale_file_id,'<who>') from public.vip_file_staging where status='uploaded';
--   update public.business_sale_files set status='deleted', deleted_at=now() where id in
--     (select sale_file_id from public.vip_file_staging where status='uploaded');   -- soft delete only
--   update public.vip_file_staging set status='cancelled', updated_at=now() where status in ('pending','uploading','failed');
drop function if exists public.vip_file_stage_dispatch(text);
drop function if exists public.vip_file_stage_finish(uuid,boolean,text);
drop function if exists public.vip_file_stage_claim_next();
drop function if exists public.vip_file_stage_use_token(text);
