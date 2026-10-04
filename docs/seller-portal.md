# BSD seller portal

Status: hardening branch (03.10.2026). Nothing is merged or deployed. The full seller API and both portal migrations are not applied to production. The earlier single-business read-only preview source was removed from this branch; never add real client names, IDs or documents to this public repository (use fictional fixtures only).

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

Five-digit random usernames with unique database constraint. No temporary password is generated or sent: the manager creates a one-time activation link (43-character random secret in the URL fragment, only its SHA-256 stored, 24-hour expiry by default via SELLER_PORTAL_ACTIVATION_HOURS, consumed atomically in the same UPDATE that stores the password, and invalidated by any newer link). The seller chooses a password of at least ten characters with letters and digits. PBKDF2-SHA256 600,000 iterations with per-password random salt; the hash stores its iteration count so cost can be tuned (measured about 0.1 s per hash locally, Supabase limit is 2 s CPU per request).
Sessions: random 48-character opaque token; only SHA256 stored; browser sessionStorage; 8-hour absolute expiry and 30-minute idle expiry checked server-side; reset/block/archive revokes sessions. Existing business deletion remains possible: portal accounts and activity history are retained with a null business reference and blocked access; no new foreign key restricts the existing business deletion flow.
Independent atomic per-address (30/15 min), per-username (8/15 min) and global failed-login (300/15 min) limits; activation and recovery have per-address and global limits. The address comes from SELLER_PORTAL_IP_HEADER (default cf-connecting-ip, set by the gateway) or the right-most X-Forwarded-For element, never the caller-controlled left-most one. Unknown usernames get a uniform error and password hash verification cost. Recovery responses do not disclose account existence.
Every PDF request rechecks account, session, business, visibility, active file state, business ownership, path namespace and actual PDF signature. No storage signed URL is exposed to the seller; original bytes pass through the authenticated API.
All six portal tables have RLS and no anon/authenticated grants. Only the dedicated API accesses them with service_role. Secrets stay in environment variables. The archive security-definer trigger resides in an unexposed private schema with execute revoked.
Only active CRM admin/manager users manage portal. Existing CRM RLS untouched; an extra trigger denies file visibility changes by agents. Audit entries do not retain passwords or message text.

## Verification scope and limits

Local TypeScript checks, handler tests, isolated PostgreSQL-compatible migration tests, and original inline-script syntax checks are available in tests/portal.
Cloud staging, end-to-end production data flows, WhatsApp delivery, email delivery, and live mobile PDF behavior have not been verified. The WhatsApp action prepares a wa.me message; it does not send without the manager's action.
The public site should remain unmodified until the isolated preview and explicit production approval. Neither pull request is to be merged automatically.

## Rollback

Revert frontend/API release first; keep portal tables and history for a forward repair. Do not DROP tables or remove visibility columns during an emergency rollback. Existing CRM workflows continue independently. Database changes are additive, but require the predeployment backup and staging validation before application.


## Expanded requirements on 2026-10-03

The approved welcome thanks the owner for cooperation and emphasizes patience, precision and personal accompaniment. The website entry is named כניסת בעלי עסקים, uses a distinct teal button, and remains visible on mobile while the other navigation uses the existing menu. Shared CSS and the generator compress the desktop header into one row; generated HTML uses a new stylesheet URL.

Existing business cards have an opt-in checkbox, generated credentials, a WhatsApp composer with a warm message, blocking, password reset, and portal-only deletion. New-business activation runs after successful business save and requires an active signed business. Deletion invalidates credentials and sessions, retains an audit account marked deleted, and never removes business records, documents, or storage objects. Recreating the portal explicitly assigns new credentials.

Activity recording accepts only five portal areas and bounded durations. Visible recent interaction triggers a heartbeat; the database locks the session and caps reported time to elapsed server time to prevent duplicate counting across tabs. Management includes filtered activity, pages and original document names, measured duration, and CSV export. No keystroke contents are collected.

