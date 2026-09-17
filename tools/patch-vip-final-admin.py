from pathlib import Path


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f"Expected block not found: {label}")
    return text.replace(old, new, 1)

# Edge Function: admin alert for interest, richer session and document audit data
p = Path('supabase/functions/vip-api/index.ts')
s = p.read_text()
s = replace_once(s,
'''  if (interested) {
    const { data: existing } = await supabase
      .from("matches")
      .select("id")
      .eq("buyer_id", auth.account.buyer_id)
      .eq("business_id", businessId)
      .maybeSingle();
    if (!existing) {
      await supabase.from("matches").insert({
        buyer_id: auth.account.buyer_id,
        business_id: businessId,
        status: "מתעניין",
        buyer_response: "מעניין אותי דרך אזור BSD VIP",
        match_source: "BSD VIP",
        disclosure_level: 1,
        last_action: "סימון מעניין אותי באזור VIP",
        last_action_at: new Date().toISOString()
      });
    }
  }
  return reply(req, 200, { ok: true, interested });''',
'''  if (interested) {
    const { data: existing } = await supabase
      .from("matches")
      .select("id")
      .eq("buyer_id", auth.account.buyer_id)
      .eq("business_id", businessId)
      .maybeSingle();
    let matchId = existing?.id || null;
    if (!existing) {
      const created = await supabase.from("matches").insert({
        buyer_id: auth.account.buyer_id,
        business_id: businessId,
        status: "מתעניין",
        buyer_response: "מעניין אותי דרך אזור BSD VIP",
        match_source: "BSD VIP",
        disclosure_level: 1,
        last_action: "סימון מעניין אותי באזור VIP",
        last_action_at: new Date().toISOString()
      }).select("id").single();
      matchId = created.data?.id || null;
    }

    const { data: buyer } = await supabase
      .from("leads")
      .select("handled_by,created_by")
      .eq("id", auth.account.buyer_id)
      .maybeSingle();
    const dedupeKey = `vip-interest:${auth.account.buyer_id}:${businessId}`;
    const { data: existingTask } = await supabase
      .from("tasks")
      .select("id,status")
      .eq("dedupe_key", dedupeKey)
      .neq("status", "הושלמה")
      .maybeSingle();
    if (!existingTask) {
      await supabase.from("tasks").insert({
        title: "לקוח VIP סימן עסק כמעניין",
        description: "לקוח VIP סימן את העסק כמעניין באזור הלקוחות.",
        related_type: "buyer",
        related_id: auth.account.buyer_id,
        buyer_id: auth.account.buyer_id,
        business_id: businessId,
        match_id: matchId,
        assigned_to: buyer?.handled_by || buyer?.created_by || null,
        due_date: new Date().toISOString().slice(0, 10),
        priority: "רגילה",
        source: "vip",
        dedupe_key: dedupeKey
      });
    }
  }
  return reply(req, 200, { ok: true, interested });''',
'interest alert task')

s = replace_once(s,
'''  const { data: sessions } = accountIds.length ? await supabase
    .from("vip_sessions")
    .select("vip_account_id,active_seconds")
    .in("vip_account_id", accountIds) : { data: [] as any[] };
  const activityBusinessIds = [...new Set((events || []).map((e: any) => e.business_id).filter(Boolean))];''',
'''  const { data: sessions } = accountIds.length ? await supabase
    .from("vip_sessions")
    .select("id,vip_account_id,created_at,last_activity_at,expires_at,revoked_at,active_seconds")
    .in("vip_account_id", accountIds)
    .order("created_at", { ascending: false })
    .limit(1000) : { data: [] as any[] };
  const activityBusinessIds = [...new Set((events || []).map((e: any) => e.business_id).filter(Boolean))];''',
'session details')

s = replace_once(s,
'''  const activityBusinessMap = new Map((activityBusinesses || []).map((b: any) => [b.id, b.anon_display_name || b.anonymous_name || b.business_number || "עסק"]));

  const eventMap = new Map<string, any[]>();''',
'''  const activityBusinessMap = new Map((activityBusinesses || []).map((b: any) => [b.id, b.anon_display_name || b.anonymous_name || b.business_number || "עסק"]));
  const activityFileIds = [...new Set((events || []).map((e: any) => e.file_id).filter(Boolean))];
  const { data: activityFiles } = activityFileIds.length ? await supabase
    .from("business_sale_files")
    .select("id,file_name,document_type")
    .in("id", activityFileIds) : { data: [] as any[] };
  const activityFileMap = new Map((activityFiles || []).map((f: any) => [f.id, f.file_name || f.document_type || "מסמך אנונימי"]));

  const eventMap = new Map<string, any[]>();''',
'file labels')

