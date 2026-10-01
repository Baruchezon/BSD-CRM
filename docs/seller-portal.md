# BSD seller portal

Status: implementation branch only. Production untouched. Backend not deployed.

## Verified mapping

BSD CRM repository: Baruchezon/BSD-CRM, static HTML + Supabase Edge Functions.
Active database: zcdlegcvfirwzitfxjcs (Supabase), verified by read-only information_schema queries on 2026-10-01. business-files is private.
Public site: Baruchezon/bsd-bbi-website, Cloudflare Worker with static dist and source/generate.mjs.
Documents: business_sale_files; originals retained, no regenerated portal copy. General attachments are read from business_file_meta with separate default-false approvals, the same business/path checks, and a separate audit reference.
Matches: matches with counterparty_type=buyer and buyer_id -> leads; the existing agreement_status is used, not an invented nda_status field.
Privacy: default hide all matches and documents. Administrator approval required; identity disclosure is separately approved.
Advertising: ad-reports.html currently builds real PDFs in the browser. Explicit CRM business selection avoids misassigning CSV names. The exact Blob downloaded/emailed is uploaded once when the portal checkbox is checked.
The seller portal is entirely separate from buyer VIP accounts.

## Isolated staging

1. Create a Supabase development branch after the provider's explicit cost confirmation. Only production branch existed during this task. Never run the SQL or deploy this function on zcdlegcvfirwzitfxjcs while awaiting production approval.
2. Before any database modification, snapshot/export the staging schema. Before production approval, retain a verified production backup and restore plan. No database modification was made in this task.
3. Verify production migrations and baseline tables exist on staging. Branch creation does not copy production data. Use labeled synthetic test fixtures only; never seed confidential client documents without explicit selection.
4. Apply supabase/migrations/20261001130324_seller_portal.sql to staging only.
5. Deploy seller-portal-api to staging with verify_jwt=false because the handler implements custom seller authentication plus verified CRM JWTs. No other function is replaced.
6. Set SELLER_PORTAL_ORIGINS to the exact preview origin and CRM staging origin. No wildcard. Set SELLER_PORTAL_URL, SELLER_PORTAL_PHONE using verified BSD contact information, and a random SELLER_PORTAL_IP_SALT secret.
7. Point portal/config.js apiUrl and BSD_CONFIG.SELLER_PORTAL_API_URL to the staging function. Copy CRM config to staging Supabase URL and staging publishable key; do not reuse the production CRM connection in staging.
8. Public-site branch includes source/portal assets and generated dist/seller-portal. The website button points to /seller-portal/.
9. Validate two separate seller accounts, a signed and unsigned business, archive/re-enable, all three device sizes, a real PDF in mobile Safari and Android, manager approvals, report email/download byte identity, and recovery requests in management inbox.
10. Production deployment requires Baruch's explicit approval after cloud staging passes.

## Security

Five-digit random usernames with unique database constraint. Five-character temporary passwords as requested, one-time display, 24-hour expiry, mandatory replacement with at least ten characters before data access. PBKDF2-SHA256 600,000 iterations with per-password random salt. No reversible password storage.
Sessions: random 48-character opaque token; only SHA256 stored; browser sessionStorage; 8-hour absolute expiry and 30-minute idle expiry checked server-side; reset/block/archive revokes sessions.
Independent atomic per-IP and per-username limits. Unknown usernames get a uniform error and password hash verification cost. Recovery responses do not disclose account existence.
Every PDF request rechecks account, session, business, visibility, active file state, business ownership, path namespace and actual PDF signature. No storage signed URL is exposed to the seller; original bytes pass through the authenticated API.
All six portal tables have RLS and no anon/authenticated grants. Only the dedicated API accesses them with service_role. Secrets stay in environment variables. The archive security-definer trigger resides in an unexposed private schema with execute revoked.
Only active CRM admin/manager users manage portal. Existing CRM RLS untouched; an extra trigger denies file visibility changes by agents. Audit entries do not retain passwords or message text.

## Verification scope and limits

Local TypeScript checks, handler tests, isolated PostgreSQL-compatible migration tests, and original inline-script syntax checks are available in tests/portal.
Cloud staging, end-to-end production data flows, WhatsApp delivery, email delivery, and live mobile PDF behavior have not been verified. The WhatsApp action prepares a wa.me message; it does not send without the manager's action.
The public site should remain unmodified until the isolated preview and explicit production approval. Neither pull request is to be merged automatically.

## Rollback

Revert frontend/API release first; keep portal tables and history for a forward repair. Do not DROP tables or remove visibility columns during an emergency rollback. Existing CRM workflows continue independently. Database changes are additive, but require the predeployment backup and staging validation before application.
