import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { listBusinessFiles, reviewBusinessSources } from '../supabase/functions/_shared/business-sources.ts';

test('reads paginated nested reports and refuses to issue a draft when one file is unreadable', async () => {
  const originalFetch = globalThis.fetch;
  const originalDeno = globalThis.Deno;
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  globalThis.Deno = { env: { get: () => JSON.stringify({ client_email: 'reader@example.org', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }) } };
  const seen = [];
  globalThis.fetch = async input => {
    const url = new URL(input);
    if (url.hostname === 'oauth2.googleapis.com') return Response.json({ access_token: 'test' });
    if (url.pathname.endsWith('/files')) {
      if (url.searchParams.get('q').includes("'root'")) {
        return Response.json(url.searchParams.has('pageToken')
          ? { files: [{ id: 'child', name: 'דוחות', mimeType: 'application/vnd.google-apps.folder' }] }
          : { files: [{ id: 'a', name: 'חוזה.pdf', mimeType: 'application/pdf' }], nextPageToken: 'page2' });
      }
      return Response.json({ files: [{ id: 'b', name: 'דוח כספי.pdf', mimeType: 'application/pdf' }] });
    }
    if (url.pathname.includes('/files/')) {
      const id = url.pathname.split('/').at(-1);
      seen.push(id);
      return id === 'b' ? new Response('broken', { status: 403 }) : new Response('%PDF-1.4');
    }
    if (url.hostname === 'api.anthropic.com') return Response.json({ content: [{ type: 'text', text: 'המסמך נקרא בשלמותו' }], stop_reason: 'end_turn' });
    throw Error(`Unexpected URL ${url}`);
  };
  try {
    const files = await listBusinessFiles('https://drive.google.com/drive/folders/root', 'test');
    assert.deepEqual(files.map(f => f.id), ['b', 'a']);
    await assert.rejects(reviewBusinessSources({ drive_folder_url: 'https://drive.google.com/drive/folders/root' }, 'test'), /לא ניתן לקרוא/);
    assert.deepEqual(seen, ['b']);
  } finally { globalThis.fetch = originalFetch; globalThis.Deno = originalDeno; }
});

test('refuses unsupported documents instead of silently skipping them', async () => {
  const originalFetch = globalThis.fetch;
  const originalDeno = globalThis.Deno;
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  globalThis.Deno = { env: { get: () => JSON.stringify({ client_email: 'reader@example.org', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }) } };
  globalThis.fetch = async input => {
    const url = new URL(input);
    if (url.hostname === 'oauth2.googleapis.com') return Response.json({ access_token: 'test' });
    if (url.pathname.endsWith('/files')) return Response.json({ files: [{ id: 'xlsx', name: 'דוח 2025.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }] });
    throw Error('The unsupported file must never be silently downloaded or summarized');
  };
  try {
    await assert.rejects(reviewBusinessSources({ drive_folder_url: 'https://drive.google.com/drive/folders/root' }, 'test'), /פורמט שאינו נתמך/);
  } finally { globalThis.fetch = originalFetch; globalThis.Deno = originalDeno; }
});
