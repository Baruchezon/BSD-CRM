from pathlib import Path

p = Path('vip-admin.html')
s = p.read_text()

def once(old, new, label):
    global s
    if old not in s:
        raise SystemExit(f'Expected block not found: {label}')
    s = s.replace(old, new, 1)

once(
"const fmt=v=>v?new Date(v).toLocaleString('he-IL'):'—';",
"const fmt=v=>v?new Date(v).toLocaleString('he-IL'):'—';\nconst fmtDuration=s=>{s=Math.max(0,Number(s)||0);const h=Math.floor(s/3600),m=Math.floor((s%3600)/60);return h?`${h} ש׳ ${m} דק׳`:`${m} דק׳`};",
'format duration')
once(
"<th>כניסה אחרונה</th><th>צפיות</th>",
"<th>כניסה אחרונה</th><th>זמן באתר</th><th>צפיות</th>",
'active time header')
once(
"<td>${fmt(r.last_login_at)}</td><td>${r.stats?.business_views||0}</td>",
"<td>${fmt(r.last_login_at)}</td><td><b>${fmtDuration(r.stats?.active_seconds||0)}</b></td><td>${r.stats?.business_views||0}</td>",
'active time cell')
once(
"const act=(r.recent_activity||[]).slice(0,4).map(a=>`<div>${eventName(a.event_type)} · ${fmt(a.created_at)}</div>`).join('')||'<span class=\"muted\">אין פעילות</span>';",
"const act=(r.recent_activity||[]).slice(0,6).map(a=>`<div>${eventName(a.event_type)}${a.business_label?' · '+esc(a.business_label):''} · ${fmt(a.created_at)}</div>`).join('')||'<span class=\"muted\">אין פעילות</span>';",
'activity business labels')
p.write_text(s)
