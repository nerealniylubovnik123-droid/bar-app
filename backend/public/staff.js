/* staff.js — скрываем поставщиков на UI, добавляем сворачиваемые категории.
   API/БД не меняем. Совместимо с текущим бэком.
*/
(function () {
  const tg = window.Telegram && window.Telegram.WebApp;
  if (tg && tg.expand) tg.expand();

  // -------- initData (как в проекте: query -> Telegram -> localStorage)
  function getInitData() {
    try {
      const url = new URL(window.location.href);
      const fromQuery = url.searchParams.get('initData');
      if (fromQuery) return fromQuery;
      if (tg && tg.initData) return tg.initData;
      const fromStorage = localStorage.getItem('tg_initData');
      return fromStorage || '';
    } catch(e) { return ''; }
  }
  const initData = getInitData();
  if (initData) { try { localStorage.setItem('tg_initData', initData); } catch(_) {} }

  // -------- helpers
  const $ = (sel, root = document) => root.querySelector(sel);
  const meBox = $('#meBox');
  const errBox = $('#err');
  const okBox  = $('#ok');
  const suppliersContainer = $('#suppliersContainer');
  const submitBtn = $('#submitBtn');
  const clearBtn = $('#clearBtn');
  const itemsCountEl = $('#itemsCount');

  let me = null;
  let products = []; // [{id, name, unit, supplier_id, supplier_name?}]
  let qtyMap = new Map(); // product_id -> number

  function showErr(msg) {
    errBox.textContent = msg; errBox.style.display = 'block'; okBox.style.display = 'none';
  }
  function showOk(msg) {
    okBox.textContent = msg; okBox.style.display = 'block'; errBox.style.display = 'none';
  }
  function clearMsgs() { errBox.style.display = 'none'; okBox.style.display = 'none'; }

  async function apiGet(url) {
    const sep = url.includes('?') ? '&' : '?';
    const res = await fetch(`${url}${sep}initData=${encodeURIComponent(initData)}`, {
      credentials: 'same-origin'
    });
    if (!res.ok) throw new Error(`GET ${url}: ${res.status}`);
    return res.json();
  }
  async function apiPost(url, body) {
    const payload = Object.assign({ initData }, body || {});
    const res = await fetch(url, {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      let txt = await res.text().catch(() => '');
      throw new Error(txt || `POST ${url}: ${res.status}`);
    }
    return res.json();
  }

  // -------- render (группируем "по поставщику", но не показываем его название)
  function render() {
    suppliersContainer.innerHTML = '';

    // Группы: ключ = supplier_id (строкой, чтобы был стабильный ключ), имя не показываем
    const bySupplier = new Map();
    for (const p of products) {
      const key = String(p.supplier_id ?? 'null');
      if (!bySupplier.has(key)) bySupplier.set(key, []);
      bySupplier.get(key).push(p);
    }

    let idx = 0;
    for (const [, list] of bySupplier.entries()) {
      idx += 1;
      const catTitle = `Категория ${idx}`;
      const itemsCount = list.length;

      // <details> как контейнер категории
      const details = document.createElement('details');
      details.className = 'supplier-section';
      details.open = true;

      // summary с собственной шапкой и кнопкой "Сбросить"
      const summary = document.createElement('summary');
      const head = document.createElement('div');
      head.className = 'supplier-head';
      head.innerHTML = `
        <h2 class="supplier-title">
          <span class="caret" aria-hidden="true"></span>
          ${escapeHtml(catTitle)} <span class="muted">• ${itemsCount} поз.</span>
        </h2>
        <button class="btn" type="button" data-supplier-clear>Сбросить</button>
      `;
      summary.appendChild(head);
      details.appendChild(summary);

      // сетка товаров
      const grid = document.createElement('div');
      grid.className = 'products';

      for (const p of list) {
        const card = document.createElement('div');
        card.className = 'product';
        card.dataset.productId = String(p.id);

        const name = document.createElement('div');
        name.className = 'product-name';
        name.textContent = p.name;

        const meta = document.createElement('div');
        meta.className = 'product-meta';
        const unit = p.unit ? `ед.: ${p.unit}` : '';
        // ВНИМАНИЕ: НИКАКОЙ ИНФОРМАЦИИ О ПОСТАВЩИКЕ В UI
        meta.innerHTML = `
          <span class="muted">ID ${p.id}</span>
          ${unit ? `<span>${escapeHtml(unit)}</span>` : ''}
        `;

        const qtyRow = document.createElement('div');
        qtyRow.className = 'qty-row';

        const input = document.createElement('input');
        input.type = 'number';
        input.inputMode = 'decimal';
        input.min = '0';
        input.step = '0.01';
        input.placeholder = '0';
        input.className = 'qty-input';
        input.value = qtyMap.get(p.id) ?? '';

        const controls = document.createElement('div');
        controls.className = 'qty-controls';
        const minus = document.createElement('button');
        minus.className = 'btn square';
        minus.type = 'button';
        minus.textContent = '−';
        const plus = document.createElement('button');
        plus.className = 'btn square';
        plus.type = 'button';
        plus.textContent = '+';

        controls.appendChild(minus);
        controls.appendChild(plus);

        qtyRow.appendChild(input);
        qtyRow.appendChild(controls);

        card.appendChild(name);
        card.appendChild(meta);
        card.appendChild(qtyRow);
        grid.appendChild(card);

        // события карточки
        input.addEventListener('input', () => {
          const val = parseFloat(String(input.value).replace(',', '.'));
          if (!isFinite(val) || val <= 0) {
            qtyMap.delete(p.id);
          } else {
            qtyMap.set(p.id, round2(val));
          }
          updateSummary();
        });
        minus.addEventListener('click', () => {
          const cur = qtyMap.get(p.id) ?? 0;
          const next = Math.max(0, round2(cur - 1));
          if (next <= 0) qtyMap.delete(p.id); else qtyMap.set(p.id, next);
          input.value = next ? String(next) : '';
          updateSummary();
        });
        plus.addEventListener('click', () => {
          const cur = qtyMap.get(p.id) ?? 0;
          const next = round2(cur + 1);
          qtyMap.set(p.id, next);
          input.value = String(next);
          updateSummary();
        });
      }

      details.appendChild(grid);
      suppliersContainer.appendChild(details);

      // Кнопка "Сбросить" не должна сворачивать/разворачивать accordion
      head.querySelector('[data-supplier-clear]').addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        for (const p of list) qtyMap.delete(p.id);
        render();
        updateSummary();
      });
    }

    updateSummary();
  }

  function updateSummary() {
    const count = Array.from(qtyMap.values()).filter(v => v > 0).length;
    itemsCountEl.textContent = String(count);
  }

  function round2(x) { return Math.round(x * 100) / 100; }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  }

  // -------- actions
  clearBtn.addEventListener('click', () => {
    qtyMap.clear();
    render();
    updateSummary();
  });

  submitBtn.addEventListener('click', async () => {
    clearMsgs();
    const items = Array.from(qtyMap.entries())
      .filter(([, qty]) => qty > 0)
      .map(([product_id, qty]) => ({ product_id, qty }));

    if (items.length === 0) {
      showErr('Вы не указали количество ни по одной позиции.');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Отправка...';
    try {
      const res = await apiPost('/api/requisitions', { items });
      showOk(`Заявка №${res.requisition_id} оформлена. Создано заказов: ${res.orders?.length ?? '—'}.`);
      qtyMap.clear();
      render();
      if (tg && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
    } catch (e) {
      showErr(e.message || 'Ошибка при отправке заявки');
      if (tg && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Отправить заявку';
    }
  });

  // -------- bootstrap
  (async function boot() {
    try {
      const meResp = await apiGet('/api/me');
      me = meResp;
      meBox.textContent = `${me?.name || 'Сотрудник'}`;
    } catch {
      meBox.textContent = 'Сотрудник';
    }

    try {
      const list = await apiGet('/api/products');
      // ожидается: [{id,name,unit,supplier_id,supplier_name,active:true}]
      products = (Array.isArray(list) ? list : []).filter(p => !p.disabled);
      render();
    } catch (e) {
      showErr('Не удалось загрузить товары. Обновите страницу.');
    }
  })();
})();
