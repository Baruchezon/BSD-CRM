window.BSDRecordActions = (() => {
  let activeMenu;

  function closeMenu(restoreFocus = false) {
    if (!activeMenu) return;
    const { button, menu, parent } = activeMenu;
    activeMenu = null;
    button.setAttribute('aria-expanded', 'false');
    menu.style.display = 'none';
    menu.classList.remove('bsd-record-menu-open');
    if (parent.isConnected) parent.append(menu);
    else menu.remove();
    if (restoreFocus && button.isConnected) button.focus({ preventScroll: true });
  }

  function toggleMenu(event) {
    event.stopPropagation();
    const button = event.currentTarget;
    const wasOpen = activeMenu?.button === button;
    closeMenu();
    if (wasOpen) return;

    const parent = button.parentElement;
    const menu = parent.querySelector('.bsd-forms-menu');
    if (!menu) return;
    document.querySelectorAll('.bsd-forms-menu').forEach(other => { other.style.display = 'none'; });

    // The table and its scroll wrappers clip descendants. Mount the open menu
    // on the body so those wrappers cannot clip it or cover its hit targets.
    activeMenu = { button, menu, parent };
    document.body.append(menu);
    menu.classList.add('bsd-record-menu-open');
    menu.style.display = 'block';
    menu.scrollTop = 0;

    const rect = button.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight;
    const { width, height } = menu.getBoundingClientRect();
    const margin = 8;
    const gap = 4;
    const spaceBelow = viewportHeight - margin - rect.bottom - gap;
    const spaceAbove = rect.top - margin - gap;
    const preferredTop = height > spaceBelow && spaceAbove > spaceBelow
      ? rect.top - gap - height : rect.bottom + gap;
    menu.style.top = Math.max(margin, Math.min(preferredTop, viewportHeight - margin - height)) + 'px';
    menu.style.left = Math.max(margin, Math.min(rect.right - width, viewportWidth - margin - width)) + 'px';
    button.setAttribute('aria-expanded', 'true');
    if (event.detail === 0) menu.querySelector('a, button')?.focus({ preventScroll: true });
  }

  document.addEventListener('click', event => {
    if (!activeMenu) return;
    const { menu, button } = activeMenu;
    if (menu.contains(event.target)) {
      // Let the action run even when it stops propagation (for example, VIP).
      if (event.target.closest('a, button')) {
        setTimeout(() => { if (activeMenu?.menu === menu) closeMenu(); }, 0);
      } else {
        event.stopPropagation();
      }
    } else if (!button.contains(event.target)) {
      closeMenu();
    }
  }, true);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && activeMenu) {
      event.preventDefault();
      event.stopPropagation();
      closeMenu(true);
    }
  }, true);
  window.addEventListener('scroll', event => {
    if (activeMenu && !(event.target instanceof Node && activeMenu.menu.contains(event.target))) closeMenu();
  }, true);
  window.addEventListener('resize', () => closeMenu());

  function phoneLinks(phones) {
    const groups = [];
    const seen = new Set();
    for (const phone of phones) {
      const raw = String(phone || '').trim();
      if (!/^\+?[\d\s().-]+$/.test(raw)) continue;
      const digits = raw.replace(/\D/g, '').replace(/^((?:00)?972)0(?=[1-9]\d{7,8}$)/, '$1');
      if (digits.length < 7 || digits.length > 17) continue;

      const israeliInternational = /^972[1-9]\d{7,8}$/.test(digits);
      const international = raw.startsWith('+') || digits.startsWith('00') || israeliInternational;
      const dial = international ? '+' + digits.replace(/^00/, '') : digits;
      const whatsapp = international
        ? dial.slice(1)
        : /^0[1-9]\d{7,8}$/.test(digits) ? '972' + digits.slice(1) : '';
      const key = whatsapp || dial;
      if (seen.has(key)) continue;
      seen.add(key);

      groups.push(`<span class="bsd-card-contact-group">
        <a class="bsd-contact-call" href="tel:${dial}" aria-label="חייג למספר ${dial}">חייג <bdi>${raw}</bdi></a>
        ${/^[1-9]\d{6,14}$/.test(whatsapp) ? `<a class="bsd-contact-wa" href="https://wa.me/${whatsapp}" target="_blank" rel="noopener" aria-label="WhatsApp למספר ${dial}">WhatsApp</a>` : ''}
      </span>`);
    }
    return groups.join('');
  }

  function contactActions(phones) {
    const links = phoneLinks(phones);
    return links ? `<div class="bsd-card-contacts">${links}</div>` : '';
  }

  function bindContacts(card, fieldIds, otherPhones = []) {
    const actions = card.querySelector('[data-card-contacts]');
    const fields = fieldIds.map(id => card.querySelector('#' + id));
    const refresh = () => {
      actions.innerHTML = phoneLinks([...fields.map(field => field.value), ...otherPhones]);
    };
    fields.forEach(field => field.addEventListener('input', refresh));
    refresh();
  }

  return { toggleMenu, contactActions, bindContacts };
})();
