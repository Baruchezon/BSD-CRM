// «מה עשינו לאחרונה לקידום מכירת העסק שלך?» (staging, 20.10.2026).
// Pure function. Every entry is derived from a record that already exists and is already
// scoped to the owner's business: owner-visible match activity, materials actually sent
// (anonymous / full, with date), signed agreements (with date), owner-visible proactive-outreach
// events and published marketing reports. No synthetic events; undated records are skipped.
const t = (v: unknown) => Date.parse(String(v ?? '')) || 0;
const clean = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
type Item = {date: string; type: string; title: string; text: string};
export function buildTimeline(i: {cards: any[]; outreach: any[]; reports: any[]}, limit = 60): Item[] {
  const out: Item[] = [];
  const seen = new Set<string>();
  const add = (date: unknown, type: string, title: string, text = '') => {
    if (!t(date)) return;
    const key = [String(date).slice(0, 10), type, title, text].join('|');
    if (seen.has(key)) return; seen.add(key);
    out.push({date: new Date(t(date)).toISOString(), type, title: clean(title, 160), text: clean(text, 400)});
  };
  for (const c of i.cards || []) {
    for (const x of c.contacts || []) {
      const type = x.type === 'שיחה' ? 'שיחה' : /תקציר|מידע|נשלח/.test(x.type) ? 'שליחת מידע' : 'עדכון';
      add(x.date, type, `${type === 'שיחה' ? 'שיחה עם' : 'עדכון לגבי'} ${c.buyer}`, x.topic || x.response);
      if (x.follow_up) add(x.date, 'מעקב', `נקבע מעקב עם ${c.buyer}`, `מועד מעקב: ${x.follow_up.split('-').reverse().join('.')}`);
    }
    for (const m of c.materials?.items || []) add(m.date, 'שליחת מידע', `${c.materials.level === 'full' ? 'נשלחו חומרים מלאים' : 'נשלח מידע'} — ${c.buyer}`, m.label);
    if (c.agreement?.key === 'signed' && c.agreement.date) add(c.agreement.date, 'חתימה', `${c.buyer} חתם על הסכם סודיות ותיווך`);
  }
  for (const r of i.outreach || []) for (const n of r.notes || []) add(n.date, 'פנייה יזומה', `פנייה יזומה: ${r.contact_name}`, [n.stage, n.text].filter(Boolean).join(' — '));
  for (const f of i.reports || []) add(f.date, 'דוח שיווק', 'דוח פעילות שיווקית חדש זמין', f.name);
  return out.sort((a, b) => t(b.date) - t(a.date)).slice(0, limit);
}
