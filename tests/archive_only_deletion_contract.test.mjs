import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const businesses = readFileSync(new URL('../businesses.html', import.meta.url), 'utf8');
const leads = readFileSync(new URL('../leads.html', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../migrations/2026-09-17b_archive_only_deletion.sql', import.meta.url), 'utf8');

assert.doesNotMatch(businesses, /onclick="deleteBiz\('\$\{b\.id\}'\)"[^>]*>🗑️ מחק<\/a>/);
assert.doesNotMatch(leads, /onclick="deleteLead\('\$\{l\.id\}'\)"[^>]*>🗑️ מחק<\/a>/);
assert.match(businesses, /ALL_BIZ\.find\(b=>b\.id===id\) \|\| ARCHIVED_BIZ\.find/);
assert.match(leads, /ALL_LEADS\.find\(l=>l\.id===id\) \|\| ARCHIVED_LEADS\.find/);
assert.match(businesses, /מחיקה סופית אפשרית רק מתוך הארכיון/);
assert.match(leads, /מחיקה סופית אפשרית רק מתוך הארכיון/);
assert.match(migration, /is_archived = true[\s\S]*for delete to authenticated/);
assert.match(migration, /listing_status, 'active'\) in \('removed','sold'\)/);

console.log('Archive only deletion contract passed');
