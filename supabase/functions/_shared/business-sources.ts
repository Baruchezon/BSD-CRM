// Source review for business documents. A draft fails closed if Drive cannot be
// listed completely, or if even one file cannot be read. No document is skipped.
type DriveFile = { id: string; name: string; mimeType: string; size?: string; webViewLink?: string };
type Credentials = { client_email: string; private_key: string; token_uri?: string };

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function bytesBase64(bytes: Uint8Array): string {
  let value = '';
  for (let i = 0; i < bytes.length; i += 8192) value += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(value);
}
async function driveToken(): Promise<string> {
  const raw = Deno.env.get('GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON');
  if (!raw) throw new Error('חיבור Google Drive של ה CRM לא הוגדר. לא ניתן לאמת את מסמכי העסק.');
  const cred = JSON.parse(raw) as Credentials;
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claims = base64url(new TextEncoder().encode(JSON.stringify({ iss: cred.client_email, scope: 'https://www.googleapis.com/auth/drive.readonly', aud: cred.token_uri || 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3500 })));
  const keyBytes = Uint8Array.from(atob(cred.private_key.replace(/-----[^-]+-----|\s/g, '')), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', keyBytes, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${claims}`)));
  const response = await fetch(cred.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${header}.${claims}.${base64url(signature)}` }),
  });
  if (!response.ok) throw new Error(`Google Drive authentication failed (${response.status})`);
  return (await response.json()).access_token;
}
async function driveGet(url: URL, token: string): Promise<Response> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`לא ניתן לקרוא מסמך או תיקייה ב Google Drive (${res.status})`);
  return res;
}
function folderId(url: string): string {
  const match = url.match(/drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/([\w-]+)/);
  if (!match) throw new Error('נדרש קישור לתיקיית Google Drive של העסק בכרטיס העסק.');
  return match[1];
}
export async function listBusinessFiles(folderUrl: string, token: string): Promise<DriveFile[]> {
  const pending = [folderId(folderUrl)];
  const visited = new Set<string>();
  const files: DriveFile[] = [];
  while (pending.length) {
    const parent = pending.shift()!;
    if (visited.has(parent)) continue;
    visited.add(parent);
    let pageToken = '';
    do {
      const url = new URL('https://www.googleapis.com/drive/v3/files');
      url.searchParams.set('q', `'${parent}' in parents and trashed = false`);
      url.searchParams.set('fields', 'nextPageToken,files(id,name,mimeType,size,webViewLink)');
      url.searchParams.set('pageSize', '1000');
      url.searchParams.set('supportsAllDrives', 'true');
      url.searchParams.set('includeItemsFromAllDrives', 'true');
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const listing = await (await driveGet(url, token)).json();
      for (const file of listing.files || [] as DriveFile[]) {
        if (file.mimeType === 'application/vnd.google-apps.folder') pending.push(file.id);
        else files.push(file);
        if (files.length > 60 || pending.length > 100) throw new Error('תיקיית העסק גדולה מדי לניתוח אחד. נדרש טיפול מדורג לפני הפקת מסמך.');
      }
      pageToken = listing.nextPageToken || '';
    } while (pageToken);
  }
  return files.sort((a, b) => a.name.localeCompare(b.name, 'he'));
}
async function readDriveFile(file: DriveFile, token: string): Promise<{ mime: string; bytes: Uint8Array }> {
  const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}`);
  let mime = file.mimeType;
  if (mime === 'application/vnd.google-apps.document') {
    url.pathname += '/export'; url.searchParams.set('mimeType', 'text/plain'); mime = 'text/plain';
  } else if (mime === 'application/vnd.google-apps.spreadsheet' || mime === 'application/vnd.google-apps.presentation') {
    url.pathname += '/export'; url.searchParams.set('mimeType', 'application/pdf'); mime = 'application/pdf';
  } else url.searchParams.set('alt', 'media');
  if (!['application/pdf', 'text/plain', 'text/csv', 'image/png', 'image/jpeg'].includes(mime)) {
    throw new Error(`הקובץ ${file.name} בפורמט שאינו נתמך. נדרש לקרוא אותו לפני הפקת מסמך.`);
  }
  if (Number(file.size || 0) > 12_000_000) throw new Error(`הקובץ ${file.name} גדול מדי לבדיקה מלאה.`);
  const response = await driveGet(url, token);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length || bytes.length > 12_000_000) throw new Error(`לא ניתן לקרוא את כל תוכן הקובץ ${file.name}.`);
  return { mime, bytes };
}
async function analyzeFile(file: DriveFile, token: string, aiKey: string): Promise<string> {
  const { mime, bytes } = await readDriveFile(file, token);
  const content = mime.startsWith('text/')
    ? { type: 'text', text: new TextDecoder().decode(bytes) }
    : { type: mime === 'application/pdf' ? 'document' : 'image', source: { type: 'base64', media_type: mime, data: bytesBase64(bytes) } };
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'x-api-key': aiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-sonnet-5', max_tokens: 2300,
      system: 'Read EVERY page/sheet. Extract all material business facts and financial figures with exact reporting year or interim end date, units, accounting line item, document status and page. Separate audited annual statements from unaudited interim reports. Do not infer EBITDA from net profit or annualize interim results. If content cannot be fully read, reply only UNREADABLE.',
      messages: [{ role: 'user', content: [content, { type: 'text', text: `Source filename: ${file.name}. Summarize its relevant facts in Hebrew, with page and year citations. If this is an invoice or old generated summary, distinguish it from financial statements.` }] }],
    }),
  });
  if (!response.ok) throw new Error(`ניתוח המסמך ${file.name} נכשל (${response.status})`);
  const result = await response.json();
  const extracted = (result.content || []).filter((part: { type: string }) => part.type === 'text').map((part: { text: string }) => part.text).join('\n');
  if (!extracted || extracted.includes('UNREADABLE') || result.stop_reason === 'max_tokens') throw new Error(`לא ניתן לקרוא את כל המסמך ${file.name}. לא יופק תקציר חסר.`);
  return `[${file.name}; ${file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`}]\n${extracted}`;
}
export async function reviewBusinessSources(biz: Record<string, unknown>, aiKey: string): Promise<{ context: string; files: DriveFile[] }> {
  const token = await driveToken();
  const files = await listBusinessFiles(String(biz.drive_folder_url || ''), token);
  if (!files.length) throw new Error('תיקיית העסק בגוגל דרייב ריקה או שאין אליה הרשאת קריאה.');
  const findings: string[] = [];
  for (const file of files) findings.push(await analyzeFile(file, token, aiKey));
  let website = '';
  if (biz.website) {
    const url = new URL(String(biz.website));
    if (url.protocol !== 'https:' || !url.hostname.includes('.') || url.port || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[)/.test(url.hostname)) throw new Error('כתובת אתר העסק אינה בטוחה לקריאה.');
    const addresses = await Promise.all([Deno.resolveDns(url.hostname, 'A'), Deno.resolveDns(url.hostname, 'AAAA')]);
    const publicIpv4 = (address: string) => {
      const parts = address.split('.').map(Number);
      return parts.length === 4 && parts[0] > 0 && parts[0] < 224 && parts[0] !== 10 && parts[0] !== 127
        && !(parts[0] === 169 && parts[1] === 254) && !(parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
        && !(parts[0] === 192 && parts[1] === 168) && !(parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127);
    };
    if (addresses.flat().length === 0 || addresses[0].some(address => !publicIpv4(address)) || addresses[1].some(address => /^(::|fc|fd|fe80)/i.test(address))) throw new Error('כתובת אתר העסק אינה ציבורית.');
    const page = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(8000) });
    if (!page.ok) throw new Error(`אתר העסק לא נטען (${page.status}).`);
    website = (await page.text()).replace(/<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').slice(0, 12000);
  }
  return { files, context: `${findings.join('\n\n')}\n\nאתר העסק (${biz.website || 'לא צוין'}): ${website || 'לא צוין'}` };
}
