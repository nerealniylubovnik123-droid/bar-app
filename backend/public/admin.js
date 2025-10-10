(() => {
  'use strict';
  const API_BASE = location.origin;
  // initData из Telegram WebApp SDK (если открыто в Telegram)
  const TG_INIT = (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData) || '';

  async function api(path, { method='GET', body, headers={} } = {}) {
    const res = await fetch(API_BASE + path, {
      method,
      headers: { 'Content-Type':'application/json', 'X-TG-INIT-DATA': TG_INIT, ...headers },
      body: body ? JSON.stringify(body) : undefined
    });
    let json = {}; try { json = await res.json(); } catch {}
    if (!res.ok || json?.ok === false) throw new Error(json?.error || res.statusText || 'Request failed');
    return json;
  }

  const el = (t, a = {}, ...c) => {
    const e = document.createElement(t);
    for (const [k, v] of Object.entries(a)) {
      if (k === 'className') e.className = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    }
    for (const x of c) e.appendChild(typeof x === 'string' ? document.createTextNode(x) : x);
    return e;
  };
  const badge = (t) => el('span', { className: 'badge' }, t);
  const btn = (t, on, { disabled=false }={}) => { const b = el('button', { className: 'btn', type:'button' }, t); b.disabled=disabled; if (on) b.addEventListener('click', on); return b; };
  const h3 = (t) => el('h3', {}, t);
  const note = (t) => el('div', { className:'small' }, t);

  // --- каркас страниц ---
  document.body.innerHTML = '';
  const header = el('header', { className: 'container' }, el('h2', {}, 'Админка'));
  const nav = el('div', { className: 'container spaced' },
    el('a', { href:'#', id:'nav-list', className:'link' }, 'Заявки'),
    document.createTextNode(' · '),
    el('a', { href:'#', id:'nav-catalog', className:'link' }, 'Справочники')
  );
  const screenList   = el('div', { id:'screen-list', className:'container' });
  const screenDetail = el('div', { id:'screen-detail', className:'container', style:'display:none' });
  const screenCatalog = el('div', { id:'screen-catalog', className:'container', style:'display:none' });
  document.body.append(header, nav, screenList, screenDetail, screenCatalog);

  const show = (name) => {
    screenList.style.display   = name==='list'    ? 'block' : 'none';
    screenDetail.style.display = name==='detail'  ? 'block' : 'none';
    screenCatalog.style.display= name==='catalog' ? 'block' : 'none';
  };

  // --- русские подписи статусов ---
  const RU_REQ = { created: 'создана', processed: 'обработана' };
  const RU_ORD = { draft: 'черновик', approved: 'утвержден', ordered: 'заказан', received: 'получен' };

  // --- заявки (список) ---
  async function loadRequisitions() {
    screenList.innerHTML = '';
    screenList.appendChild(h3('Заявки'));
    try {
      const data = await api('/api/admin/requisitions');
      const list = el('div', { className:'list' });
      (data.requisitions || []).forEach(r => {
        const card = el('div', { className:'card spaced' },
          el('div', { className:'spaced' }, el('b', {}, `Заявка #${r.id}`), badge(r.status_ru || RU_REQ[r.status] || r.status)),
          note(`Создана: ${new Date(r.created_at).toLocaleString()} • Автор: ${r.user_name || '—'}`),
          btn('Открыть', () => openRequisition(r.id))
        );
        list.appendChild(card);
      });
      if (!data.requisitions?.length) list.appendChild(note('Пока нет заявок.'));
      screenList.appendChild(list);
    } catch (e) {
      screenList.appendChild(el('div', { className:'error' }, 'Ошибка: ' + e.message));
    }
  }

  // --- заявка (детали) ---
  async function openRequisition(id) {
    show('detail');
    screenDetail.innerHTML = '';
    screenDetail.appendChild(h3(`Заявка #${id}`));
    screenDetail.appendChild(btn('← Назад', () => { show('list'); }, {}));
    try {
      const data = await api(`/api/admin/requisitions/${id}`);
      (data.orders || []).forEach(ord => {
        const box = el('div', { className:'card' },
          el('div', { className:'spaced' }, el('b', {}, ord.supplier?.name || 'Поставщик'), badge(ord.status_ru || RU_ORD[ord.status] || ord.status)),
        );
        const statuses = ['draft','approved','ordered','received'];
        const controls = el('div', { className:'spaced' }, note('Статус:'));
        statuses.forEach(s => {
          controls.appendChild(btn(RU_ORD[s] || s, async () => {
            try { await api(`/api/admin/orders/${ord.order_id}/status`, { method:'POST', body:{ status:s } }); await openRequisition(id); }
            catch (e) { alert(e.message); }
          }, { disabled: s===ord.status }));
        });
        box.appendChild(controls);

        const table = el('table', {});
        table.createTHead().innerHTML = `<tr><th>Товар</th><th>Ед.</th><th>Запрошено</th><th>Финально</th><th>Примечание</th><th></th></tr>`;
        const tb = table.createTBody();
        (ord.items || []).forEach(it => {
          const tr = tb.insertRow();
          tr.insertCell().textContent = it.product_name;
          tr.insertCell().textContent = it.unit || '';
          tr.insertCell().textContent = it.qty_requested;
          const fin = el('input', { value: String(it.qty_final ?? it.qty_requested), style:'width:80px' });
          const noteIn = el('input', { value: it.note || '', placeholder: 'Примечание' });
          tr.insertCell().appendChild(fin);
          tr.insertCell().appendChild(noteIn);
          tr.insertCell().appendChild(btn('Сохранить', async () => {
            try { await api(`/api/admin/orders/${ord.order_id}/items/${it.item_id}`, { method:'POST', body:{ qty_final:Number(fin.value), note:noteIn.value } }); alert('Сохранено'); }
            catch (e) { alert(e.message); }
          }));
        });
        box.appendChild(table);
        screenDetail.appendChild(box);
      });
    } catch (e) {
      screenDetail.appendChild(el('div', { className:'error' }, 'Ошибка: ' + e.message));
    }
  }

  // --- Справочники (каталог) ---
  screenCatalog.appendChild(h3('Справочники'));

  // Поставщики
  const supForm = el('form', { className:'spaced' });
  const supName = el('input', { placeholder:'Название поставщика', required:true });
  const supNote = el('input', { placeholder:'Контакты/примечание' });
  const supSubmit = el('button', { className:'btn', type:'submit' }, 'Добавить');
  supForm.append(supName, supNote, supSubmit);
  const supList = el('div', { className:'list', style:'margin-top:.5rem' });

  // Товары
  const prodForm = el('form', { className:'spaced' });
  const prodName = el('input', { placeholder:'Название товара', required:true });
  const prodUnit = el('input', { placeholder:'Ед. изм. (кг/шт/л…)', required:true });
  const prodCat  = el('input', { placeholder:'Категория', value:'Общее' });
  const prodSupplier = el('select', { required:true });
  const prodSubmit = el('button', { className:'btn', type:'submit' }, 'Добавить');
  prodForm.append(prodName, prodUnit, prodCat, prodSupplier, prodSubmit);
  const prodList = el('div', { className:'list', style:'margin-top:.5rem' });

  screenCatalog.append(
    el('div', { className:'card' }, h3('Поставщики'), supForm, supList),
    el('div', { className:'card' }, h3('Товары'), prodForm, prodList),
  );

  async function loadCatalog() {
    supList.innerHTML = '';
    prodList.innerHTML = '';
    try {
      const [supData, prodData] = await Promise.all([
        api('/api/admin/suppliers'),
        api('/api/admin/products'),
      ]);

      // селект поставщиков
      prodSupplier.innerHTML = '';
      (supData.suppliers || []).filter(s => s.active).forEach(s => {
        prodSupplier.appendChild(el('option', { value: s.id }, s.name));
      });

      // список поставщиков
      (supData.suppliers || []).forEach(s => {
        const card = el('div', { className:'card spaced' },
          el('div', { className:'spaced' }, el('b', {}, s.name), el('span', { className:'badge' }, s.active ? 'активен':'неактивен')),
          note(s.contact_note || '')
        );
        card.appendChild(btn('Удалить', async () => {
          if (!confirm('Удалить поставщика?')) return;
          try { await api(`/api/admin/suppliers/${s.id}`, { method:'DELETE' }); await loadCatalog(); }
          catch (e) { alert(e.message); }
        }));
        supList.appendChild(card);
      });

      // список товаров
      (prodData.products || []).forEach(p => {
        const card = el('div', { className:'card spaced' },
          el('div', { className:'spaced' }, el('b', {}, p.name), el('span', { className:'badge' }, p.active ? 'активен':'неактивен')),
          note(`${p.unit}${p.category ? ` • ${p.category}`:''} • Поставщик: ${p.supplier_name}`)
        );
        card.appendChild(btn('Удалить', async () => {
          if (!confirm('Удалить товар?')) return;
          try { await api(`/api/admin/products/${p.id}`, { method:'DELETE' }); await loadCatalog(); }
          catch (e) { alert(e.message); }
        }));
        prodList.appendChild(card);
      });
    } catch (e) {
      screenCatalog.appendChild(el('div', { className:'error' }, 'Ошибка загрузки: ' + e.message));
    }
  }

  supForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      await api('/api/admin/suppliers', { method:'POST', body:{ name: supName.value.trim(), contact_note: supNote.value.trim() } });
      supForm.reset();
      await loadCatalog();
    } catch (e) { alert(e.message); }
  });

  prodForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      await api('/api/admin/products', { method:'POST', body:{
        name: prodName.value.trim(),
        unit: prodUnit.value.trim(),
        category: (prodCat.value || 'Общее').trim(),
        supplier_id: Number(prodSupplier.value)
      }});
      prodForm.reset();
      await loadCatalog();
    } catch (e) { alert(e.message); }
  });

  document.getElementById('nav-list').addEventListener('click', (e) => { e.preventDefault(); show('list'); loadRequisitions(); });
  document.getElementById('nav-catalog').addEventListener('click', (e) => { e.preventDefault(); show('catalog'); loadCatalog(); });

  show('catalog');
  loadCatalog();
})();
