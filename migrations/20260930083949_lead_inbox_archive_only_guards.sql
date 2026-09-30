-- Additive restrictions preserve all existing ownership and role permissions.
create policy lead_inbox_archive_only on public.leads
  as restrictive for delete to authenticated using (is_archived = true);
create policy business_archive_only_guard on public.businesses
  as restrictive for delete to authenticated using (is_archived = true);
create policy review_archive_only_guard on public.leads_2026_review
  as restrictive for delete to authenticated using (is_hidden = true);
