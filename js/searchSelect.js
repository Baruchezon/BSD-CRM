/* ============================================================
   BSD-CRM — Searchable Select (combobox)
   Drop-in replacement for long <select> lists (buyers, businesses...).
   Keeps the same contract as a native <select>: a hidden <input>
   holds the real value under the given id, and fires a bubbling
   'change' event on selection — so existing code that reads
   document.getElementById(id).value or listens for 'change'
   keeps working without any other changes.
   ============================================================ */
(function(){
  function esc(s){
    if (s === undefined || s === null) return '';
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function ensureStyles(){
    if (document.getElementById('ssStyles')) return;
    const style = document.createElement('style');
    style.id = 'ssStyles';
    style.textContent = `
      .ss-box{ position:relative; }
      .ss-input[disabled]{ background:#f3f2ec; color:#888; cursor:not-allowed; }
      .ss-input.ss-open{ border-color:#a9b3c9 !important; }
      .ss-list{
        display:none; position:absolute; z-index:60; top:100%; right:0; left:0;
        background:#fff; border:1px solid #d8d3c4; border-radius:8px;
        max-height:230px; overflow-y:auto; box-shadow:0 10px 24px rgba(0,0,0,.14);
        margin-top:4px;
      }
      .ss-opt{ padding:8px 12px; cursor:pointer; font-size:.85rem; }
      .ss-opt:hover, .ss-opt.ss-hl{ background:#f2efe4; }
      .ss-opt.ss-clear{ color:#888; border-bottom:1px solid #f0ede4; }
      .ss-empty{ padding:10px 12px; color:#999; font-size:.8rem; }
    `;
    document.head.appendChild(style);
  }

  // Returns the HTML markup for a searchable select. Insert this string
  // wherever a <select> would have gone.
  window.searchSelectHTML = function(opts){
    const boxId = opts.boxId;
    const valueId = opts.valueId || boxId;
    return `<div class="ss-box" id="${boxId}">` +
      `<input type="text" class="ss-input" id="${boxId}_input" autocomplete="off" ` +
      `placeholder="${esc(opts.placeholder || 'הקלד לחיפוש...')}" ` +
      `value="${esc(opts.selectedLabel || '')}" ${opts.disabled ? 'disabled' : ''}>` +
      `<input type="hidden" id="${valueId}" value="${esc(opts.selectedValue !== undefined ? opts.selectedValue : '')}">` +
      `<div class="ss-list" id="${boxId}_list"></div>` +
      `</div>`;
  };

  // Wires up behavior. Call once, after the markup above is in the DOM.
  // items: array of source objects
  // opts: { getId(item), getLabel(item), valueId, allowClear, clearLabel, onChange(value) }
  window.initSearchSelect = function(boxId, items, opts){
    ensureStyles();
    const getId = opts.getId, getLabel = opts.getLabel;
    const input = document.getElementById(boxId + '_input');
    const hidden = document.getElementById(opts.valueId || boxId);
    const list = document.getElementById(boxId + '_list');
    if (!input || !hidden || !list) return;

    let hlIndex = -1;

    function currentLabel(){
      const cur = items.find(it => String(getId(it)) === String(hidden.value));
      return cur ? getLabel(cur) : '';
    }

    function renderList(filterText){
      const q = (filterText || '').trim().toLowerCase();
      let filtered = q ? items.filter(it => getLabel(it).toLowerCase().includes(q)) : items.slice();
      const overflow = filtered.length > 60;
      filtered = filtered.slice(0, 60);
      hlIndex = -1;

      let html = '';
      if (opts.allowClear){
        html += `<div class="ss-opt ss-clear" data-id="all">${esc(opts.clearLabel || 'הכל')}</div>`;
      }
      if (filtered.length === 0){
        html += `<div class="ss-empty">לא נמצאו תוצאות</div>`;
      } else {
        html += filtered.map(it => `<div class="ss-opt" data-id="${esc(getId(it))}">${esc(getLabel(it))}</div>`).join('');
        if (overflow) html += `<div class="ss-empty">מוצגות 60 התוצאות הראשונות — המשיכו להקליד לצמצום</div>`;
      }
      list.innerHTML = html;
      list.style.display = 'block';
      input.classList.add('ss-open');

      list.querySelectorAll('.ss-opt').forEach(opt=>{
        opt.addEventListener('mousedown', (e)=>{
          e.preventDefault();
          selectId(opt.getAttribute('data-id'));
        });
      });
    }

    function selectId(id){
      if (id === 'all' && opts.allowClear){
        hidden.value = 'all';
        input.value = opts.clearLabel || '';
      } else {
        const match = items.find(it => String(getId(it)) === String(id));
        hidden.value = match ? id : '';
        input.value = match ? getLabel(match) : '';
      }
      list.style.display = 'none';
      input.classList.remove('ss-open');
      hidden.dispatchEvent(new Event('change', { bubbles: true }));
      if (opts.onChange) opts.onChange(hidden.value);
    }

    function closeList(){
      list.style.display = 'none';
      input.classList.remove('ss-open');
    }

    input.addEventListener('focus', ()=>{
      // if the box currently shows the selected label, open with the full list
      const showAll = input.value === currentLabel() || input.value === (opts.clearLabel || '');
      renderList(showAll ? '' : input.value);
    });
    input.addEventListener('input', ()=>{
      if (!(opts.allowClear)) hidden.value = '';
      renderList(input.value);
    });
    input.addEventListener('blur', ()=>{
      setTimeout(()=>{
        closeList();
        const cur = items.find(it => String(getId(it)) === String(hidden.value));
        if (hidden.value === 'all' && opts.allowClear){ input.value = opts.clearLabel || ''; }
        else if (cur){ input.value = getLabel(cur); }
        else { input.value = ''; hidden.value = ''; }
      }, 150);
    });
    input.addEventListener('keydown', (e)=>{
      const opts_ = Array.from(list.querySelectorAll('.ss-opt'));
      if (e.key === 'Escape'){ closeList(); input.blur(); return; }
      if (list.style.display !== 'block') return;
      if (e.key === 'ArrowDown'){
        e.preventDefault();
        hlIndex = Math.min(hlIndex + 1, opts_.length - 1);
        opts_.forEach((o,i)=>o.classList.toggle('ss-hl', i===hlIndex));
        if (opts_[hlIndex]) opts_[hlIndex].scrollIntoView({ block:'nearest' });
      } else if (e.key === 'ArrowUp'){
        e.preventDefault();
        hlIndex = Math.max(hlIndex - 1, 0);
        opts_.forEach((o,i)=>o.classList.toggle('ss-hl', i===hlIndex));
        if (opts_[hlIndex]) opts_[hlIndex].scrollIntoView({ block:'nearest' });
      } else if (e.key === 'Enter'){
        e.preventDefault();
        const target = hlIndex >= 0 ? opts_[hlIndex] : opts_[0];
        if (target) selectId(target.getAttribute('data-id'));
      }
    });
  };
})();
