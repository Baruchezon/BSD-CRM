import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

test("update token key falls back to a key derived from the service role key, never logged", () => {
  const src = readFileSync("supabase/functions/business-alert-signup/index.ts", "utf8");
  assert.match(src, /Deno\.env\.get\("UPDATE_TOKEN_SECRET"\)/);
  assert.match(src, /createHmac\("sha256", serviceRoleKey\)\.update\("bsd-update-token-v1"\)/);
  assert.doesNotMatch(src, /console\.[a-z]+\([^)]*(serviceRoleKey|derivedUpdateTokenKey)/);
});

test("every function import of copy/he.json resolves inside the repo", () => {
  for (const fn of ["business-alert-admin/index.ts", "business-alert-signup/email.mjs", "_shared/business-alert-mail.mjs"]) {
    const path = `supabase/functions/${fn}`;
    const m = readFileSync(path, "utf8").match(/from "([^"]*copy\/he\.json)"/);
    assert.ok(m, path);
    assert.ok(existsSync(resolve(dirname(path), m[1])), `${path} -> ${m[1]}`);
  }
});

test("signup logic imports Buffer explicitly (Deno has no global Buffer)", () => {
  const src = readFileSync("supabase/functions/business-alert-signup/logic.mjs", "utf8");
  if (/\bBuffer\./.test(src)) assert.match(src, /import \{ Buffer \} from "node:buffer";/);
});
