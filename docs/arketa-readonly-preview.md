# Arketa private preview source

Status: prepared and tested offline; NOT deployed. Baruch selected Arketa on 2026-10-03 and requires the latest created file of each type. The owner-private Site now has the real bounded snapshot and original PDFs. Live automatic reads still require source activation and Site server wiring.

## Exact proposed change requiring production approval

Add one new Supabase Edge Function named arketa-preview-readonly to project zcdlegcvfirwzitfxjcs. Do not replace any existing function. Deploy with verify_jwt=false because the handler authenticates a separate 256-bit server-to-server token by its SHA256 hash. No migrations, table changes, grants, RLS changes, database writes, storage uploads, CRM merges, or website publication are required.

The function uses its built-in Supabase server secret inside the Supabase runtime only. It performs GET reads for the fixed Arketa business UUID, its latest four core document types, anonymized match status metadata, and the requested original PDF. It accepts neither SQL nor arbitrary URLs or table names. An archived business or missing signed agreement blocks access immediately. The Site must keep the bridge token as a server-only runtime secret; never give it to the browser or store it in source. The current source contains only its hash. If that token is unavailable when activating, generate a new token, replace the source hash, and update the Site runtime secret together.

Before activation, obtain Baruch's explicit approval for adding this one read-only component to the active project. This is distinct from the already authorized private snapshot import. Do not deploy the full seller-portal migration or merge the existing PR as part of this isolated preview step.

## Verification and handoff

Offline tests passed for authorization, GET-only provider operations, fixed Arketa predicates, latest-document grouping, direct old/other-document denial, PDF validation, archive/agreement revocation, and fail-closed provider errors. These mocks do not prove deployed API or live source access. After approved deployment, configure the Site server, verify an authenticated source read and PDF byte identity, and report whether refresh reads current source state. Retain the private Site audience and existing seller/manager login details.

Rollback: disable the Site bridge configuration, then delete only this newly added function if needed. Leave the existing production database and functions untouched.
