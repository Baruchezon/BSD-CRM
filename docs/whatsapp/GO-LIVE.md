# WhatsApp 077 - go-live (every step needs Baruch's explicit approval)

Nothing below has been done. Order matters; each step is reversible as noted.

## 0. Decisions for Baruch

* **Display name** (decided, Baruch 11.10.2026): `BSD מכירת עסקים`. Approve this name on the WhatsApp Business
  account before submitting templates; Meta reviews it against the business and the website. The 12 template
  footers stay `BSD Business Brokers Israel`.
* Pilot business (one card) and the date to start `dry_run`.
* Utility templates require opt-in (`WHATSAPP_REQUIRE_OPT_IN_UTILITY=true`, default). Existing cards have no opt-in
  yet, so a first message to a client who never wrote to 077 needs the opt-in box ticked on the card (after the client
  agreed, e.g. by phone / in the agreement). Clients who write first open a 24h window and can always be answered.

## 1. Meta inputs still missing <a id="secrets"></a>

| Input | Where it comes from | Stored as (Supabase Edge Function secret) |
|---|---|---|
| Permanent **System User token** with `whatsapp_business_messaging` + `whatsapp_business_management`, asset = the WABA | Business Settings → System users → Generate token (never expires) | `WHATSAPP_TOKEN` |
| **WABA id** | WhatsApp Manager → Account tools / API Setup | `WHATSAPP_WABA_ID` (also used by the template script) |
| **App secret** (webhook signature) | Meta App → Settings → Basic → App secret | `WHATSAPP_APP_SECRET` |
| **Webhook verify token** | we generate a random string (e.g. `openssl rand -hex 24`) and paste the same value in the App webhook settings | `WHATSAPP_VERIFY_TOKEN` |
| **2FA PIN** (6 digits) for `POST /1346024128597094/register` | Baruch chooses it (or the one set in WhatsApp Manager) | used once at registration; if kept: `WHATSAPP_REGISTRATION_PIN` (not read by any function) |
| **Payment method** | WhatsApp Manager → Payment settings (credit card on the BSD business account) | not a secret |
| **App ID** (only for the DOCUMENT header examples when submitting templates) | Meta App → Settings → Basic | env of the script only: `WHATSAPP_APP_ID` |
| phone_number_id | known: `1346024128597094` | `WHATSAPP_PHONE_NUMBER_ID` |
| Test numbers | Baruch: 972542424999 | `WHATSAPP_TEST_NUMBERS` |
| Short-link base | default `https://zcdlegcvfirwzitfxjcs.supabase.co/functions/v1/go/` (must equal the URL base in the approved templates; changing it later means re-approving the URL templates) | `WHATSAPP_SHORT_LINK_BASE` |
| Mode | `off` → `simulate` → `dry_run` → `live` | `WHATSAPP_MODE` |
| Optional | `WHATSAPP_DAILY_LIMIT` (200), `WHATSAPP_USER_PER_MINUTE` (10), `WHATSAPP_GRAPH_VERSION` (v23.0), `WHATSAPP_ORIGINS` (CORS, default `https://baruchezon.github.io,https://bsd-crm.vercel.app`) | |

## 2. Steps

