(() => {
  'use strict';

  /* ======== авторизация из исходника: GET /api/products + initData ======== */

  const API_BASE = location.origin;

  function getInitDataString() {
    const tg = window.Telegram && window.Telegram.WebApp;
    if (tg?.initData) return tg.initData;

    // совместимость со старыми версиями
    if (tg?.initDataUnsafe) {
      try {
        const p = new URLSearchParams();
        const u = tg.initDataUnsafe;
        if (u.query_id)     p.set('query_id', u.query_id);
        if (u.user)         p.set('user', JSON.stringify(u.user));
        if (u.start_param)  p.set('start_param', u.start_param);
        if (u.auth_date)    p.set('auth_date', String(u.auth_date));
        if (u.hash)         p.set('hash', u.hash);
        return p.toString();
      } catch {}
    }
    return '';
  }
  const TG_INIT = getInitDataString();

  function getAdminToken() {
    try { return localStorage.getItem('admToken') || ''; } catch { return ''; }
  }

  function buildHeaders(extra = {}) {
    const token = getAdminToken();
    const h = { 'Content-Type': 'application/json', ...extra };
    if (TG_INIT) h['X-Telegram-Init-Data'] = TG_INIT;     // на случай, если миддлварь читает заголовок
    if (token) {
      h['X-Admin-Token'] = token;
      h['Authorization'] = `Bearer ${token}`;
    }
    return h;
  }

  async function apiGET(path) {
    const url = new URL(API_BASE + path);
    if (TG_INIT) url.searchParams.set('initData', encodeURIComponent(TG_INIT)); // и в query, как в исходнике
    const res = await fetch(url, { method: 'GET', headers: buildHeaders() });
    let json = null;
    try { json = await res.json(); } catch {}
    if (!res.ok || json?.ok === false) {
      const err = new Error(json?.error || res.statusText || 'Request failed');
      err.status = res.status; err.payload = json; throw err;
    }
    return json;
  }

  async function apiPOST(path, body) {
    const res = await fetch(API_BASE + path, {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify({ ...(body||{}), initData: TG_INIT })
    });
    let json = null;
    try { json = await res.json(); } catch {}
    if (!res.ok || json?.ok === false) {
      const err = new Error(json?.error || res.statusText || 'Request failed');
      err.status = res.status; err.payload = json; throw err;
    }
    return json;
  }

  /* ================== DOM ================== */
  const els = {
    categories: document.getElementById('categories'),
    search:     document.getElementById('search'),
    btnClear:   document.getElementById('btnClear'),
    btnExpand:  document.getElementById('btnExpand'),
    btnSend:    document.getElementById('btnSend'),
    counter:    document.getElementById('selectedCounter'),
  };

  /* ================== State ================== */
  const state = {
    products: [],          // {id,name,unit,category}
    filter: '',
    cart: new Map(),       // productId -> qty
  };

  /* ================== Utils ================== */
  const norm = s => (s || '').toString().trim().toLowerCase();
  const by = (k) => (a,b) => (a[k]||'').localeCompare(b[k]||'', 'ru', {sensitivity:'base'});

  function safeNum(v, def=0){ const n = Number(v); return Number.isFinite(n) ? n : def; }
  function plural(n, one, few, many){
    n = Math.abs(n) % 100; const n1 = n % 10;
    if (n>10 && n<20) return many; if (n1>1 && n1<5) return few; if (n1===1) return one; return many;
  }
  function escapeHtml(s){
    return (s ?? '').toString()
      .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
      .replaceAll('"','&quot;').replaceAll("'",'&#39;');
  }

  function groupByCategory(items){
    const map = new Map();
    for (const p of items){
      const cat = p.category || 'Без категории';
      if(!map.has(cat)) map.set(cat, []);
      map.get(cat).push(p);
    }
    for(const arr of map.values()) arr.sort(by('name'));
    return Array.from(map.entries()).sort((a,b)=>a[0].localeCompare(b[0],'ru',{sensitivity:'base'}));
  }

  /* ================== Render ================== */
  function itemRowHtml(p){
    const qty = state.cart.get(p.id) ?? '';
    const unit = p.unit ? `<span class="item-unit">(${escapeHtml(p.unit)})</span>` : '';
    return `
      <div class="item-row" data-id="${String(p.id)}">
        <div class="item-title">${escapeHtml(p.name)} ${unit}</div>
        <div class="qty">
          <button class="btn btn--ghost btn-dec" type="button" aria-label="Уменьшить">−</button>
          <input type="number" class="qty-input" inputmode="decimal" min="0" step="0.5" placeholder="0" value="${qty}"/>
          <button class="btn btn--ghost btn-inc" type="button" aria-label="Увеличить">+</button>
        </div>
      </div>
    `;
  }

  function attachItemRowHandlers(){
    for (const row of els.categories.querySelectorAll('.item-row')){
      const id = row.getAttribute('data-id');
      const input = row.querySelector('.qty-input');
      const inc = row.querySelector('.btn-inc');
      const dec = row.querySelector('.btn-dec');

      input.addEventListener('input', () => {
        const v = Math.max(0, safeNum(input.value));
        if(!v){ state.cart.delete(id); input.value = ''; }
        else { state.cart.set(id, v); }
        updateCounter();
      });
      inc.addEventListener('click', () => {
        const cur = safeNum(input.value);
        const next = +(cur + stepFor(input)).toFixed(2);
        input.value = next; state.cart.set(id, next); updateCounter();
      });
      dec.addEventListener('click', () => {
        const cur = safeNum(input.value);
        const next = Math.max(0, +(cur - stepFor(input)).toFixed(2));
        input.value = next || '';
        if(next>0) state.cart.set(id, next); else state.cart.delete(id);
        updateCounter();
      });
    }
  }
  function stepFor(input){ const s = safeNum(input.getAttribute('step'), 1); return s > 0 ? s : 1; }

  function updateCounter(){
    const cnt = state.cart.size;
    els.counter.textContent = `Выбрано: ${cnt} ${plural(cnt, 'позиция','позиции','позиций')}`;
  }

  function render(){
    const q = norm(state.filter);
    const filtered = q
      ? state.products.filter(p => norm(p.name).includes(q) || norm(p.category).includes(q))
      : state.products.slice();
    const grouped = groupByCategory(filtered);

    if(!grouped.length){
      els.categories.innerHTML = `<div class="empty">Ничего не найдено по запросу «${escapeHtml(state.filter)}»</div>`;
      updateCounter(); return;
    }

    const html = grouped.map(([cat, list]) => {
      const items = list.map(p => itemRowHtml(p)).join('');
      return `
        <details class="category" open data-category="${escapeHtml(cat)}">
          <summary>
            <span>${escapeHtml(cat)}</span>
            <span class="meta"><span class="badge">${list.length}</span></span>
          </summary>
          <div class="items">${items}</div>
        </details>
      `;
    }).join('');

    els.categories.innerHTML = html;
    attachItemRowHandlers();
    updateCounter();
  }

  /* ================== UI Handlers ================== */
  els.search.addEventListener('input', () => { state.filter = els.search.value || ''; render(); });
  els.btnClear.addEventListener('click', () => { state.filter = ''; state.cart.clear(); els.search.value=''; render(); });
  els.btnExpand.addEventListener('click', () => {
    const mode = els.btnExpand.dataset.mode || 'open';
    const all = Array.from(els.categories.querySelectorAll('details.category'));
    const open = mode === 'open';
    for (const d of all) d.open = open;
    els.btnExpand.dataset.mode = open ? 'close' : 'open';
    els.btnExpand.textContent   = open ? 'Свернуть все' : 'Развернуть все';
  });

  els.btnSend.addEventListener('click', async () => {
    const items = Array.from(state.cart.entries()).map(([product_id, qty]) => ({
      product_id: /^\d+$/.test(String(product_id)) ? Number(product_id) : product_id,
      qty
    }));
    if (!items.length){ toast('Вы не выбрали ни одного товара.'); return; }

    els.btnSend.disabled = true;
    try{
      const r = await apiPOST('/api/requisitions', { items });
      toast('Заявка отправлена ✅ #' + (r.requisition_id ?? ''));
      state.cart.clear(); render(); window.scrollTo({ top: 0, behavior: 'smooth' });
    }catch(e){ console.error(e); toast('Не удалось отправить заявку: ' + e.message); }
    finally{ els.btnSend.disabled = false; }
  });

  /* ================== Toast ================== */
  function toast(text){
    let el = document.getElementById('toast');
    if(!el){
      el = document.createElement('div');
      el.id = 'toast';
      el.style.position = 'fixed';
      el.style.left = '50%';
      el.style.bottom = '24px';
      el.style.transform = 'translateX(-50%)';
      el.style.background = 'var(--bg-card)';
      el.style.border = '1px solid var(--border)';
      el.style.borderRadius = '12px';
      el.style.padding = '10px 14px';
      el.style.boxShadow = 'var(--shadow)';
      el.style.zIndex = '9999';
      el.style.maxWidth = '90%';
      el.style.textAlign = 'center';
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.style.opacity = '0';
    el.style.transition = 'opacity .15s ease';
    requestAnimationFrame(()=>{ el.style.opacity = '1'; });
    clearTimeout(el._t);
    el._t = setTimeout(()=> { el.style.opacity = '0'; }, 2200);
  }

  /* ================== Загрузка товаров (как в исходнике) ================== */
  function normalizeProducts(raw) {
    // мягкая нормализация имён полей, чтобы не падать, если у вас name/title, unit/uom и т.п.
    return raw.map(x => ({
      id: x.id ?? x.product_id ?? x._id,
      name: x.name ?? x.title ?? '',
      unit: x.unit ?? x.uom ?? x.measure ?? '',
      category: x.category ?? x.group ?? 'Без категории'
    }));
  }

  async function loadProducts(){
    // оставляю исходную схему: GET /api/products, авторизация — через initData в query+header
    const data = await apiGET('/api/products');
    const list = Array.isArray(data.products) ? data.products : (Array.isArray(data) ? data : []);
    if (!list.length) throw new Error('EMPTY_PRODUCTS');
    return normalizeProducts(list);
  }

  (async function init(){
    try { window.Telegram?.WebApp?.ready?.(); } catch {}
    try {
      state.products = await loadProducts();
      render();
    } catch (e) {
      console.error('Unable to load products:', e);
      els.categories.innerHTML = `<div class="empty">Ошибка загрузки товаров.</div>`;
    }
  })();

  /* ================== Подхват темы из Telegram (необязательно) ================== */
  try {
    const tp = window.Telegram?.WebApp?.themeParams || {};
    const root = document.documentElement;
    if (tp.bg_color)          root.style.setProperty('--bg', tp.bg_color);
    if (tp.text_color)        root.style.setProperty('--text', tp.text_color);
    if (tp.hint_color)        root.style.setProperty('--text-muted', tp.hint_color);
    if (tp.button_color)      root.style.setProperty('--primary', tp.button_color);
    if (tp.button_text_color) root.style.setProperty('--btn-tx', tp.button_text_color);
  } catch {}
})();
