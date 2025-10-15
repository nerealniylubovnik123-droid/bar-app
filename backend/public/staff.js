(() => {
  'use strict';

  const API_BASE = location.origin;

  /* ======== initData как в исходнике (GET /api/products) ======== */
  function getInitDataString() {
    const tg = window.Telegram && window.Telegram.WebApp;
    if (tg?.initData) return tg.initData;
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
    if (TG_INIT) h['X-Telegram-Init-Data'] = TG_INIT;
    if (token) {
      h['X-Admin-Token'] = token;
      h['Authorization'] = `Bearer ${token}`;
    }
    return h;
  }
  async function apiGET(path) {
    const url = new URL(API_BASE + path);
    if (TG_INIT) url.searchParams.set('initData', encodeURIComponent(TG_INIT));
    const res = await fetch(url, { method: 'GET', headers: buildHeaders() });
    let json = null; try { json = await res.json(); } catch {}
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
    let json = null; try { json = await res.json(); } catch {}
    if (!res.ok || json?.ok === false) {
      const err = new Error(json?.error || res.statusText || 'Request failed');
      err.status = res.status; err.payload = json; throw err;
    }
    return json;
  }

  /* ================== DOM ================== */
  const els = {
    categories: document.getElementById('categories'),
    btnExpand:  document.getElementById('btnExpand'),
    btnSend:    document.getElementById('btnSend'),
    counter:    document.getElementById('selectedCounter'),
    recoCard:   document.getElementById('reco'),
    recoGrid:   document.getElementById('recoGrid'),
  };

  /* ================== State ================== */
  const state = {
    products: [],          // {id,name,unit,category}
    cart: new Map(),       // productId -> qty
    expandedAll: true,
  };

  /* ================== Utils ================== */
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
          <input type="number" class="qty-input" inputmode="decimal" min="0" step="0.5" placeholder="0" value="${qty}"/>
        </div>
      </div>
    `;
  }

  function attachItemRowHandlers(){
    for (const row of els.categories.querySelectorAll('.item-row')){
      const id = row.getAttribute('data-id');
      const input = row.querySelector('.qty-input');

      input.addEventListener('input', () => {
        const v = Math.max(0, safeNum(input.value));
        if(!v){ state.cart.delete(id); input.value = ''; }
        else { state.cart.set(id, v); }
        updateCounter();
        renderRecommendations();
      });
    }
  }

  function render(){
    const grouped = groupByCategory(state.products);
    if(!grouped.length){
      els.categories.innerHTML = `<div class="empty">Товары не найдены</div>`;
      updateCounter(); return;
    }

    const html = grouped.map(([cat, list]) => {
      const items = list.map(p => itemRowHtml(p)).join('');
      return `
        <details class="category" ${state.expandedAll ? 'open':''} data-category="${escapeHtml(cat)}">
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
    attachCategoryStableScroll();
    updateCounter();
    renderRecommendations();
  }

  /* ==== Стабилизация скролла при сворачивании категорий ==== */
  function attachCategoryStableScroll(){
    els.categories.querySelectorAll('details.category > summary').forEach(summary => {
      summary.addEventListener('click', () => {
        const before = summary.getBoundingClientRect().top;
        setTimeout(() => {
          const after = summary.getBoundingClientRect().top;
          const diff = after - before;
          if (Math.abs(diff) > 1) {
            window.scrollBy({ top: diff, left: 0, behavior: 'auto' });
          }
        }, 0);
      });
    });
  }

  /* ================== Рекомендации (без кнопки) ================== */
  function renderRecommendations(){
    const selectedIds = new Set(state.cart.keys());
    const selectedCats = new Set(
      state.products.filter(p => selectedIds.has(String(p.id)) || selectedIds.has(p.id))
                    .map(p => p.category || 'Без категории')
    );

    const candidates = state.products.filter(p =>
      selectedCats.has(p.category || 'Без категории') &&
      !selectedIds.has(String(p.id)) && !selectedIds.has(p.id)
    );

    const recos = candidates.sort(by('name')).slice(0, 6);

    if (!recos.length) {
      els.recoCard.style.display = 'none';
      els.recoGrid.innerHTML = '';
      return;
    }

    els.recoCard.style.display = '';
    els.recoGrid.innerHTML = recos.map(p => `
      <div class="reco-item" data-id="${String(p.id)}" data-cat="${escapeHtml(p.category || 'Без категории')}">
        <div class="name">${escapeHtml(p.name)}</div>
      </div>
    `).join('');

    // Клик по рекомендации: раскрыть категорию, проскроллить и сфокусировать поле количества (без автозаполнения)
    els.recoGrid.querySelectorAll('.reco-item').forEach(el => {
      el.addEventListener('click', () => {
        const id  = el.getAttribute('data-id');
        const cat = el.getAttribute('data-cat');

        // раскрыть категорию
        const det = els.categories.querySelector(`details.category[data-category="${CSS.escape(cat)}"]`);
        if (det && !det.open) det.open = true;

        // найти строку товара
        const row = els.categories.querySelector(`.item-row[data-id="${CSS.escape(id)}"]`);
        if (row) {
          const input = row.querySelector('.qty-input');
          input.focus();
          row.style.outline = `2px solid var(--primary)`;
          setTimeout(()=>{ row.style.outline = 'none'; }, 600);

          const y = row.getBoundingClientRect().top + window.scrollY - 74;
          window.scrollTo({ top: y, behavior: 'smooth' });
        }
      });
    });
  }

  /* ================== UI: Развернуть/Свернуть все ================== */
  els.btnExpand.addEventListener('click', () => {
    state.expandedAll = !state.expandedAll;
    const all = Array.from(els.categories.querySelectorAll('details.category'));
    for (const d of all) d.open = state.expandedAll;
    els.btnExpand.dataset.mode = state.expandedAll ? 'close' : 'open';
    els.btnExpand.textContent   = state.expandedAll ? 'Свернуть все' : 'Развернуть все';
  });

  function updateCounter(){
    const cnt = state.cart.size;
    els.counter.textContent = `Выбрано: ${cnt} ${plural(cnt, 'позиция','позиции','позиций')}`;
  }

  /* ================== Загрузка товаров ================== */
  function normalizeProducts(raw) {
    return raw.map(x => ({
      id: x.id ?? x.product_id ?? x._id,
      name: x.name ?? x.title ?? '',
      unit: x.unit ?? x.uom ?? x.measure ?? '',
      category: x.category ?? x.group ?? 'Без категории'
    }));
  }

  async function loadProducts(){
    const data = await apiGET('/api/products'); // как в исходнике
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

  /* =============== важно: не подмешиваем цвета из Telegram ================= */
  // Никаких переопределений CSS-переменных цветов здесь не делаем.

})();
