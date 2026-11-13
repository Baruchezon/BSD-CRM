// Send the approved alert letter to one subscriber.
// A service-role key may be used. The function sends a real letter for an
// is_test subscriber even while the global switches are off. Anyone else
// stays gated.
//
// Usage:
//   node scripts/resend-one-alert.mjs <subscriber-uuid>
//   node scripts/resend-one-alert.mjs <subscriber-uuid> --businesses 1014,1015,1021
//   BSD_SERVICE_ROLE_KEY=... node scripts/resend-one-alert.mjs <subscriber-uuid> --confirm
//   BSD_ADMIN_JWT=... node scripts/resend-one-alert.mjs <subscriber-uuid> --confirm

import { fileURLToPath } from "node:url";

export function resendPlan(argv, env = {}) {
  const args = argv.slice(2);
  const confirm = args.includes("--confirm");
  const id = args.find(arg => !arg.startsWith("--")) || "";
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(id)) return { error: "Pass one subscriber id.", status: 2 };
  const businesses = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--business" && args[index + 1]) businesses.push(args[index + 1]);
    if (args[index] === "--businesses" && args[index + 1]) {
      businesses.push(...args[index + 1].split(",").map(item => item.trim()).filter(Boolean));
    }
  }
  const body = { action: "send_one_alert", id, confirm };
  if (businesses.length) body.businesses = businesses;
  const token = env.BSD_SERVICE_ROLE_KEY || env.BSD_ADMIN_JWT || "";
  const auth = env.BSD_SERVICE_ROLE_KEY ? "service_role" : env.BSD_ADMIN_JWT ? "staff" : "";
  return { body, token, auth, status: confirm && !token ? 2 : 0 };
}

const invoked = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invoked) {
  const plan = resendPlan(process.argv, process.env);
  if (plan.error) {
    console.error(plan.error);
    process.exit(plan.status);
  }
  console.log(JSON.stringify(plan.body));
  if (!plan.body.confirm) process.exit(0);
  if (!plan.token) {
    console.error("Set BSD_SERVICE_ROLE_KEY or BSD_ADMIN_JWT before confirming.");
    process.exit(2);
  }
  const base = process.env.SUPABASE_URL || "https://zcdlegcvfirwzitfxjcs.supabase.co";
  const response = await fetch(`${base.replace(/\/$/, "")}/functions/v1/business-alert-admin`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${plan.token}` },
    body: JSON.stringify(plan.body)
  });
  const text = await response.text();
  console.log(response.status, text);
  process.exit(response.ok ? 0 : 1);
}
