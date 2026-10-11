# Weekly marketing reports in the seller portal (approved by Baruch 11.10.2026; deployed in stages, see PR)
Spec: /workspace/bsd-reports/eldad-portal-reports-spec.md (Baruch's directive 10.10.2026 22:12).

## What changes
- G1 `seller-portal-api/latest-files.ts`: every published advertising PDF of the business, newest period first, one entry per
  `version_group_id` (highest `version_number` wins; older versions stay in DB/storage). `handler.ts portalFiles()` now also reads
  `version_number, version_group_id` (without them the version collapse cannot work). Label «דוחות פעילות שיווקית».
- Portal UI: tab, home counter and section heading «דוחות פעילות שיווקית»; period shown as «09.10–15.10.2026». No new buttons.
- G2 `publish_marketing_report` (seller-portal-api action). Caller: a CRM JWT whose profile is active, not viewer, and has
  `can_publish_marketing_reports=true`. Request `{business_id, business_number, period_from, period_to, report_type:'weekly', sha256,
  file_name, pdf_base64, posts_in_period?}` (PDF ≤ 16 MB). Errors: 409 business_mismatch / not_eligible / no_active_portal / blocked_portal,
  400 bad_period / invalid_pdf / invalid_request, 401, 403. Same PDF again → 200 `{duplicate:true}` and nothing written; changed PDF →
  `version_number+1` in the same group. Writes `business-files/<business_id>/seller-portal-ad-reports/<uuid>.pdf` (upsert:false), one
  `business_sale_files` row (category «דוחות פעילות שיווקית», advertising, visible, auto_generated, confidentiality 2), `audit_log`
  `marketing_report_published`, and the `marketing_report_runs` mirror. Response `{file_id, storage_path, version_number, sha256}`.
- G3 `verify_marketing_report {business_id, file_id}`: the six checks (object+sha256, DB row, owner list, owner download through the
  seller `file` code path, cross-tenant 404 for every other active account, bucket private / no signed URL). Result mirrored to
  `marketing_report_runs` (`uploaded_verified` only when 6/6).
- Request bodies above 16 KB are accepted only for `publish_marketing_report` with a bearer token; every other caller keeps the 16 KB limit.
- G4 migration `supabase/migrations/20261011090000_marketing_reports_additive.sql` (+ guard trigger so users cannot self-grant the bot flag).
  Rollback: `docs/marketing-reports-rollback.sql`.
- G6 `marketing-reports.html` + `js/marketing-reports.js`: read-only status screen, admin/manager only (RLS), no buttons, not linked from the menu.

## Tests
`deno test -A tests/portal/marketing_reports_test.ts` (unit) and the local end-to-end stack in /workspace/bsd-reports/eldad-local
(Postgres 17 with the production schema mirror, PostgREST 12, storage emulator, this handler) — see ELDAD-RESULTS.md.

## Profile permission guard (approved 11.10.2026)
`supabase/migrations/20261011094500_profiles_permission_fields_guard.sql`: `protect_profile_privileged_fields()` now keeps role, status,
internal_code, document_access_level, must_change_password and every `can_*` column unchanged unless the caller is an admin or the
service role. Self-edits of name/phone/city/company/job title/licence and login counters still work. Rollback: `docs/profiles-permission-guard-rollback.sql`.
