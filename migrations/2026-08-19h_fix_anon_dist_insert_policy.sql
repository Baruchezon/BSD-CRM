-- ============================================================================
-- BSD-CRM — אותו תיקון בדיוק על anon_distributions INSERT (JOIN ל-businesses
-- היה כפוף ל-RLS של businesses עצמה, חוסם למי שאין לו full_business_access)
-- תאריך: 19/08/2026 (המשך ל-2026-08-19g)
-- ============================================================================

drop policy if exists "anon_dist_insert" on anon_distributions;
create policy "anon_dist_insert" on anon_distributions
  for insert with check (
    sender_user_id = auth.uid()
    and exists (
      select 1 from leads l where l.id = buyer_id
      and (l.created_by = auth.uid() or l.handled_by = auth.uid()
           or exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin','manager')))
    )
    and exists (
      select 1 from business_sale_files f
      where f.id = anon_file_id and f.business_id = anon_distributions.business_id
        and f.confidentiality_level = 1 and f.status = 'active'
        and is_business_anon_card_active(f.business_id)
    )
  );
