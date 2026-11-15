// «רשימת תפוצת עסקים» on every lead and buyer card.
(function () {
  const REASONS = {
    do_not_call: "מסומן לא להתקשר. אי אפשר לשלוח הזמנה.",
    do_not_contact: "האדם הוסר מהרשימה או מסומן לא להתקשר.",
    no_phone: "אין טלפון בכרטיס, אי אפשר לפתוח וואטסאפ.",
    no_email: "אין אימייל בכרטיס, אי אפשר לשלוח מייל.",
    too_soon: "אפשר לשלוח שוב רק אחרי 24 שעות.",
    invite_limit: "כבר נשלחו 3 הזמנות לכרטיס הזה.",
    missing_email_configuration: "שליחת המייל לא מוגדרת.",
    send_failed: "המייל לא יצא. ההזמנה נשמרה כדי שלא תישלח פעמיים.",
    already_subscribed: "האדם כבר ברשימת התפוצה.",
    already_joined: "האדם כבר הצטרף מההזמנה.",
    not_authenticated: "צריך להתחבר מחדש.",
    forbidden: "אין הרשאה לשלוח הזמנה.",
    save_failed: "השמירה נכשלה. נסה שוב.",
    not_found: "הכרטיס לא נמצא.",
    card: "הכרטיס לא תקין.",
    channel: "צריך לבחור וואטסאפ או מייל."
  };
  const LINK_MARK = "{לינק}";
  const LINK_SHOWN = "הקישור האישי";
  const FALLBACK = "שלום {שם} 😊\nתודה על השיחה!\nמוזמן/ת להצטרף לרשימת התפוצה האישית שלנו, ויישלחו אליך עסקים רלוונטיים להגדרות שלך:\n👉 {לינק}\nברוך איזון | BSD";
  function fillName(template, name) {
    const who = String(name || "").trim();
    const text = String(template || FALLBACK);
    if (!who) return text.replaceAll("{שם}", "").replace(/שלום\s+😊/g, "שלום 😊");
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
  function reason(code) {
    return REASONS[code] || "אי אפשר לשלוח עכשיו.";
  }
  async function call(body) {
    const result = await window.supabaseClient.functions.invoke("business-alert-invite", { body });
    if (!result.error) return result.data || {};
    let payload = null;
    try {
      if (result.error.context && typeof result.error.context.json === "function") payload = await result.error.context.json();
    } catch (ignore) { payload = null; }
    if (payload && payload.error) return payload;
    return { ok: false, error: "save_failed" };
  }
  function openWa(url, tab) {
    if (tab && !tab.closed) {
      tab.location.href = url;
      return;
    }
    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }
  function mountBusinessAlertInvite(lead) {
    const box = document.getElementById("businessAlertInvite");
    if (!box || !lead) return;
    const cardType = lead.type === "buyer" ? "buyer" : "lead";
    box.innerHTML = `<button type="button" id="inviteOpen" style="border:0;border-radius:16px;padding:12px 16px;font:inherit;font-weight:800;color:#fff;cursor:pointer;background:linear-gradient(135deg,#0e1b34,#1f7a4d);box-shadow:0 6px 0 rgba(8,16,32,.28);">רשימת תפוצת עסקים</button><div id="inviteChips" style="margin-top:8px;font-size:.82rem;"></div>`;
    const chips = document.getElementById("inviteChips");
    call({ action: "status", card_type: cardType, card_id: lead.id }).then(data => {
      chips.innerHTML = (data.invites || []).map(item => `<div>${esc(chip(item))}</div>`).join("") || "<span style=\"color:#888\">עדיין לא נשלחה הזמנה</span>";
    }).catch(() => { chips.textContent = ""; });
    document.getElementById("inviteOpen").onclick = () => openModal(lead, cardType);
  }
  function openModal(lead, cardType) {
    const name = lead.first_name || (lead.full_name || "").split(/\s+/)[0] || "";
    const existing = document.getElementById("inviteModal");
    if (existing) existing.remove();
    const overlay = document.createElement("div");
    overlay.id = "inviteModal";
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(14,27,52,.55);z-index:80;display:flex;align-items:center;justify-content:center;padding:16px;";
    overlay.innerHTML = `<div dir="rtl" style="background:#fff;border-radius:18px;max-width:560px;width:100%;padding:18px;font-family:Heebo,Rubik,Arial,sans-serif;">
      <h3 style="margin:0 0 8px;">רשימת תפוצת עסקים</h3>
      <div id="inviteHistory" style="font-size:.82rem;margin-bottom:8px;"></div>
      <label style="display:flex;gap:8px;align-items:center;"><input type="radio" name="inviteChannel" value="whatsapp" checked style="width:auto;"> וואטסאפ</label>
      <label style="display:flex;gap:8px;align-items:center;"><input type="radio" name="inviteChannel" value="email" style="width:auto;"> מייל</label>
      <textarea id="invitePreview" rows="8" style="width:100%;box-sizing:border-box;margin-top:8px;border-radius:12px;padding:10px;font:inherit;"></textarea>
      <p id="inviteBlock" style="color:#8d2d2d;font-weight:700;"></p>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button type="button" id="inviteClose">סגירה</button>
        <button type="button" id="inviteSend" style="background:#0e1b34;color:#fff;border:0;border-radius:12px;padding:10px 14px;font-weight:800;">שלח</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    const preview = overlay.querySelector("#invitePreview");
    const templates = { whatsapp: FALLBACK, email: FALLBACK };
    let addressForm = "";
    let auto = "";
    function channel() {
      return overlay.querySelector("input[name=inviteChannel]:checked").value;
    }
    function showTemplate() {
      const next = applyAddress(fillName(templates[channel()] || FALLBACK, name), addressForm).replaceAll(LINK_MARK, LINK_SHOWN);
      if (!preview.value || preview.value === auto) {
        preview.value = next;
        auto = next;
      }
    }
    showTemplate();
    overlay.querySelector("#inviteClose").onclick = () => overlay.remove();
    call({ action: "status", card_type: cardType, card_id: lead.id }).then(data => {
      if (data.templates?.whatsapp) templates.whatsapp = data.templates.whatsapp;
      if (data.templates?.email) templates.email = data.templates.email;
      addressForm = data.address_form || "";
      showTemplate();
      overlay.querySelector("#inviteHistory").innerHTML = (data.invites || []).map(item => `<div>${esc(chip(item))}</div>`).join("");
    }).catch(() => {});
    function explain() {
      const note = overlay.querySelector("#inviteBlock");
      const send = overlay.querySelector("#inviteSend");
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
    overlay.querySelectorAll("input[name=inviteChannel]").forEach(input => input.addEventListener("change", () => {
      showTemplate();
      explain();
    }));
    explain();
    overlay.querySelector("#inviteSend").onclick = async () => {
      const send = overlay.querySelector("#inviteSend");
      const waTab = channel() === "whatsapp" ? window.open("", "_blank") : null;
      send.disabled = true;
      try {
        const data = await call({
          card_type: cardType,
          card_id: lead.id,
          channel: channel(),
          message: preview.value.replaceAll(LINK_SHOWN, LINK_MARK)
        });
        if (!data.ok) {
          if (waTab && !waTab.closed) waTab.close();
          overlay.querySelector("#inviteBlock").textContent = reason(data.error);
          send.disabled = true;
          return;
        }
        if (data.wa_url) openWa(data.wa_url, waTab);
        else if (waTab && !waTab.closed) waTab.close();
        overlay.remove();
        mountBusinessAlertInvite(lead);
      } catch (error) {
        if (waTab && !waTab.closed) waTab.close();
        overlay.querySelector("#inviteBlock").textContent = "השליחה לא הושלמה.";
        send.disabled = false;
      }
    };
  }
  window.mountBusinessAlertInvite = mountBusinessAlertInvite;
})();
