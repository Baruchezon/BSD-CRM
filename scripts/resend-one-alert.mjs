// Resend the approved alert letter to one subscriber.
// Without --confirm this prints a preview request and does not call the network.
// With --confirm it calls business-alert-admin. The function still sends nothing
// while sending_enabled is false or dry_run is true.
//
// Usage:
//   node scripts/resend-one-alert.mjs <subscriber-uuid>
//   BSD_ADMIN_JWT=... node scripts/resend-one-alert.mjs <subscriber-uuid> --confirm

const id = process.argv[2] || "";
const confirm = process.argv.includes("--confirm");
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

if (!uuid.test(id)) {
  console.error("Pass one subscriber id.");
  process.exit(2);
}

const body = { action: "send_one_alert", id, confirm };
console.log(JSON.stringify(body));
if (!confirm) process.exit(0);

const base = process.env.SUPABASE_URL || "https://zcdlegcvfirwzitfxjcs.supabase.co";
const jwt = process.env.BSD_ADMIN_JWT || "";
if (!jwt) {
  console.error("Set BSD_ADMIN_JWT to a staff session before confirming.");
  process.exit(2);
}

const response = await fetch(`${base.replace(/\/$/, "")}/functions/v1/business-alert-admin`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
  body: JSON.stringify(body)
});
const text = await response.text();
console.log(response.status, text);
process.exit(response.ok ? 0 : 1);