| # | Step | Command / action | Undo |
|---|---|---|---|
| 1 | Review + merge PR (CRM) - UI stays hidden (`WHATSAPP_API_UI=false`) | GitHub merge | revert PR |
| 2 | Apply DB migration | `supabase db push` or SQL editor: `supabase/migrations/20261011120000_whatsapp_cloud_api.sql` (single transaction) | `docs/whatsapp/rollback_20261011120000.sql` (export `whatsapp_conversations`, `whatsapp_opt_outs`, `whatsapp_short_links` first) |
| 3 | Set secrets with `WHATSAPP_MODE=off` | `supabase secrets set WHATSAPP_MODE=off WHATSAPP_PHONE_NUMBER_ID=1346024128597094 WHATSAPP_TEST_NUMBERS=972542424999 …` (token / app secret / verify token when received) | `supabase secrets unset …` |
| 4 | Deploy functions | `supabase functions deploy whatsapp-send` · `supabase functions deploy whatsapp-webhook --no-verify-jwt` · `supabase functions deploy go --no-verify-jwt` | `supabase functions delete …` |
| 5 | Re-deploy `complete-signed-agreement` with the signed-copy hook. Note: the live v6 imports its code from GitHub commit `edfba4b`; the new deploy must point at the merge commit, so review `git diff edfba4b <merge> -- supabase/functions/complete-signed-agreement` first. With `WHATSAPP_MODE=off` the hook returns immediately | `supabase functions deploy complete-signed-agreement` | re-deploy v6 (pin `edfba4b`) |
| 6 | Register the number (needs PIN + payment method) | `curl -X POST https://graph.facebook.com/v23.0/1346024128597094/register -H "Authorization: Bearer $WHATSAPP_TOKEN" -H 'Content-Type: application/json' -d '{"messaging_product":"whatsapp","pin":"<6 digits>"}'` | `/deregister` |
| 7 | Webhook: App → WhatsApp → Configuration: callback `https://zcdlegcvfirwzitfxjcs.supabase.co/functions/v1/whatsapp-webhook`, verify token = `WHATSAPP_VERIFY_TOKEN`, subscribe field **messages**; then `POST /<WABA_ID>/subscribed_apps` | Meta UI + curl | unsubscribe |
| 8 | Submit the 12 templates (display name `BSD מכירת עסקים` approved first; footers stay `BSD Business Brokers Israel`) | `WHATSAPP_WABA_ID=… WHATSAPP_TOKEN=… WHATSAPP_APP_ID=… deno run -A scripts/whatsapp/submit-templates.ts --submit` | delete template in WhatsApp Manager |
| 9 | `WHATSAPP_MODE=dry_run`, `BSD_CONFIG.WHATSAPP_API_UI=true` (CRM commit), test business on channel `api` → run TEST-PLAN §B | | mode `off`, flag false |
| 10 | bsd-contracts PR merge (077 button appears only with `waApi=1`; signing pages pass `rid`; fixes broker `brokerId` bug - see below) | GitHub merge | revert PR |
| 11 | `WHATSAPP_MODE=live`, one real business on `api` (pilot) | | card back to `personal` / mode `dry_run` |
| 12 | Gradual: more cards → `api`. 054 buttons remain until Baruch decides to retire them (separate change) | | |

## 3. Rollback (any time)

1. `supabase secrets set WHATSAPP_MODE=off` - stops every send immediately (webhook keeps storing inbound messages).
2. Cards back to 054: `update … set whatsapp_channel='personal'` (admin) - the existing flow never depended on 077.
3. CRM: `WHATSAPP_API_UI=false` hides inbox and card section.
4. Full removal: delete the 3 functions, re-deploy `complete-signed-agreement` v6, run the rollback SQL (after export),
   storage files under `business-files/whatsapp-inbound|outbound/` remain until deleted deliberately.

## 4. Known issues found while building

* **bsd-contracts broker signing page** references `brokerId` but never defines it, so `completeSignedAgreement()`
  throws before calling the server and the broker sees «החתימה נשמרה חלקית…». The bsd-contracts PR defines it
  (from `brokerId` / `rid`). This changes live behaviour of the broker page once merged (it starts saving), so it is
  called out for Baruch's review.
* Seller-type **leads** open admin-prep as `seller`, whose signing page posts `table_name: 'businesses'`. Unchanged here
  (the 077 button sends with `recordTable=leads`, the signing page only uses `rid` when `rt` matches its table).
* The CRM list objects may not carry `whatsapp_channel` until the list query includes it; then admin-prep simply gets
  no `waApi=1` and the regular 054 button is used. Card section and inbox read it directly.
