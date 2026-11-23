// «רשימת תפוצת עסקים» on every lead and buyer card.
(function () {
  const REASONS = {
    not_authenticated: "פג תוקף ההתחברות, יש להתחבר מחדש",
    session_expired: "פג תוקף ההתחברות, יש להתחבר מחדש",
    forbidden: "אין לך הרשאה לשלוח הזמנה. יש לפנות למנהל המערכת.",
    already_joined: "איש הקשר כבר רשום לרשימת התפוצה",
    already_subscribed: "איש הקשר כבר רשום לרשימת התפוצה",
    card: "כרטיס איש הקשר לא תקין. יש לסגור ולפתוח אותו מחדש.",
    not_found: "כרטיס איש הקשר לא נמצא. יש לרענן את הרשימה.",
    channel: "יש לבחור ערוץ שליחה: וואטסאפ או מייל.",
    method_not_allowed: "גרסת הדף אינה מעודכנת. יש לרענן את הדף.",
    save_failed: "לא ניתן לשמור את ההזמנה כרגע. יש לנסות שוב בעוד רגע.",
    network: "לא ניתן להתחבר לשרת. יש לבדוק חיבור לאינטרנט ולנסות שוב.",
    unknown: "אירעה שגיאה בשרת. יש לרענן את הדף ולנסות שוב.",
    do_not_call: "מסומן לא להתקשר. אי אפשר לשלוח הזמנה.",
    do_not_contact: "האדם הוסר מהרשימה או מסומן לא להתקשר.",
    no_phone: "אין טלפון בכרטיס, אי אפשר לפתוח וואטסאפ.",
    no_email: "אין אימייל בכרטיס, אי אפשר לשלוח מייל.",
    too_soon: "כבר נשלחה הזמנה לאיש קשר זה ב-24 השעות האחרונות",
    invite_limit: "כבר נשלחו 3 הזמנות לכרטיס הזה.",
    missing_email_configuration: "שליחת המייל לא מוגדרת.",
    send_failed: "המייל לא יצא. ההזמנה נשמרה כדי שלא תישלח פעמיים."
  };
  const FALLBACK = "שלום {שם} 😊\nתודה על השיחה!\nמוזמן/ת להצטרף לרשימת התפוצה האישית שלנו, ויישלחו אליך עסקים רלוונטיים להגדרות שלך:\n👉 {לינק}\nברוך איזון | BSD";
  const VIP_TITLE = "הזמנה לרישום VIP";
  const VIP_MESSAGE = "שלום {שם}, תודה על ההתעניינות! נשמח לצרף אותך לרשימת VIP של BSD ולעדכן אותך על עסקים למכירה שמתאימים לך. להצטרפות, ממלאים ומאשרים את הפרטים בטופס.";

  function fillName(template, name) {
    const who = String(name || "").trim();
    const text = String(template || FALLBACK);
    if (!who) return text.replaceAll("{שם}", "").replace(/שלום\s+😊/g, "שלום 😊").replace("שלום ,", "שלום,");
    return text.replaceAll("{שם}", who);
  }
  function applyAddress(text, form) {
    const raw = String(form || "").trim().toLowerCase();
    const word = raw === "m" || raw === "male" ? "מוזמן" : raw === "f" || raw === "female" ? "מוזמנת" : "מוזמן/ת";
    return String(text || "").replaceAll("מוזמן/ת", word);
  }
  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[character]));
  }
  function chip(invite) {
    const when = invite.sent_at ? new Date(invite.sent_at).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" }) : "";
    if (invite.status === "joined") return `הצטרף ✅${when ? " · " + when : ""}`;
    if (invite.status === "opened") return `נפתח${when ? " · " + when : ""}`;
    if (invite.status === "expired") return "פג תוקף";
    if (invite.status === "superseded") return "הוחלף";
    const channel = invite.channel === "whatsapp" ? "וואטסאפ" : "מייל";
    return `נשלח · ${channel}${when ? " · " + when : ""}`;
  }
  function reason(data) {
    const code = data?.error || "unknown";
    let message = REASONS[code] || REASONS.unknown;
    const sent = data?.last_sent_at || data?.invites?.[0]?.sent_at;
    if (code === "too_soon" && sent && Number.isFinite(Date.parse(sent))) {
      message += ` (נשלחה ב-${new Date(sent).toLocaleTimeString("he-IL", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit" })})`;
    }
    return message;
  }
  async function call(body) {
    try {
      const result = await window.supabaseClient.functions.invoke("business-alert-invite", { body });
      if (!result.error) return result.data || { ok: false, error: "unknown" };
      const context = result.error.context;
      const status = context?.status || result.error.status;
      let payload = {};
      if (context?.clone) payload = await context.clone().json().catch(() => ({}));
      if (status === 401) return { ok: false, error: "session_expired" };
      if (status === 403) return { ok: false, error: "forbidden" };
      if (payload.error && typeof payload.error === "string") return payload;
      return { ok: false, error: status ? "unknown" : "network" };
    } catch (_) { return { ok: false, error: "network" }; }
  }
  // The editable message is NOT a link preview. Show a real preview only after the
  // function returns its real link (never show the raw {לינק} placeholder).
  function editableCopy(text) {
    return String(text || "").replace(/^.*\{לינק\}.*(?:\n|$)/gm, "").trim();
  }
  function mountBusinessAlertInvite(lead) {
    const box = document.getElementById("businessAlertInvite");
    if (!box || !lead) return;
    const cardType = lead.type === "buyer" ? "buyer" : "lead";
    box.innerHTML = `<button type="button" id="inviteOpen" style="border:0;border-radius:16px;padding:12px 16px;font:inherit;font-weight:800;color:#fff;cursor:pointer;background:linear-gradient(135deg,#0e1b34,#1f7a4d);box-shadow:0 6px 0 rgba(8,16,32,.28);">רשימת תפוצת עסקים</button><div id="inviteChips" style="margin-top:8px;font-size:.82rem;"></div>`;
    const chips = document.getElementById("inviteChips");
    call({ action: "status", card_type: cardType, card_id: lead.id }).then(data => {
      if (!data.ok) { chips.textContent = reason(data); return; }
      chips.innerHTML = (data.invites || []).map(item => `<div>${esc(chip(item))}</div>`).join("") || "<span style=\"color:#888\">עדיין לא נשלחה הזמנה</span>";
    }).catch(() => { chips.textContent = ""; });
    document.getElementById("inviteOpen").onclick = () => openModal(lead, cardType);
  }
  function menuItem(id, profile) {
    if (!["admin", "manager", "agent_authorized"].includes(profile?.role)) return "";
    return `<a href="javascript:void(0)" onclick="openVipInviteFromRow(event, '${esc(id)}')" style="display:block;color:#fff;text-decoration:none;padding:11px 16px;font-size:.85rem;border-top:1px solid rgba(255,255,255,.08);">${VIP_TITLE}</a>`;
  }
  function openFromMenu(event, lead) {
    event.preventDefault();
    event.stopPropagation();
    const menu = event.currentTarget.closest(".bsd-forms-menu");
    if (menu) menu.style.display = "none";
    if (lead) openModal(lead, lead.type === "buyer" ? "buyer" : "lead", true);
  }
  function openModal(lead, cardType, vip = false) {
    const name = lead.first_name || (lead.full_name || "").split(/\s+/)[0] || "";
    const existing = document.getElementById("inviteModal");
    if (existing) existing.remove();
    const overlay = document.createElement("div");
    overlay.id = "inviteModal";
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(14,27,52,.55);z-index:80;display:flex;align-items:center;justify-content:center;padding:16px;";
    overlay.innerHTML = `<div dir="rtl" style="background:#fff;border-radius:18px;max-width:560px;width:100%;max-height:100%;overflow:auto;box-sizing:border-box;padding:18px;font-family:Heebo,Rubik,Arial,sans-serif;">
      <h3 style="margin:0 0 8px;">${vip ? VIP_TITLE : "רשימת תפוצת עסקים"}</h3>
      <div id="inviteHistory" style="font-size:.82rem;margin-bottom:8px;"></div>
      <label style="display:flex;gap:8px;align-items:center;"><input type="radio" name="inviteChannel" value="whatsapp" ${!vip || lead.phone || !lead.email ? "checked" : ""} style="width:auto;"> וואטסאפ</label>
      <label style="display:flex;gap:8px;align-items:center;"><input type="radio" name="inviteChannel" value="email" ${vip && !lead.phone && lead.email ? "checked" : ""} style="width:auto;"> מייל</label>
      <p style="font-size:.85rem">נוסח ההודעה לעריכה. קישור אישי יתווסף לאחר הכנת ההזמנה.</p>
      <textarea id="invitePreview" rows="${vip ? 5 : 8}" style="width:100%;box-sizing:border-box;margin-top:8px;border-radius:12px;padding:10px;font:inherit;"></textarea>
      <div id="inviteReady" hidden><p id="inviteRealPreview" style="white-space:pre-wrap;overflow-wrap:anywhere"></p><a id="inviteWhatsApp" target="_blank" rel="noopener" style="display:block;background:#128C4A;color:white;padding:14px;border-radius:12px;text-align:center;font-weight:bold">פתח וואטסאפ</a></div>
      <p id="inviteBlock" style="color:#8d2d2d;font-weight:700;"></p>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button type="button" id="inviteClose">סגירה</button>
        <button type="button" id="inviteSend" style="background:#0e1b34;color:#fff;border:0;border-radius:12px;padding:10px 14px;font-weight:800;">שלח</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    const preview = overlay.querySelector("#invitePreview");
    const template = vip ? VIP_MESSAGE : FALLBACK;
    const templates = { whatsapp: template, email: template };
    let addressForm = "";
    let auto = "";
    function channel() {
      return overlay.querySelector("input[name=inviteChannel]:checked").value;
    }
    function showTemplate() {
      const next = editableCopy(applyAddress(fillName(templates[channel()], name), addressForm));
      if (!preview.value || preview.value === auto) {
        preview.value = next;
        auto = next;
      }
    }
    showTemplate();
    const channels = overlay.querySelectorAll("input[name=inviteChannel]");
    overlay.querySelector("#inviteClose").onclick = () => overlay.remove();
    let statusError = null;
    let checking = true;
    let sending = false;
    call({ action: "status", card_type: cardType, card_id: lead.id }).then(data => {
      checking = false;
      if (!data.ok) { statusError = data; explain(); return; }
      if (!vip && data.templates?.whatsapp) templates.whatsapp = data.templates.whatsapp;
      if (!vip && data.templates?.email) templates.email = data.templates.email;
      addressForm = data.address_form || "";
      showTemplate();
      overlay.querySelector("#inviteHistory").innerHTML = (data.invites || []).map(item => `<div>${esc(chip(item))}</div>`).join("");
      explain();
    });
    function explain() {
      const note = overlay.querySelector("#inviteBlock");
      const send = overlay.querySelector("#inviteSend");
      if (vip) send.textContent = channel() === "whatsapp" ? "פתח וואטסאפ" : "שלח במייל";
      if (checking || sending) { send.disabled = true; return; }
      if (statusError) { note.textContent = reason(statusError); send.disabled = true; return; }
      if (channel() === "whatsapp" && !String(lead.phone || "").replace(/\D/g, "")) {
        note.textContent = REASONS.no_phone;
        send.disabled = true;
        return;
      }
      if (channel() === "email" && !String(lead.email || "").includes("@")) {
        note.textContent = REASONS.no_email;
        send.disabled = true;
        return;
      }
      note.textContent = "";
      send.disabled = false;
    }
    channels.forEach(input => input.addEventListener("change", () => {
      showTemplate();
      explain();
    }));
    explain();
    overlay.querySelector("#inviteSend").onclick = async () => {
      const send = overlay.querySelector("#inviteSend");
      const isWhatsApp = channel() === "whatsapp";
      const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
      // Desktop popup must be created in the click stack, not after an await.
      const popup = isWhatsApp && !isMobile ? window.open("about:blank", "_blank") : null;
      if (popup) popup.opener = null;
      sending = true;
      send.disabled = true;
      channels.forEach(input => { input.disabled = true; });
      const data = await call({ card_type: cardType, card_id: lead.id, channel: channel(), message: preview.value.replace(/(\nברוך איזון \| BSD\s*)$/, "\n👉 {לינק}$1") });
      sending = false;
      if (!data.ok) {
        channels.forEach(input => { input.disabled = false; });
        if (popup) popup.close();
        overlay.querySelector("#inviteBlock").textContent = reason(data);
        send.disabled = ["network", "unknown", "save_failed", "send_failed"].includes(data.error) ? false : true;
        return;
      }
      if (data.wa_url && /^https:\/\/wa\.me\/\d+\?text=/.test(data.wa_url)) {
        // Always leave a tappable real link, including when the app is unavailable.
        const link = overlay.querySelector("#inviteWhatsApp");
        link.href = data.wa_url;
        overlay.querySelector("#inviteRealPreview").textContent = data.message || decodeURIComponent(data.wa_url.split("text=")[1] || "");
        overlay.querySelector("#inviteReady").hidden = false;
        preview.hidden = true;
        send.hidden = true;
        overlay.querySelector("#inviteBlock").textContent = "הקישור מוכן. אם וואטסאפ לא נפתח, לחץ/י על «פתח וואטסאפ».";
        mountBusinessAlertInvite(lead);
        if (isMobile) window.location.href = data.wa_url;
        else if (popup) popup.location.href = data.wa_url;
        return;
      }
      if (popup) popup.close();
      if (data.sent) {
        overlay.querySelector("#inviteBlock").textContent = "ההזמנה נשלחה במייל בהצלחה.";
        send.hidden = true;
        mountBusinessAlertInvite(lead);
      } else {
        channels.forEach(input => { input.disabled = false; });
        overlay.querySelector("#inviteBlock").textContent = REASONS.unknown;
        send.disabled = false;
      }
    };
  }
  window.mountBusinessAlertInvite = mountBusinessAlertInvite;
  window.BSDBusinessAlertInvite = { menuItem, openFromMenu };
})();
