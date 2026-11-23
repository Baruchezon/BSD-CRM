(function () {
  'use strict';

  const pageSize = 50;
  const dateFormat = new Intl.DateTimeFormat('he-IL', {
    timeZone: 'Asia/Jerusalem', dateStyle: 'short', timeStyle: 'short'
  });
  const dateLabel = value => value ? dateFormat.format(new Date(value)) : 'מועד לא תועד';
  const numberLabel = value => Number(value).toLocaleString('he-IL');
  const businessCount = count => count === 1 ? 'עסק אחד' : numberLabel(count) + ' עסקים';
  const buyerCount = count => count === 1 ? 'קונה אחד' : numberLabel(count) + ' קונים';
  const sendCount = count => count === 1 ? 'שליחה אחת' : numberLabel(count) + ' שליחות';

  function groupPairs(pairs, mode) {
    const business = mode === 'business';
    const groups = new Map();
    for (const pair of pairs) {
      const id = business ? pair.business_number : pair.subscriber_id;
      if (!groups.has(id)) {
        groups.set(id, { id, name: business ? pair.business_name : pair.buyer_name, origin: business ? pair.business_origin : pair.buyer_origin, pairs: [] });
      }
      groups.get(id).pairs.push(pair);
    }
    return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, 'he') || a.id.localeCompare(b.id));
  }

  function sample(rows, params) {
    const pairs = new Map();
    const deliveries = [];
    for (const row of rows) {
      for (const send of row.sends || []) {
        const key = JSON.stringify([row.id, send.business_number]);
        if (!pairs.has(key)) {
          pairs.set(key, {
            subscriber_id: row.id, buyer_name: [row.first_name, row.last_name].filter(Boolean).join(' '),
            business_number: send.business_number, business_name: send.internal_name || send.business_number,
            send_count: 0, last_sent_at: send.sent_at
          });
        }
        const pair = pairs.get(key);
        pair.send_count++;
        if (send.sent_at > pair.last_sent_at) pair.last_sent_at = send.sent_at;
        if (row.id === params.p_subscriber_id && send.business_number === params.p_business_number) {
          deliveries.push(send);
        }
      }
    }
    if (params.p_subscriber_id) {
      const offset = params.p_offset || 0;
      deliveries.sort((a, b) => b.sent_at.localeCompare(a.sent_at));
      return { deliveries: deliveries.slice(offset, offset + pageSize) };
    }
    return {
      total_businesses: new Set([...pairs.values()].map(pair => pair.business_number)).size,
      pairs: [...pairs.values()]
    };
  }

  function create({ escape, request, onSummary }) {
    const panel = document.getElementById('vipMap');
    const controls = document.getElementById('vipMapControls');
    const status = document.getElementById('vipMapStatus');
    const select = document.getElementById('vipMapEntity');
    const label = document.getElementById('vipMapEntityLabel');
    const graph = document.getElementById('vipMapGraph');
    const details = document.getElementById('vipMapDetails');
    const detailTitle = document.getElementById('vipMapDetailsTitle');
    const detailRows = document.getElementById('vipMapDetailRows');
    const pager = document.getElementById('vipMapDetailPager');
    const prev = document.getElementById('vipMapDetailPrev');
    const next = document.getElementById('vipMapDetailNext');

    let overview;
    let pending;
    let failed = false;
    let demo;
    let mode = 'business';
    let selected = '';
    let displayedPairs = [];
    let activePair;
    let detailOffset = 0;
    let detailRequest = 0;

    function count() {
      return overview ? numberLabel(overview.total_businesses) : failed ? '—' : '…';
    }

    function clearDetails() {
      activePair = null;
      detailRequest++;
      details.hidden = true;
    }

    function paint() {
      const pairs = overview?.pairs || [];
      controls.hidden = pairs.length === 0;
      if (!pairs.length) {
        graph.innerHTML = '';
        clearDetails();
        return;
      }
      const byBusiness = mode === 'business';
      const groups = groupPairs(pairs, mode);
      const group = groups.find(item => item.id === selected) || groups[0];
      selected = group.id;
      displayedPairs = group.pairs;
      label.textContent = byBusiness ? 'בחירת עסק' : 'בחירת קונה';
      select.innerHTML = groups.map(item => {
        const reference = byBusiness ? ' · ' + item.id : '';
        return `<option value="${escape(item.id)}">${escape(item.name + reference)}</option>`;
      }).join('');
      select.value = selected;
      panel.querySelectorAll('[data-map-mode]').forEach(button => {
        button.setAttribute('aria-pressed', button.dataset.mapMode === mode);
      });
      const destinationCount = (byBusiness ? buyerCount : businessCount)(group.pairs.length);
      graph.innerHTML = `<div class="vip-map-diagram ${byBusiness ? '' : 'vip-map-reverse'}">
        <div class="vip-map-anchor ${byBusiness ? 'vip-map-business' : 'vip-map-buyer'}">
          <span>${byBusiness ? 'עסק שנשלח' : 'קונה שקיבל'}</span>
          <strong>${escape(group.name)}</strong>${window.BSDOrigin?.html(group.origin) || ''}
          <span>${byBusiness ? 'נשלח אל ' : 'קיבל '}${destinationCount}</span>
        </div>
        <ul class="vip-map-branches" aria-label="${byBusiness ? 'קונים שקיבלו' : 'עסקים שנשלחו'}">
          ${group.pairs.map((pair, index) => `<li>
            <span class="vip-map-arrow" aria-hidden="true"></span>
            <div class="vip-map-node ${byBusiness ? 'vip-map-buyer' : 'vip-map-business'}">
              <button type="button" class="vip-map-node-name" data-map-switch="${index}">
                <strong>${escape(byBusiness ? pair.buyer_name : pair.business_name)}</strong>${window.BSDOrigin?.html(byBusiness ? pair.buyer_origin : pair.business_origin) || ''}
                <span>${byBusiness ? '' : escape(pair.business_number) + ' · '}${sendCount(pair.send_count)} · ${escape(dateLabel(pair.last_sent_at))}</span>
              </button>
              <button type="button" class="vip-map-open" data-map-details="${index}"
                aria-label="מה נשלח למי: ${escape(pair.business_name)} אל ${escape(pair.buyer_name)}">מה נשלח למי</button>
            </div>
        </li>`).join('')}
        </ul>
      </div>`;
    }

    async function load(isDemo) {
      if (pending) return pending;
      demo = isDemo;
      failed = false;
      if (!overview) status.textContent = 'טוען את תרשים השליחות…';
      pending = (async () => {
        try {
          const result = await request({}, demo);
          const changed = JSON.stringify(result) !== JSON.stringify(overview);
          overview = result;
          status.textContent = result.pairs.length ? '' : 'עדיין אין עסקים שנשלחו לקוני VIP.';
          if (changed) {
            clearDetails();
            paint();
          }
        } catch {
          failed = true;
          status.textContent = 'תרשים השליחות לא נטען.';
          const retry = document.createElement('button');
          retry.type = 'button';
          retry.className = 'vip-map-open';
          retry.textContent = 'נסה שוב';
          retry.addEventListener('click', () => load(demo));
          status.append(' ', retry);
        } finally {
          pending = null;
          onSummary();
        }
      })();
      return pending;
    }

    function choose(nextMode, id = '') {
      mode = nextMode;
      selected = id;
      clearDetails();
      paint();
    }

    async function showDetails(pair, offset = 0, focus = false) {
      const token = ++detailRequest;
      activePair = pair;
      detailOffset = offset;
      details.hidden = false;
      detailTitle.textContent = pair.business_name + ' נשלח אל ' + pair.buyer_name;
      detailRows.textContent = 'טוען פרטי שליחה…';
      prev.disabled = true;
      next.disabled = true;
      pager.hidden = pair.send_count <= pageSize;
      if (focus) detailTitle.focus();
      try {
        const { deliveries } = await request({
          p_business_number: pair.business_number, p_subscriber_id: pair.subscriber_id, p_offset: offset
        }, demo);
        if (token !== detailRequest) return;
        detailRows.innerHTML = deliveries.length ? `<ul class="vip-map-send-list">${deliveries.map(send => `<li>
          <strong>${escape(dateLabel(send.sent_at))} · אימייל${Number(send.match_pct) > 0 ? ' · התאמה ' + escape(send.match_pct) + '%' : ''}</strong>
          ${send.recipient_email ? `<span>נמען <bdi>${escape(send.recipient_email)}</bdi></span>` : ''}
          ${send.subject ? `<span>נושא ההודעה · ${escape(send.subject)}</span>` : ''}
          ${send.file_name ? `<span>הקובץ שנשלח · ${escape(send.file_name)}</span>` : ''}
          ${send.match_reason ? `<span>סיבת ההתאמה · ${escape(send.match_reason)}</span>` : ''}
        </li>`).join('')}</ul>` : 'אין פרטי שליחה להצגה.';
        prev.disabled = offset === 0;
        next.disabled = offset + pageSize >= pair.send_count;
      } catch {
        if (token === detailRequest) detailRows.textContent = 'פרטי השליחה לא נטענו. אפשר לפתוח את הקשר שוב.';
      }
    }

    controls.addEventListener('click', event => {
      const button = event.target.closest('[data-map-mode]');
      if (button && button.dataset.mapMode !== mode) choose(button.dataset.mapMode);
    });
    select.addEventListener('change', () => choose(mode, select.value));
    graph.addEventListener('click', event => {
      const button = event.target.closest('[data-map-switch], [data-map-details]');
      if (!button) return;
      const pair = displayedPairs[Number(button.dataset.mapSwitch ?? button.dataset.mapDetails)];
      if (button.hasAttribute('data-map-details')) {
        showDetails(pair, 0, true);
      } else {
        const business = mode === 'business';
        choose(business ? 'buyer' : 'business', business ? pair.subscriber_id : pair.business_number);
        select.focus();
      }
    });
    prev.addEventListener('click', () => showDetails(activePair, detailOffset - pageSize));
    next.addEventListener('click', () => showDetails(activePair, detailOffset + pageSize));

    return { count, load };
  }

  window.BSDVIPDeliveryMap = { create, sample };
})();
