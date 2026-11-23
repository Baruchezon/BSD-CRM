(function () {
  'use strict';

  const tone = { business: 'vip-map-business', buyer: 'vip-map-buyer', broker: 'match-map-broker' };

  function create({ escape, formatDate, userName, selectView, database }) {
    const main = document.getElementById('mainContent');
    const openDetails = new Map();

    function select(groupKey, matchId) {
      openDetails.set(groupKey, matchId);
    }

    function close() { openDetails.clear(); }

    function focusGroup(key) {
      document.getElementById('match-graph-' + key)?.focus();
    }

    function entityName(entity, className = '') {
      const name = '<strong>' + escape(entity.name) + '</strong>';
      const link = entity.href
        ? `<a class="${className}" href="${escape(entity.href)}">${name}</a>`
        : `<span class="${className}">${name}</span>`;
      return link + (entity.origin ? `<small class="bsd-record-origin" style="display:block;font-size:14px;line-height:1.45">${escape(entity.origin)}</small>` : '');
    }

    function branch(match, view, index, detailsId) {
      const other = match.other;
      return `<li>
        <span class="vip-map-arrow" aria-hidden="true"></span>
        <div class="vip-map-node ${tone[other.kind]}">
          <div class="vip-map-node-name">
            ${entityName(other)}
            <span>${escape([other.label, other.reference].filter(Boolean).join(' · '))}</span>
            <span><b class="chip chip-${match.statusColor}">${escape(match.status || 'ללא סטטוס')}</b></span>
          </div>
          <div class="match-map-branch-actions">
            <button type="button" class="vip-map-open" data-match-graph="${index}" aria-controls="${detailsId}">תהליך והערות</button>
            <button type="button" class="vip-map-open" data-match-pivot="${index}">${view === 'business' ? 'לפי ' + other.label : 'לפי עסק'}</button>
          </div>
        </div>
      </li>`;
    }

    function notesQuery(table, id) {
      return database().from('record_notes').select('note_text,created_at,author_id')
        .eq('table_name', table).eq('record_id', id).order('created_at', { ascending: false });
    }

    function listItems(items, empty) {
      if (!items.length) return `<p class="muted">${empty}</p>`;
      return `<ul class="vip-map-send-list">${items.map(item=>`<li>
        <strong>${escape(item.title)}</strong>
        ${item.text ? `<span class="match-map-copy">${escape(item.text)}</span>` : ''}
        <span>${escape([formatDate(item.at), userName(item.who)].filter(Boolean).join(' · '))}</span>
      </li>`).join('')}</ul>`;
    }

    async function fill(target, work, fallback) {
      try {
        const html = await work();
        if (target.isConnected) target.innerHTML = html;
      } catch {
        if (target.isConnected) target.textContent = fallback;
      }
    }

    function loadNotes(target, table, id, cardNote) {
      return fill(target, async () => {
        const [notes, lead] = await Promise.all([notesQuery(table, id), cardNote
          ? database().from('leads').select('notes').eq('id', id).maybeSingle()
          : Promise.resolve({ data: null })]);
        const freeText = lead.data?.notes;
        const overview = freeText ? `<p class="match-map-copy">${escape(freeText)}</p>` : '';
        const warnings = [lead.error && 'לא ניתן לטעון את שדה ההערות בכרטיס.', notes.error && 'לא ניתן לטעון את יומן ההערות.'].filter(Boolean);
        const items = (notes.data || []).map(n=>({ title: 'הערה', at: n.created_at, who: n.author_id, text: n.note_text }));
        return overview + warnings.map(w=>`<p class="muted">${w}</p>`).join('') +
          (items.length || (!overview && !warnings.length) ? listItems(items, 'אין הערות מתועדות.') : '');
      }, 'לא ניתן לטעון את ההערות.');
    }

    function loadHistory(target, id) {
      return fill(target, async () => {
        const [statuses, activities, meetings] = await Promise.all([
          database().from('match_status_history').select('status,changed_at,changed_by,note').eq('match_id', id).order('changed_at', { ascending: false }),
          database().from('match_activity_log').select('action_type,description,note,buyer_response,occurred_at,created_at,performed_by,visible_to_client').eq('match_id', id).is('deleted_at', null)
            .order('created_at', { ascending: false }),
          database().from('match_meetings').select('meeting_type,meeting_date,start_time,summary_text,decisions,next_action,agent_id,created_by')
            .eq('match_id', id).is('deleted_at', null).order('meeting_date', { ascending: false })
        ]);
        const steps = (statuses.data || []).map(s=>({ title: s.status, text: s.note, at: s.changed_at, who: s.changed_by }));
        const events = (activities.data || []).map(a=>({
          title: (a.action_type || 'פעילות') + (a.visible_to_client ? ' · שיתוף בפורטל' : ''), text: [...new Set([a.description, a.note, a.buyer_response].filter(text=>text && text !== a.action_type))].join('\n'),
          at: a.occurred_at || a.created_at, who: a.performed_by
        }));
        const appointments = (meetings.data || []).map(m=>({
          title: m.meeting_type || 'פגישה', at: m.meeting_date, who: m.agent_id || m.created_by,
          text: [m.start_time?.slice(0,5), m.summary_text, m.decisions, m.next_action].filter(Boolean).join('\n')
        }));
        const entries = [...steps, ...events, ...appointments].sort((a,b)=>new Date(b.at)-new Date(a.at));
        const warning = statuses.error || activities.error || meetings.error ? '<p class="muted">חלק מהיסטוריית הטיפול לא נטען.</p>' : '';
        return warning + (entries.length || !warning ? listItems(entries, 'אין עדיין שינויים או פעולות מתועדים.') : '');
      }, 'לא ניתן לטעון את היסטוריית הטיפול.');
    }

    function render(view, groups, { wireGroup, wireMatch }) {
      if (!groups.length) {
        main.innerHTML = '<div class="empty-state">לא נמצאו התאמות תואמות לסינון.</div>';
        return;
      }
      const diagrams = groups.map(group=>({ group, matches: group.matches() }));
      main.innerHTML = `<section class="panel vip-map match-map" aria-labelledby="matchGraphTitle">
        <header class="vip-map-header"><h2 id="matchGraphTitle">תרשימי התאמות</h2></header>
        <div class="match-graph-stack">${diagrams.map(diagram=>diagramHtml(view, diagram)).join('')}</div>
      </section>`;
      diagrams.forEach(diagram=>wireDiagram(view, diagram, wireMatch));
      wireGroup(main);
    }

    function diagramHtml(view, { group, matches }) {
      const byBusiness = view === 'business';
      const groupId = 'match-graph-' + escape(group.key);
      const detailsId = groupId + '-details';
      return `<article class="match-graph-item" id="${groupId}" tabindex="-1" aria-label="${escape(group.name)}">
        <div class="vip-map-diagram ${byBusiness ? '' : 'vip-map-reverse'}">
          <div class="vip-map-anchor ${tone[group.kind]}">
            <span>${group.label}${group.reference ? ' · ' + escape(group.reference) : ''}</span>
            ${entityName(group)}
            ${group.summary ? '<span>' + escape(group.summary) + '</span>' : ''}
            <span>${matches.length} התאמות</span>
            ${group.canReadNotes ? '<button type="button" class="vip-map-open" data-graph-buyer-notes aria-controls="' + detailsId + '">הערות הקונה</button>' : ''}
          </div>
          ${matches.length ? `<ul class="vip-map-branches" aria-label="התאמות קשורות">${matches.map((match,index)=>branch(match,view,index,detailsId)).join('')}</ul>`
            : '<div class="empty-state">אין עדיין התאמות בכרטיס הזה.</div>'}
        </div>
        <div class="th-actions match-map-group-actions">${group.actions}</div>
        <section class="vip-map-details" id="${detailsId}" aria-label="פרטי התאמה" hidden></section>
      </article>`;
    }

    function wireDiagram(view, { group, matches }, wireMatch) {
      const diagram = document.getElementById('match-graph-' + group.key);
      const details = diagram.querySelector('.vip-map-details');
      const action = diagram.querySelector('[data-graph-buyer-notes]');
      const openButtons = [...diagram.querySelectorAll('[data-match-graph]')];
      let detailKey = openDetails.get(group.key);

      function closeDetails() {
        const trigger = detailKey === 'buyer-notes' ? action : openButtons[matches.findIndex(match=>match.id === detailKey)];
        expand('', false);
        trigger?.focus();
      }

      function expand(key, focus) {
        detailKey = key;
        if (key) openDetails.set(group.key, key);
        else openDetails.delete(group.key);
        details.hidden = !key;
        openButtons.forEach((button,index)=>button.setAttribute('aria-expanded', matches[index].id === key));
        action?.setAttribute('aria-expanded', key === 'buyer-notes');
        if (!key) {
          details.innerHTML = '';
          return;
        }
        if (key === 'buyer-notes') {
          details.innerHTML = `<h3 tabindex="-1">הערות הקונה · ${escape(group.name)}</h3><div data-buyer-notes role="status">טוען הערות…</div>`;
          loadNotes(details.querySelector('[data-buyer-notes]'), 'leads', group.id, true);
        } else {
          const match = matches.find(item=>item.id === key);
          details.innerHTML = `<h3 tabindex="-1">${escape(match.business.name)} · ${escape(match.buyer.name)}</h3>
            <div class="brn-facts">
              <span class="chip chip-${match.statusColor}">${escape(match.status || 'ללא סטטוס')}</span>
              · מטפל: ${escape(match.handler || 'לא שויך')}
              ${match.vip_email_sent_at ? ' · נשלח ללקוח VIP באימייל' : ''}
            </div>
            ${match.next_action || match.next_action_at ? `<p>פעולה הבאה: ${escape(match.next_action || '')} ${match.next_action_at ? escape(formatDate(match.next_action_at)) : ''}</p>` : ''}
            ${match.openTasks.length ? `<details><summary>משימות פתוחות (${match.openTasks.length})</summary><ul>${match.openTasks.map(t=>`<li>${escape(t.title)} ${t.due_date ? ' · ' + escape(formatDate(t.due_date)) : ''}</li>`).join('')}</ul></details>` : ''}
            <details open><summary>היסטוריית הטיפול</summary><div data-match-history role="status">טוען היסטוריה…</div></details>
            <details open><summary>הערות התאמה</summary>
              ${match.notes ? `<p class="match-map-copy">${escape(match.notes)}</p>` : ''}
              <div data-match-notes role="status">טוען הערות…</div>
            </details>
            ${match.buyer.canReadNotes ? '<details open><summary>הערות הקונה</summary><div data-buyer-notes role="status">טוען הערות…</div></details>' : ''}
            ${match.actions}`;
          loadHistory(details.querySelector('[data-match-history]'), match.id);
          loadNotes(details.querySelector('[data-match-notes]'), 'matches', match.id, false);
          if (match.buyer.canReadNotes) loadNotes(details.querySelector('[data-buyer-notes]'), 'leads', match.buyer.id, true);
          wireMatch(details);
        }
        const heading = details.querySelector('h3');
        const closeButton = document.createElement('button');
        closeButton.type = 'button';
        closeButton.className = 'vip-map-open match-close';
        closeButton.textContent = 'סגור פרטים';
        closeButton.addEventListener('click', closeDetails);
        heading.after(closeButton);
        if (focus) {
          heading.focus({ preventScroll: true });
          details.scrollIntoView({ block: 'nearest' });
        }
      }

      details.addEventListener('keydown', event=>{
        if (event.key === 'Escape') closeDetails();
      });
      action?.addEventListener('click', ()=>expand(detailKey === 'buyer-notes' ? '' : 'buyer-notes', true));
      openButtons.forEach((button,index)=>button.addEventListener('click', ()=>{
        const id = matches[index].id;
        expand(detailKey === id ? '' : id, true);
      }));
      diagram.querySelectorAll('[data-match-pivot]').forEach((button,index)=>button.addEventListener('click', ()=>{
        selectView(view === 'business' ? 'buyer' : 'business', matches[index].other.key, true);
      }));
      const validDetail = detailKey === 'buyer-notes' ? group.canReadNotes : matches.some(match=>match.id === detailKey);
      expand(validDetail ? detailKey : '', false);
    }

    return { render, select, close, focusGroup };
  }

  window.BSDMatchesGraph = { create };
})();
