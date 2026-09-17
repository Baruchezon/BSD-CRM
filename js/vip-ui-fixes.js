// BSD CRM VIP UI refinements
(() => {
  function refineVipBox(root=document){
    const boxes = root.querySelectorAll ? root.querySelectorAll('[data-vip-crm-box]') : [];
    boxes.forEach(box => {
      box.querySelectorAll('label, option, div, span').forEach(el => {
        const t = (el.textContent || '').trim();
        if (t === 'קובץ אנונימי מאושר') el.textContent = 'הגרסה המלאה של התקציר האנונימי';
        if (t === 'אין תקציר אנונימי מאושר') el.textContent = 'לא נמצאה גרסה מלאה של התקציר האנונימי';
        if (t.includes('הפרסום חסום. יש ליצור או להעלות קובץ שמוגדר anonymous_summary ברמת סודיות 1.')) {
          el.textContent = 'הפרסום חסום. יש ליצור או להעלות בלשונית מסמכים וקבצים את הגרסה המלאה של התקציר האנונימי.';
        }
        if (t.includes('המערכת מאפשרת פרסום רק של קובץ anonymous_summary פעיל ברמת סודיות 1.')) {
          el.textContent = 'הקובץ ללקוחות VIP נלקח מלשונית מסמכים וקבצים בכרטיס העסק. ניתן לבחור רק את הגרסה המלאה של התקציר האנונימי. מסמכים פנימיים וקבצים אחרים נשארים חסומים.';
        }
      });
    });
  }

  function ensureVipAdminLink(){
    const toolsWrap = document.getElementById('navToolsWrap');
    if (!toolsWrap) return;
    const menu = toolsWrap.querySelector('.bsd-forms-menu');
    if (!menu) return;
    let link = menu.querySelector('[data-vip-admin-link]');
    if (!link) {
      link = document.createElement('a');
      link.href = 'vip-admin.html';
      link.dataset.vipAdminLink = '1';
      link.style.cssText = 'display:block;color:#f1d98d;text-decoration:none;padding:11px 16px;font-size:.85rem;font-weight:800;border-top:1px solid rgba(255,255,255,.08);';
      menu.insertBefore(link, menu.firstChild);
    }
    link.textContent = '⭐ ניהול לקוחות VIP';
  }

  function run(){
    ensureVipAdminLink();
    refineVipBox(document);
    const observer = new MutationObserver(mutations => {
      for (const m of mutations) {
        m.addedNodes.forEach(node => {
          if (node.nodeType === 1) refineVipBox(node);
        });
      }
      refineVipBox(document);
      ensureVipAdminLink();
    });
    observer.observe(document.body, { childList:true, subtree:true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once:true });
  else run();
})();
