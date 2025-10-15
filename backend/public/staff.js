/* Страница сотрудника — версия с авто-подбором API и устойчивым парсингом ответа.
   Что изменил:
   - Убрал жёсткий эндпоинт. Добавил discoverProductsAPI(): перебирает список типовых путей.
   - extractProducts(): извлекает товары из любых популярных структур ответа.
   - Гибкая нормализация полей (id|product_id|_id, name|title, category|group|category_name, unit|uom|measure).
   - Подробный текст ошибки с подсказками (чтобы не теряться, если API защищён).
*/

(function(){
  // Кнопка «Отправить» оставлена как есть. При необходимости обнаружения также можно расширить (см. TODO ниже).
  const SEND_ENDPOINTS = [
    '/api/requests',
    '/api/request',
    '/api/orders',
    '/api/order',
    '/requests',
  ];

  const state = {
    products: [],
    filter: '',
    cart: new Map(),
    discoveredProductsURL: null,
    discoveredSendURL: null,
  };

  const els = {
    categories: document.getElementById('categories'),
    search:     document.getElementById('search'),
    btnClear:   document.getElementById('btnClear'),
    btnExpand:  document.getElementById('btnExpand'),
    btnSend:    document.getElementById('btnSend'),
    counter:    document.getElementById('selectedCounter'),
  };

  // Telegram WebApp тема (опционально)
  try {
    const tp = window.Telegram?.WebApp?.themeParams || {};
    const root = document.documentElement;
    if (tp.bg_color)          root.style.setProperty('--bg', tp.bg_color);
    if (tp.text_color)        root.style.setProperty('--text', tp.text_color);
    if (tp.hint_color)        root.style.setProperty('--text-muted', tp.hint_color);
    if (tp.button_color)      root.style.setProperty('--primary', tp.button_color);
    if (tp.button_text_color) root.style.setProperty('--btn-tx', tp.button_text_color);
  } catch {}

  // ====================== ВСПОМОГАТЕЛЬНОЕ ======================
  const norm = s => (s || '').toString().trim().toLowerCase();
  const by   = k => (a,b)=>(a[k]||'').localeCompare(b[k]||'','ru',{sensitivity:'base'});
  function safeNum(v, def=0){ const n = Number(v); return Number.isFinite(n) ? n : def; }
  function escapeHtml(s){
    return (s ?? '').toString()
      .replaceAll('&','&amp;').replaceAll('<','&lt;')
      .replaceAll('>','&gt;').replaceAll('"','&quot;')
      .replaceAll("'",'&#39;');
  }
  function plural(n, one, few, many){
    n = Math.abs(n) % 100; const n1 = n % 10;
    if (n>10 && n<20) return many; if (n1>1 && n1<5) return few; if (n1===1) return one; return many;
  }

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

  // ====================== РЕНДЕР ======================
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

  function render(){
    const q = norm(state.filter);
    const filtered = q
      ? state.products.filter(p => norm(p.name).includes(q) || norm(p.category).includes(q))
      : state.products.slice();

    const grouped = groupByCategory(filtered);

    if(!grouped.length){
      els.categories.innerHTML = `<div class="empty">Ничего не найдено по запросу «${escapeHtml(state.filter)}»</div>`;
      updateCounter();
      return;
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

  function itemRowHtml(p){
    const qty = state.cart.get(p.id) ?? '';
    const unit = p.unit ? `<span class="item-unit">(${escapeHtml(p.unit)})</span>` : '';
    return `
      <div class="item-row" data-id="${String(p.id)}">
        <div class="item-title">${escapeHtml(p.name)} ${unit}</div>
        <div class="qty">
          <button class="btn btn--ghost btn-dec" type="button">−</button>
          <input type="number" class="qty-input" inputmode="decimal" min="0" step="0.5" placeholder="0" value="${qty}"/>
          <button class="btn btn--ghost btn-inc" type="button">+</button>
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

  function stepFor(input){
    const s = safeNum(input.getAttribute('step'), 1);
    return s > 0 ? s : 1;
  }

  function updateCounter(){
    const cnt = state.cart.size;
    els.counter.textContent = `Выбрано: ${cnt} ${plural(cnt, 'позиция','позиции','позиций')}`;
  }

  // ====================== API АВТООБНАРУЖЕНИЕ ======================
  const PRODUCT_ENDPOINTS = [
    '/api/products',
    '/api/products/all',
    '/api/public/products',
    '/api/public/catalog',
    '/api/catalog',
    '/api/catalog/products',
    '/api/items',
    '/api/goods',
    '/api/menu',
    '/api/positions',
    '/products'
  ];

  async function tryFetchJson(url){
    const res = await fetch(url, { credentials: 'same-origin' });
    const ct = res.headers.get('content-type') || '';
    if(!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    if(!/application\/json|text\/json/i.test(ct)){
      // иногда сервер отдаёт JSON без корректного content-type — попробуем всё равно
      try { return await res.json(); } catch { throw new Error(`Некорректный Content-Type (${ct})`); }
    }
    return res.json();
  }

  function isNonEmptyArray(x){ return Array.isArray(x) && x.length > 0; }

  // Пробуем извлечь массив товаров из разных структур
  function extractProducts(payload){
    if (!payload) return [];

    // 1) Сам массив
    if (isNonEmptyArray(payload)) return payload;

    // 2) Ключи верхнего уровня
    const keys = Object.keys(payload);
    for (const k of ['products','items','data','list','result']){
      if (isNonEmptyArray(payload[k])) return payload[k];
    }

    // 3) Категории с вложенными товарами
    for (const k of ['categories','groups','sections']){
      const cats = payload[k];
      if (isNonEmptyArray(cats)){
        const out = [];
        for (const c of cats){
          const cname = c.name || c.title || c.category || c.group || 'Без категории';
          const arr = c.items || c.products || c.list || c.data || [];
          if (Array.isArray(arr)){
            for (const it of arr){
              // помечаем категорию, если в элементе нет
              if (!it.category && !it.group) it._categoryFromParent = cname;
              out.push(it);
            }
          }
        }
        if (out.length) return out;
      }
    }

    // 4) Объект-обёртка с единственным массивом
    if (keys.length === 1 && isNonEmptyArray(payload[keys[0]])) return payload[keys[0]];

    return [];
  }

  function normalizeProduct(x){
    const id = x.id ?? x.product_id ?? x._id ?? x.code ?? x.sku ?? String(Math.random()).slice(2);
    const name = x.name ?? x.title ?? x.product ?? x.item ?? '';
    const category = x.category ?? x.group ?? x.category_name ?? x.section ?? x._categoryFromParent ?? 'Без категории';
    const unit = x.unit ?? x.uom ?? x.measure ?? x.measurement ?? x.unit_name ?? '';
    return { id, name, category, unit };
  }

  async function discoverProductsAPI(){
    const tried = [];
    for (const url of PRODUCT_ENDPOINTS){
      try{
        const data = await tryFetchJson(url);
        const raw = extractProducts(data);
        if (raw.length){
          state.discoveredProductsURL = url;
          return raw.map(normalizeProduct);
        }
        tried.push(`${url} (пусто)`);
      }catch(e){
        tried.push(`${url} (${e.message})`);
      }
    }
    const hint = tried.map(s => `• ${s}`).join('\n');
    throw new Error(`Не удалось обнаружить список товаров.\nПроверено:\n${hint}`);
  }

  async function discoverSendAPI(){
    for (const url of SEND_ENDPOINTS){
      try{
        // «мягкая» проверка методом OPTIONS (может не поддерживаться — тогда просто возьмём путь на веру)
        const ok = await fetch(url, { method:'OPTIONS' }).then(()=>true).catch(()=>false);
        if (ok) return url;
      }catch{}
    }
    // если ничего не подтвердилось — берём первый как дефолт
    return SEND_ENDPOINTS[0];
  }

  // ====================== ДЕЙСТВИЯ UI ======================
  els.search.addEventListener('input', () => {
    state.filter = els.search.value || '';
    render();
  });

  els.btnClear.addEventListener('click', () => {
    state.filter = '';
    state.cart.clear();
    els.search.value = '';
    render();
  });

  els.btnExpand.addEventListener('click', () => {
    const mode = els.btnExpand.dataset.mode || 'open';
    const all = Array.from(els.categories.querySelectorAll('details.category'));
    const open = mode === 'open';
    for (const d of all) d.open = open;
    els.btnExpand.dataset.mode = open ? 'close' : 'open';
    els.btnExpand.textContent = open ? 'Свернуть все' : 'Развернуть все';
  });

  els.btnSend.addEventListener('click', async () => {
    const items = Array.from(state.cart.entries()).map(([product_id, qty]) => ({
      product_id: (/^\d+$/.test(String(product_id))) ? Number(product_id) : product_id,
      qty
    }));
    if (!items.length){
      toast('Вы не выбрали ни одного товара.');
      return;
    }

    els.btnSend.disabled = true;
    try{
      const url = state.discoveredSendURL || await discoverSendAPI();
      state.discoveredSendURL = url;

      const res = await fetch(url, {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ items })
      });
      if(!res.ok) throw new Error(`HTTP ${res.status}`);
      toast('Заявка отправлена ✅');
      state.cart.clear();
      render();
    }catch(err){
      console.error(err);
      toast('Не удалось отправить заявку. Проверьте подключение и попробуйте снова.');
    }finally{
      els.btnSend.disabled = false;
    }
  });

  // ====================== ИНИЦИАЛИЗАЦИЯ ======================
  (async function init(){
    try{
      const list = await discoverProductsAPI();
      state.products = list;
      render();
    }catch(err){
      console.error(err);
      const msg = [
        'Ошибка загрузки товаров.',
        '',
        'Подсказки:',
        '• Убедитесь, что вы авторизованы (если страница открывается как Telegram WebApp — всё ок).',
        '• Проверьте, не требует ли бэкенд токен/заголовок.',
        '• В server.cjs убедитесь, что есть публичный GET эндпоинт, который возвращает JSON с товарами.',
        '',
        'Техническая справка:',
        String(err.message || err)
      ].join('\n');
      els.categories.innerHTML = `<div class="empty" style="white-space:pre-wrap; text-align:left">${escapeHtml(msg)}</div>`;
    }
  })();
})();