Facebook report rows offer a CRM business selector and a separate publication button. Download and email do not publish. Publication checks admin access to the exact selected business, verifies a portal account and the original PDF, asks the manager to confirm the target, uploads only that per-business PDF, and binds metadata and storage to the selected business ID. Combined multi-business reports cannot be published through this path. On insertion failure the uploaded object is removed. Download/email/publication reuse the same PDF Blob. No real advertising report was published; Baruch asked to test this later.

The expanded handler, security and migration tests run offline. Browser viewport/device testing of the expanded layout still needs completion. Production activation requires validated staging, a backup/restore plan, configured API URL and Baruch's explicit approval; never merge an API-blank frontend release.


## Hardening on 2026-10-03

- One-time activation link replaces the temporary password in the WhatsApp/email message (js/portal-invite.js builds one shared text that guides the seller to the website button «פורטל בעלי עסקים» and includes the direct link). The CRM only opens wa.me/mailto for the manager to send; nothing is sent automatically.
- Migration 20261003170000_seller_portal_hardening.sql: activation columns, seller_portal_activate (single use), seller_portal_attempts_exceeded (global ceiling), seller_portal_prune (rate limits after 1 day, sessions 90 days after expiry/revocation, heartbeat/page_view events after 400 days, stale activation hashes) called on about 2% of logins; events keep their audit rows (session FK on delete set null).
- The seller sees the latest APPROVED file of each type: approval is checked before choosing the newest.
- Content-Security-Policy meta on portal/index.html and portal-admin.html. When hosting on the public site, the worker header CSP must allow the same API origin in connect-src.
- The «ניהול הפורטל» menu link is rendered only for active admin/manager profiles and portal-admin.html shows «אין הרשאה» to others; the API still enforces this on every admin_* action.
- Show-password eye toggle on the login form.
- Verified on a local isolated stack (PostgreSQL 17 + PostgREST + the real seller-portal-api code, fictional data). Hosted Supabase staging was not available (branching requires the Pro plan).

## Version 2 on 2026-10-04 (approved by the owner)
1. **One-click account opening.** In the CRM business card (admin/manager only), checking
   «פתח חשבון בפורטל» calls `admin_open`. The server creates a 5-digit username and a random
   10-character password (PBKDF2 hash only is stored), and the browser opens a ready wa.me
   message that BSD sends manually. The message tells the owner to enter only through
   www.bsd-bbi.co.il → the blue «פורטל בעלי עסקים» button. Unchecking blocks the account;
   the card also has reset password + WhatsApp, block/unblock and delete. Nothing is sent
   automatically. Inside the portal the owner can change the password («החלפת סיסמה»,
   current password required, rate-limited). The old one-time activation link
   (`#activate=`) still works for accounts opened before v2.
2. **Automatic documents.** The portal shows the newest active PDF of each business-card
   document type: anonymous summary, full summary, valuation (economic analysis) and market
   research, using the same mapping as `js/saleFileModule2.js`. No per-file approval. The
   latest published advertising report is shown as before.
3. **Simple admin screen** (`portal-admin.html`, `admin_overview`/`admin_detail`): when and
   how many times each owner logged in, which files were viewed/downloaded, and upload of
   extra files (images, PDF, Office, txt/csv, mp4/mov, zip; max 20 MB; no html/svg). Extra
   files go to `business-files/{business_id}/seller-portal-extra/{id}.{ext}` through a
   server-issued signed upload URL and are listed in `seller_portal_files`.
4. **Active users** in the admin screen stats is clickable and shows a read-only list.

Separation is unchanged: every seller request is scoped to the session's own business,
storage paths must start with `{business_id}/`, and the dashboard never returns buyers,
matches, prices or commissions.

### v2 rollback
See `docs/seller-portal-v2-rollback.sql`: revert the frontend commit, redeploy the v1
function code, remove extra-file storage objects, then drop the v2 table/column/index.