s = replace_once(s,
'''  const activeSeconds = new Map<string, number>();
  for (const sess of sessions || []) activeSeconds.set(sess.vip_account_id, (activeSeconds.get(sess.vip_account_id) || 0) + Number(sess.active_seconds || 0));
  const inquiryMap = new Map<string, any[]>();''',
'''  const activeSeconds = new Map<string, number>();
  const sessionMap = new Map<string, any[]>();
  for (const sess of sessions || []) {
    activeSeconds.set(sess.vip_account_id, (activeSeconds.get(sess.vip_account_id) || 0) + Number(sess.active_seconds || 0));
    if (!sessionMap.has(sess.vip_account_id)) sessionMap.set(sess.vip_account_id, []);
    sessionMap.get(sess.vip_account_id)!.push(sess);
  }
  const inquiryMap = new Map<string, any[]>();''',
'session map')

s = replace_once(s,
'''      recent_activity: ev.slice(0, 20).map((x: any) => ({ ...x, business_label: x.business_id ? activityBusinessMap.get(x.business_id) || null : null })),
      recent_inquiries: (inquiryMap.get(a.id) || []).slice(0, 10)''',
'''      recent_activity: ev.slice(0, 20).map((x: any) => ({
        ...x,
        business_label: x.business_id ? activityBusinessMap.get(x.business_id) || null : null,
        file_label: x.file_id ? activityFileMap.get(x.file_id) || null : null
      })),
      recent_sessions: (sessionMap.get(a.id) || []).slice(0, 10),
      recent_inquiries: (inquiryMap.get(a.id) || []).slice(0, 10)''',
'activity and sessions result')
p.write_text(s)

# Admin UI: document names, session entry exit info, WhatsApp after reset
p = Path('vip-admin.html')
s = p.read_text()
s = replace_once(s,
'''const act=(r.recent_activity||[]).slice(0,6).map(a=>`<div>${eventName(a.event_type)}${a.business_label?' · '+esc(a.business_label):''} · ${fmt(a.created_at)}</div>`).join('')||'<span class="muted">אין פעילות</span>';''',
'''const act=(r.recent_activity||[]).slice(0,6).map(a=>`<div>${eventName(a.event_type)}${a.business_label?' · '+esc(a.business_label):''}${a.file_label?' · '+esc(a.file_label):''} · ${fmt(a.created_at)}</div>`).join('')||'<span class="muted">אין פעילות</span>';const sessions=(r.recent_sessions||[]).slice(0,2).map(x=>`<div style="margin-top:4px;font-size:.7rem;color:#657086">כניסה ${fmt(x.created_at)}<br>פעילות אחרונה ${fmt(x.last_activity_at)} · ${fmtDuration(x.active_seconds||0)}</div>`).join('');''',
'admin activity labels')
s = replace_once(s,
'''<td><div class="activity">${act}</div></td><td><div class="actions">''',
'''<td><div class="activity">${act}${sessions}</div></td><td><div class="actions">''',
'admin sessions display')
s = replace_once(s,
'''async function resetPwd(id){try{const d=await adminApi('admin_account_action',{account_id:id,account_action:'reset_password'});openInfo('סיסמה זמנית חדשה',`<p><b>שם משתמש:</b> ${esc(d.username)}</p><p><b>סיסמה זמנית:</b> <span style="font-family:monospace;font-size:1.1rem">${esc(d.temporary_password)}</span></p><p class="muted">הסיסמה אינה נשמרת כטקסט גלוי.</p>`)}catch(e){toast(e.message)}}''',
'''async function resetPwd(id){try{const d=await adminApi('admin_account_action',{account_id:id,account_action:'reset_password'});const row=rows.find(x=>x.id===id)||{};const b=row.buyer||{};const phone=String(b.phone||'').replace(/\\D/g,'');const waPhone=phone.startsWith('0')?'972'+phone.slice(1):phone;const msg=`שלום ${b.full_name||''},\\n\\nלבקשתך הופקה סיסמה זמנית חדשה לאזור לקוחות VIP של BSD.\\n\\nכניסה: https://www.bsd-bbi.co.il/vip/\\nשם משתמש: ${d.username}\\nסיסמה זמנית: ${d.temporary_password}\\n\\nלאחר הכניסה ניתן לשנות את הסיסמה.`;const wa=waPhone?`<p><a href="https://wa.me/${esc(waPhone)}?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener" style="display:inline-block;background:#1f9d55;color:#fff;text-decoration:none;border-radius:8px;padding:9px 13px;font-weight:800;">שלח ב WhatsApp</a></p>`:'';openInfo('סיסמה זמנית חדשה',`<p><b>שם משתמש:</b> ${esc(d.username)}</p><p><b>סיסמה זמנית:</b> <span style="font-family:monospace;font-size:1.1rem">${esc(d.temporary_password)}</span></p>${wa}<p class="muted">הסיסמה אינה נשמרת כטקסט גלוי.</p>`)}catch(e){toast(e.message)}}''',
'admin reset whatsapp')
p.write_text(s)
