import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../supabase/functions/vip-api/index.ts", import.meta.url), "utf8");

assert.match(source, /if \(action\.startsWith\("admin_"\)\)[\s\S]*authenticateAdmin\(req\)/);
assert.match(source, /action === "admin_restore_legacy_files"[\s\S]*handleAdminRestoreLegacyFiles\(req, admin\)/);
assert.match(source, /source: "auto_generated"/);
assert.match(source, /auditAdmin\("vip_restore_legacy_files"/);
assert.match(source, /createSignedUrls\(paths, 60\)/);
assert.match(source, /if \(!latest\.has\(key\)\)/);

console.log("VIP legacy restore contract passed");
