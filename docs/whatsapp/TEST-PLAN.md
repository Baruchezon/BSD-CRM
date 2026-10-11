# WhatsApp 077 - test plan

## A. Automated (run on the branch, no network, no production)

| Suite | Command | Result 11.10.2026 (review re-run) |
|---|---|---|
| Edge functions (Deno) | `cd tests/whatsapp && deno test -q .` | 58 passed (56 from the original patch + media-host allowlist + refusal to fetch a non-Meta media URL) |
| DB migration + RLS + rollback (local Postgres 16, stub of the prod objects) | `PGHOST=… PGPORT=… PGUSER=postgres tests/whatsapp/db/run-db-test.sh` | 40 assertions passed, rollback removes every object, re-apply clean (twice) |
| CRM UI helpers + "hidden by default" contract | `node --test tests/whatsapp_ui.test.mjs` | 7 passed |
| Existing CRM tests (regression) | `node --test tests/*.test.mjs` | 245/245 passed (238 existing + 7 new) |
| Template lint + payloads | `deno run -A scripts/whatsapp/submit-templates.ts` | 12/12 OK (dry run, nothing sent). `display_name` is `BSD מכירת עסקים`; footers stay `BSD Business Brokers Israel` |
| Type check | `deno check supabase/functions/{whatsapp-send,whatsapp-webhook,go}/index.ts` | clean (complete-signed-agreement keeps its 9 pre-existing supabase-js typing errors, same count as the original patch) |

What the suites cover: modes off/simulate/dry_run/live; card channel flag; phone must belong to the card; dry-run
allow-list; 24h window; opt-out list / card opt-out / marketing / utility consent; idempotency; per-user and daily
limits; Graph errors (131047 → template needed); agreement send with short link + `rid`/`rt` and no raw URL;
permissions (viewer, agent without `can_send_agreement`, foreign record/conversation/storage path); webhook signature,
GET verify, text, buttons, media download + sha256 + storage path, failures, duplicates, ambiguous linking, manual link
kept, STOP/opt-out button, status ordering, foreign phone_number_id, retry on DB error; short links (302, 410, 404,
foreign host, HEAD); signed copy (inert when off/personal, template outside window, document inside, sent once);
RLS per role, storage restrictive policies, direct writes blocked, «אשר כהסכם חתום» only after the existing save,
consent stamps server-side (including a forged marketing timestamp), opt-out wins, an agent cannot create a card
already on the API channel, media download URLs must be Meta hosts.

## B. Staging on production infrastructure (after Baruch approves GO-LIVE steps 1-6) - mode `dry_run`

Only Baruch's phone can receive anything (`WHATSAPP_TEST_NUMBERS=972542424999`).

1. Create a **test business** card «בדיקה WhatsApp 077» with owner phone 054-2424999, set
   `whatsapp_opt_in` = true (from the card), admin switches it to 077 (`wa_set_record_channel`).
2. `status` from the card section → mode `dry_run`, channel `api`, window closed.
3. From the phone, send «שלום» to 077-444-6707 → appears in the inbox within 15s, linked to the test card, unread 1;
   opening clears unread. (If 054-2424999 is also on another card → conversation shows «כמה כרטיסים», link manually.)
4. Reply with free text from the inbox → arrives; status ✓ → ✓✓ → ✓✓ נקרא.
5. Send a PDF from the inbox (📎) → arrives as a document with the original Hebrew file name.
6. From the phone send a photo and a PDF → both visible in the thread with צפייה / הורדה; the PDF appears under
   «מסמכים שהתקבלו» on the card; the card does **not** turn green.
7. «אשר כהסכם חתום» on that PDF → card green, PDF available in the existing «צפייה/הורדה» of the agreement section,
   stamp «אושר כהסכם חתום» on the message.
   Reset the test card afterwards (admin): status back to «אין הסכם», remove `agreement_pdf_path`.
8. Agreement: open admin-prep from the test card (URL has `waApi=1`) → «📲 שלח מ-077» → template message with button
   «לצפייה וחתימה» (requires the template approved) → button opens `…/go/<code>` → signing page with `rid`/`rt` →
   sign → card green (existing flow) → signed copy arrives on WhatsApp (document, window open).
9. Reminder: card «⏰ תזכורת חתימה» → same short link reused.
10. Wait > 24h without writing from the phone → reply box switches to «תבנית מאושרת»; free text is refused with the
    Hebrew message; `bsd_meeting_summary` works.
11. Send «הסר» from the phone → `whatsapp_opt_outs` row, card opt-out; any template now refused «הלקוח ביקש להסיר».
    Clear with `wa_clear_opt_out` (admin, reason) to continue testing.
12. Try any other card on 077 with a non-test phone → refused `dry_run_number_not_allowed`, nothing sent.
13. Agent login (non-admin): sees only conversations of own cards; cannot switch channel; viewer sees no inbox.
14. Short link expired / revoked (`wa_revoke_short_link`) → Hebrew 410 page.
15. Webhook signature: `curl -X POST …/whatsapp-webhook -d '{}'` → 401.

## C. Pilot (mode `live`, one real business), then gradual

Only after B passes and Baruch approves: switch one real business card to 077, watch `whatsapp_messages` /
Meta quality rating for a week, then add cards gradually. Other cards stay on 054.
