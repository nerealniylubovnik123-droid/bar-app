(() => {
  'use strict';

  /* ---------- Helpers ---------- */
  const API_BASE = location.origin;

  function getInitData() {
    const tg = window.Telegram && window.Telegram.WebApp;
    if (tg?.initData) return tg.initData;
    if (tg?.initDataUnsafe) {
      try {
        const p = new URLSearchParams();
        const u = tg.initDataUnsafe;
        if (u.query_id) p.set('query_id', u.query_id);
        if (u.user) p.set('user', JSON.stringify(u.user));
        if (u.start_param) p.set('start_param', u.start_param);
        if (u.auth_date) p.set('auth_date', String(u.auth_date));
        if (u.hash) p.set('hash', u.hash);
        return p.toString();
      } catch {}
    }
    return '';
  }

  async function api(path, { method = 'GET', body } = {}) {
    const headers = { 'Content-Type': 'application/json', 'X-TG-INIT-DATA': getInitData() };
    const res = await fetch(API_BASE + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      const msg = (data && data.error) ? data.error : res.statusText;
      throw new Error(msg);
    }
    return data;
  }

  /* ---------- DOM ---------- */
  const formBox   = document.getElementById('form');
  const recoBox   = document.getElementById('reco');
  const btnReco   = document.getElementById('btnReco');
  const btnSubmit = document.getElementById('btnSubmit');
  const resultBox = document.getElementById('result');

  /** pid -> input element */
  const inputByPid = new Map();

  function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') el.className = v;
      else if (k === 'for') el.htmlFor = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (v !== undefined && v !== null) el.setAttribute(k, v);
    }
    for (const ch of children) {
      if (ch == null) continue;
      if (typeof ch === 'string') el.appendChild(document.createTextNode(ch));
      else el.appendChild(ch);
    }
    return el;
  }

  /* ---------- UI rendering ---------- */

  function renderGroups(products) {
    // группируем по category
    const byCat = new Map();
    for (const p of products) {
      const cat = (p.category || 'Без категории').trim();
      if (!byCat.has(cat)) byCat.set(cat, []);
      byCat.get(cat).push(p);
    }
    // сортировка внутри группы по имени
    for (const arr of byCat.values()) arr.sort((a,b) => a.name.localeCompare(b.name, 'ru'));

    const acc = h('div', { class: 'accordion' });

    inputByPid.clear();

    for (const [cat, items] of Array.from(byCat.entries()).sort((a,b)=>a[0].localeCompare(b[0], 'ru'))) {
      const body = h('div', { class: 'group-body' });

      for (const p of items) {
        const nameText = p.unit ? `${p.name} (${p.unit})` : p.name;

        const qtyInput = h('input', {
          type: 'number',
          min: '0',
          step: 'any',
          inputmode: 'decimal',
          'aria-label': `Количество ${p.name}`,
        });

        inputByPid.set(p.id, qtyInput);

        const row = h(
          'div',
          { class: 'item-row' },
          h('div', { class: 'item-name', title: p.name }, nameText),
          h('div', { class: 'item-qty' }, qtyInput)
        );

        body.appendChild(row);
      }

      const details = h(
        'details',
        {},
        h('summary', {}, `${cat} — ${items.length}`),
        body
      );
      // по умолчанию можно раскрыть, если групп немного — на твой выбор
      // details.open = true;

      acc.appendChild(details);
    }

    formBox.innerHTML = '';
    formBox.appendChild(acc);
  }

  /* ---------- Actions ---------- */

  async function load() {
    formBox.innerHTML = '<div class="card">Загрузка...</div>';
    const { products } = await api('/api/products');
    // Убираем любые поля поставщика — просто игнорируем supplier_id / supplier_name
    renderGroups(products || []);
  }

  btnReco.addEventListener('click', () => {
    // Заглушка: оставил кнопку для будущей логики рекомендаций
    // (ты напишешь правила — подключим: например, подставлять значения в inputs)
    recoBox.innerHTML = '<div class="card">Рекомендации пока не настроены. Напишите правила — подключу.</div>';
  });

  btnSubmit.addEventListener('click', async () => {
    try {
      btnSubmit.disabled = true;

      const items = [];
      inputByPid.forEach((inp, pid) => {
        const raw = String(inp.value || '').trim();
        if (!raw) return;
        const qty = Number(raw.replace(',', '.'));
        if (!Number.isFinite(qty) || qty <= 0) return;
        items.push({ product_id: pid, qty });
      });

      if (items.length === 0) {
        alert('Введите количества хотя бы для одного товара');
        return;
      }

      const res = await api('/api/requisitions', { method: 'POST', body: { items } });

      resultBox.style.display = '';
      resultBox.innerHTML = `<b>Заявка создана.</b><br/>Номер: ${res.id ?? '(см. админ-панель)'}`;

      // очистка
      inputByPid.forEach(inp => inp.value = '');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      alert('Ошибка: ' + e.message);
    } finally {
      btnSubmit.disabled = false;
    }
  });

  /* ---------- Init ---------- */
  try { window.Telegram?.WebApp?.ready?.(); } catch {}
  load().catch(e => { formBox.innerHTML = '<div class="card error">Ошибка: ' + e.message + '</div>'; });
})();
