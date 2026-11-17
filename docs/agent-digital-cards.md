# Agent digital business cards (BSD CRM)

Scope: **one isolated CRM module**, no existing business, lead, messaging, or payment tables changed.

## User experience
* CRM Settings > כרטיס ביקור דיגיטלי, available to active admin, manager, agent and agent_authorized profiles.
* Each agent may create and manage cards belonging to their own CRM account.
* Admin can optionally create cards for other active users and see all cards. Manager is limited to own cards.
* Create, upload photo (JPG/PNG/WEBP <=3 MB), edit, publish/unpublish, send WhatsApp link, share natively, copy URL, save a standalone HTML snapshot, or download a VCF contact.
* Editing keeps the unguessable public UUID link stable. Disabled/unpublished cards return 404 from public API.
* Sending uses WhatsApp deep-link, **not automated API sending**. The user has to press Send inside WhatsApp.
* Adding to phonebook uses VCF and requires the recipient to approve saving. Browser cannot verify successful save.

## Security boundaries
* NEVER grant anon SELECT on agent_digital_cards.
* Database RLS checks real active CRM profiles, verifies ownership on all reads/writes, and prevents changing owner_user_id and public_token after creation using column-level UPDATE privileges.
* Admin has explicit cross-user privilege, otherwise each agent sees their own card rows only.
* Public endpoint **public-digital-card** returns **one published card** looked up by a high-entropy UUID. It strips owner_user_id and only returns allowlisted contact information. A blocked owner's card stops resolving.
* The public photo bucket stores **public marketing images only**. Never put customer contacts, agreements, private files or reports in it.
* Each agent can upload files only inside their own storage folder. Avoid uploading photos that are not intended for public sharing.
* All public HTML fields are rendered using DOM textContent. HTTPS/HTTP links are protocol-filtered; do not inject arbitrary HTML.
* The CRM's Supabase publishable key stays in the browser; the secret key is used only by the Edge function runtime.
* Card sharing URLs contain no CRM customer ID, buyer data, or other private record IDs.

## Rollout procedure (do not skip)
1. Review and run migrations/2026-11-17_agent_digital_cards.sql on staging and run DB RLS tests with two different authenticated agent accounts.
2. Deploy supabase/functions/public-digital-card/index.ts with verify_jwt=false. Only GET/OPTIONS are supported. Confirm a draft card returns HTTP 404.
3. Confirm published card loads in an **incognito browser** without a CRM login, and that unpublished/blocked cards return 404.
4. Upload two test cards as different agents. Confirm each agent cannot read, edit, delete, or overwrite the other user's card through direct PostgREST calls.
5. Check that admin can create for another agent but manager/agent cannot. Check image upload paths and file size/MIME rejection.
6. After these checks, merge the PR and deploy the static CRM frontend (digital-cards.html, digital-card.html, js/config.js) through the existing hosting pipeline.
7. Test on Android: WhatsApp send, browser Share, VCF save, offline HTML download, updating a live card without changing the link.
8. Verify activity on the existing CRM dashboards, mobile header wrapping, and no regressions in lead/business/customer workflows.

## URLs after deployment
* Management: /digital-cards.html (requires CRM login)
* Public card: /digital-card.html?card=<random-uuid> (only a published card)
* Menu: Settings > כרטיס ביקור דיגיטלי

## Intentional limits
* No mass WhatsApp messaging or automatic API sending.
* No CRM client lookup in this phase. Do not weaken lead/customer RLS to implement that later.
* No per-agent WhatsApp preview artwork yet. Standard website preview may be shown until a server-side share-preview endpoint is implemented.
* The offline HTML download is a snapshot, not an automatically updating copy. Share the live link to preserve future updates.
