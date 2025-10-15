/* Страница сотрудника — компактный и устойчивый кёрнел логики без привязки к поставщикам.
   Визуальные требования:
   - Товар и поле количества в одной строке (реализовано в HTML-карточках).
   - Категории сворачиваются (details/summary).
   - Информация о поставщике полностью исключена из UI.

   ЗАМЕТКИ:
   - Ожидается, что API вернёт список товаров с полями как минимум:
     { id, name, category, unit } — лишние поля игнорируются.
   - Эндпоинты можно подправить в CONFIG при необходимости (оставлены максимально «безопасные» значения).
*/

(function(){
  const CONFIG = {
    PRODUCTS_URL: '/api/products',     // список всех товаров
    SEND_URL:     '/api/requests',     // отправка заявки
  };

  const state = {
    products: [],          // сырой список товаров
    categories: [],        // уникальные категории
    filter: '',            // строка поиска
    cart: new Map(),       // productId -> qty (число)
  };

  const els = {
    categories: document.getElementById('categories'),
    search:     document.getElementById('search'),
    btnClear:   document.getElementById('btnClear'),
    btnExpand:  document.getElementById('btnExpand'),
    btnSend:    document.getElementById('btnSend'),
    counter:    document.getElementById('selectedCounter'),
  };

  // Telegram WebApp тема (не обязательно, но красиво)
  try {
    const tp = window.Telegram?.WebApp?.themeParams || {};
    const root = document.documentElement;
    if (tp.bg_color)          root.style.setProperty('--bg', tp.bg_color);
    if (tp.text_color)        root.style.setProperty('--text', tp.text_color);
    if (tp.hint_color)        root.style.setProperty('--text-muted', tp.hint_color);
    if (tp.button_color)      root.style.setProperty('--primary', tp.button_color);
    if (tp.button_text_color) root.style.setProperty('--btn-tx', tp.button_text_color);
  } catch {}

  // Утилиты
  const norm = s => (s || '').toString().trim().toLowerCase();
  const by = (k) => (a,b) => (a[k]||'').localeCompare(b[k]||'', 'ru', {sensitivity:'base'});

  function safeNum(v, def=0){
    const n = Number(v);
    return Number.isFinite(n) ? n : def;
  }

  function groupByCategory(items){
    const map = new Map();
    for (const p of items){
      const cat = p.category || 'Без категории';
      if(!map.has(cat)) map.set(cat, []);
      map.get(cat).push(p);
    }
    for(const arr of map.values()){
      arr.sort(by('name'));
    }
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
      const openAttr = 'open'; // По умолчанию открыты
      return `
        <details class="category" ${openAttr} data-category="${escapeHtml(cat)}">
          <summary>
            <span>${escapeHtml(cat)}</span>
            <span class="meta">
              <span class="badge">${list.length}</span>
            </span>
          </summary>
          <div class="items">
            ${items}
          </div>
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
        <div class="item-title">
          ${escapeHtml(p.name)} ${unit}
        </div>
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
        input.value = next;
        state.cart.set(id, next);
        updateCounter();
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

  function plural(n, one, few, many){
    n = Math.abs(n) % 100;
    const n1 = n % 10;
    if (n>10 && n<20) return many;
    if (n1>1 && n1<5) return few;
    if (n1===1) return one;
    return many;
  }

  function escapeHtml(s){
    return (s ?? '').toString()
      .replaceAll('&','&amp;')
      .replaceAll('<','&lt;')
      .replaceAll('>','&gt;')
      .replaceAll('"','&quot;')
      .replaceAll("'",'&#39;');
  }

  // Поиск
  els.search.addEventListener('input', () => {
    state.filter = els.search.value || '';
    render();
  });

  // Сброс
  els.btnClear.addEventListener('click', () => {
    state.filter = '';
    state.cart.clear();
    els.search.value = '';
    render();
  });

  // Развернуть/свернуть все
  els.btnExpand.addEventListener('click', () => {
    const mode = els.btnExpand.dataset.mode || 'open';
    const all = Array.from(els.categories.querySelectorAll('details.category'));
    const open = mode === 'open';
    for (const d of all) d.open = open;
    els.btnExpand.dataset.mode = open ? 'close' : 'open';
    els.btnExpand.textContent = open ? 'Свернуть все' : 'Развернуть все';
  });

  // Отправка заявки
  els.btnSend.addEventListener('click', async () => {
    const items = Array.from(state.cart.entries()).map(([product_id, qty]) => ({
      product_id: typeof product_id === 'string' && /^\d+$/.test(product_id) ? Number(product_id) : product_id,
      qty
    }));
    if (!items.length){
      toast('Вы не выбрали ни одного товара.');
      return;
    }

    els.btnSend.disabled = true;
    try{
      const res = await fetch(CONFIG.SEND_URL, {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ items })
      });
      if(!res.ok) throw new Error(`HTTP ${res.status}`);
      // Успех
      toast('Заявка отправлена ✅');
      state.cart.clear();
      render();
    }catch(err){
      console.error(err);
      toast('Не удалось отправить заявку. Попробуйте позже.');
    }finally{
      els.btnSend.disabled = false;
    }
  });

  // Простой toast без зависимостей
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
    el._t = setTimeout(()=> {
      el.style.opacity = '0';
    }, 2200);
  }

  // Загрузка товаров
  (async function init(){
    try{
      const res = await fetch(CONFIG.PRODUCTS_URL);
      if(!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      // Нормализация: ожидаем массив товаров
      state.products = Array.isArray(data) ? data.map(x => ({
        id: x.id ?? x.product_id ?? x._id,
        name: x.name ?? x.title ?? '',
        category: x.category ?? x.group ?? 'Без категории',
        unit: x.unit ?? x.uom ?? x.measure ?? ''
      })) : [];

      render();

    }catch(err){
      console.error(err);
      els.categories.innerHTML = `<div class="empty">Ошибка загрузки товаров.</div>`;
    }
  })();
})();
