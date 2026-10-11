# WhatsApp Cloud API (077-444-6707) - architecture

Branch `eldad/whatsapp-cloud-api`, 11.10.2026. **Nothing here is deployed or applied.** Everything is inert until the
go-live steps in [GO-LIVE.md](GO-LIVE.md) are approved by Baruch. The existing 054 `wa.me` buttons are untouched.

| Item | Value |
|---|---|
| Number | +972 77-444-6707 (Extra Mobile), phone_number_id `1346024128597094`, Meta status "pending registration" |
| Sender display name | `BSD Business Brokers Israel` (earlier draft: «BSD מכירת עסקים» - Baruch to confirm, see GO-LIVE §0) |
| Graph API | v23.0 (secret `WHATSAPP_GRAPH_VERSION` to change) |

## Parts

| Part | Path | What it does |
|---|---|---|
| Shared core | `supabase/functions/_shared/whatsapp.ts` | config, phone normalisation, payloads, **`deliver()` - every gate in one place** |
| Templates | `supabase/functions/_shared/whatsapp-templates.ts` | the 12 Hebrew templates (single source), lint, Graph submission payloads |
| DB adapter | `supabase/functions/_shared/whatsapp-store.ts` | service-role supabase-js implementation of the store |
| Send | `supabase/functions/whatsapp-send/` | CRM → WhatsApp (verify_jwt **true**). Actions: `status`, `list_templates`, `send_template`, `send_agreement`, `send_text`, `send_document`, `upload_url`, `media_url` |
| Webhook | `supabase/functions/whatsapp-webhook/` | Meta → CRM (verify_jwt **false**, HMAC `X-Hub-Signature-256`). Inbound text/buttons/media, statuses, STOP |
| Short links | `supabase/functions/go/` | `/functions/v1/go/<code>` → 302 to the signing page / portal / VIP / training form (verify_jwt **false**) |
| Signed copy | `supabase/functions/_shared/whatsapp-signed-copy.ts` + 14 lines in `complete-signed-agreement` | after signing, the signed PDF goes back to the client (only for cards on the 077 channel) |
| DB | `supabase/migrations/20261011120000_whatsapp_cloud_api.sql` | consent fields, channel flag, conversations, messages columns, short links, RLS, RPCs, storage policies |
| Rollback | `docs/whatsapp/rollback_20261011120000.sql` | exact reverse (tested) |
| CRM inbox | `whatsapp-inbox.html`, `js/whatsapp-inbox.js` | all conversations: unread, last message, linked card, thread, media, reply, template, linking |
| CRM card | `js/whatsapp-card.js` (+ one slot line in businesses/leads/brokers) | WhatsApp section on each card: channel switch, timeline, received documents, «אשר כהסכם חתום», reminder |
| CRM helpers | `js/whatsapp-api.js` | calls to whatsapp-send, template dialog, confirm-agreement flow |
| Flag | `js/config.js` → `BSD_CONFIG.WHATSAPP_API_UI = false` | hides all new UI |
| Template script | `scripts/whatsapp/submit-templates.ts` | dry-run by default → `docs/whatsapp/templates.json`; `--submit` posts to Meta |
| bsd-contracts PR | branch `eldad/whatsapp-077-agreement` | «📲 שלח מ-077» button in admin-prep (only with `waApi=1`), signing pages pass `rid` → `record_id` |

## Safety switches (layered)

1. `WHATSAPP_MODE` secret: `off` (default, missing = off) → `simulate` (no network, rows marked simulated) → `dry_run`
   (real sends **only** to `WHATSAPP_TEST_NUMBERS`, e.g. Baruch's 972542424999) → `live`.
2. Per card `whatsapp_channel`: `personal` (default for every existing card = today's 054 flow) or `api`. Only
   admin/manager can switch (`wa_set_record_channel`, logged in `activity_log`). The pilot starts with one test business.
3. `BSD_CONFIG.WHATSAPP_API_UI` (front-end only): shows the inbox link and card section.
4. Consent: utility templates need `whatsapp_opt_in` (or an open 24h window); marketing needs
   `whatsapp_marketing_opt_in` and starts with «פרסומת»; STOP / «הסר אותי» → `whatsapp_opt_outs` + card opt-out, which
   always wins.
5. Limits: daily business-initiated templates (`WHATSAPP_DAILY_LIMIT`, default 200 < Meta's initial 250), per user per
   minute (`WHATSAPP_USER_PER_MINUTE`, default 10), idempotency per `client_request_id`.

## Agreement flow on 077

1. Card → «שליחת הסכם» (unchanged) → admin-prep. For a card on channel `api` the CRM adds `waApi=1`, so admin-prep
   shows «📲 שלח מ-077» next to the regular green 054 button.
2. `whatsapp-send` `send_agreement` validates the signing URL (BSD hosts + signing pages only), adds `rid`/`rt`, stores
   it as a 10-character short link (60 days) and sends `bsd_agreement_to_sign`: text + button «לצפייה וחתימה» →
   `…/go/<code>`. No long raw link in the message.
3. The client signs → `complete-signed-agreement` (unchanged logic; now receives `record_id` from `rid`) → card green
   exactly as today → **new:** the signed PDF is sent back on WhatsApp (document inside 24h, otherwise template
   `bsd_agreement_signed_copy`). Inert for cards on `personal`.
4. If the client instead sends a signed PDF in WhatsApp: the webhook stores it in
   `business-files/whatsapp-inbound/<conversation>/<message>-<name>` and shows it under «מסמכים שהתקבלו». It is
   **never** turned green automatically. «אשר כהסכם חתום» runs the existing manual path: same storage key
   `agreements/<table>/<id>.pdf`, same RPC `save_manual_signed_agreement`, same trigger → green, then stamps the message.

## Inbox and permissions

* `whatsapp_conversations` (one row per phone) + `whatsapp_messages` (extended). View `whatsapp_conversation_list`
  (security_invoker) adds the card label.
* RLS: admin/manager see everything (incl. unlinked conversations); other active roles see conversations of cards they
  may open (`has_full_business_access`, lead owner/handler/view grant, broker viewer); viewer sees nothing. Users cannot
  insert/delete messages or conversations directly; writes go through the edge functions / RPCs.
* Storage: restrictive policies on `business-files/whatsapp-inbound|outbound/…` (read only with conversation access,
  no direct writes), because the existing `storage_select` policy lets any active user read the whole bucket.
* Linking: unique live phone match → linked automatically (`auto_phone`); several → `ambiguous` with candidates (a
  person picks); a link is never overwritten by the webhook.

## Secrets (Supabase → Edge Functions → Secrets)

See the table in [GO-LIVE.md](GO-LIVE.md#secrets).
