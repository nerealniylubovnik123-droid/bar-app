(() => {
  'use strict';
  const API_BASE = location.origin;

  // --- извлекаем initData из разных мест (SDK/unsafe/hash) ---
  function getInitData() {
    const w = window;
    const tg = w.Telegram && w.Telegram.WebApp;
    if (tg && typeof tg.initData === 'string' && tg.initData.length > 0) return tg.initData;

    if (tg && tg.initDataUnsafe && typeof tg.initDataUnsafe === 'object') {
      try {
        const p = new URLSearchParams();
        if (tg.initDataUnsafe.query_id) p.set('query_id', tg.initDataUnsafe.query_id);
        if (tg.initDataUnsafe.user) p.set('user', JSON.stringify(tg.initDataUnsafe.user));
        if (tg.initDataUnsafe.start_param) p.set('start_param', tg.initDataUnsafe.start_param);
        if (tg.initDataUnsafe.auth_date) p.set('auth_date', String(tg.initDataUnsafe.auth_date));
        if (tg.initDataUnsafe.hash) p.set('hash', tg.initDataUnsafe.hash);
        const s = p.toString();
        if (s && p.get('hash')) return s;
      } catch (e) {}
    }
    if (location.hash && location.hash.includes('tgWebAppData=')) {
      try {
        const h = new URLSearchParams(location.hash.slice(1));
        const raw = h.get('tgWebAppData'); // query_id=...&user=...&hash=...
        if (raw) return decodeURIComponent(raw);
      } catch (e) {}
    }
    return '';
  }
  const TG_INIT = getInitData();

  // --- универсальный запрос к API: initData не в заголовках! ---
  async function api(path, { method='GET', body } = {}) {
    const url = new URL(API_BASE + path);
    if (method === 'GET' && TG_INIT) {
      url.searchParams.set('initData', encodeURIComponent(TG_INIT));
    }
    const res = await fetch(url.toString(), {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: method === 'POST'
        ? JSON.stringify({ ...(body || {}), initData: TG_INIT })
        : undefined
    });
    let json = {}; try { json = await res.json(); } catch {}
    if (!res.ok || json?.ok === false) throw new Error(json?.error || res.statusText || 'Request failed');
    return json;
  }

  // --- helpers ---
  const $ = s => document.querySelector(s);
  function el(t, a={}, ...c){ const e=document.createElement(t); for(const[k,v]of Object.entries(a)){ if(k==='className')e.className=v; else if(k==='html')e.innerHTML=v; else e.setAttribute(k,v);} for(const x of c){ e.appendChild(typeof x==='string'?document.createTextNode(x):x);} return e; }
  const btn=(t, on)=>{ const b=el('button',{className:'btn',type:'button'},t); if(on)b.addEventListener('click',on); return b; };

  const boxWarn = $('#warning');
  const boxSup = $('#suppliers');
  const boxProd = $('#products');
  const boxReq = $('#requisitions');

  async function loadSuppliers() {
    const data = await api('/api/admin/suppliers');
    boxSup.innerHTML = '';
    (data.suppliers || []).forEach(s => {
      const row = el('div', { className:'card spaced' },
        el('div', {}, `#${s.id} — ${s.name}`),
        s.contact_note ? el('div', { className:'muted' }, s.contact_note) : '',
        btn('Удалить', async () => {
          if (!confirm(`Удалить поставщика "${s.name}"?`)) return;
          try { await api(`/api/admin/suppliers/${s.id}`, { method:'DELETE' }); await loadSuppliers(); await loadProducts(); }
          catch(e){ alert(e.message); }
        })
      );
      boxSup.appendChild(row);
    });
  }

  async function loadProducts() {
    const data = await api('/api/admin/products');
    boxProd.innerHTML = '';
    (data.products || []).forEach(p => {
      const row = el('div', { className:'card spaced' },
        el('div', {}, `#${p.id} — ${p.name} (${p.unit}), пост.: ${p.supplier_name}`),
        p.category ? el('div', { className:'muted' }, `Категория: ${p.category}`) : '',
        btn('Удалить', async () => {
          if (!confirm(`Удалить товар "${p.name}"?`)) return;
          try { await api(`/api/admin/products/${p.id}`, { method:'DELETE' }); await loadProducts(); }
          catch(e){ alert(e.message); }
        })
      );
      boxProd.appendChild(row);
    });
  }

  async function loadRequisitions() {
    const data = await api('/api/admin/requisitions');
    boxReq.innerHTML = '';
    (data.requisitions || []).forEach(r => {
      const row = el('div', { className:'card spaced' },
        el('div', {}, `#${r.id} — ${r.status_ru || r.status} — ${r.user_name || 'сотрудник'} — ${r.created_at || ''}`),
        btn('Открыть', async () => {
          try {
            const det = await api(`/api/admin/requisitions/${r.id}`);
            const orders = det.orders || [];
            alert(
              orders.length
                ? orders.map(o => `• ${o.supplier.name} (${o.status_ru || o.status})\n` + o.items.map(i => `  - ${i.product_name}: ${i.qty_final} ${i.unit || ''}`).join('\n')).join('\n\n')
                : 'Нет заказов'
            );
          } catch (e) { alert(e.message); }
        })
      );
      boxReq.appendChild(row);
    });
  }

  async function boot() {
    // Если страница открыта не как WebApp — честно скажем об этом
    if (!TG_INIT) {
      boxWarn.style.display = 'block';
      boxWarn.innerHTML = `
        <b>Ошибка: Missing initData</b><br/>
        Откройте эту страницу через кнопку <i>«Админ-панель»</i> (WebApp) в вашем боте
        или временно включите DEV_ALLOW_UNSAFE=true на сервере для теста в браузере.
      `;
      return;
    }

    // Кнопки добавления
    $('#btnAddSup')?.addEventListener('click', async () => {
      const name = $('#supName').value.trim();
      const note = $('#supNote').value.trim();
      if (name.length < 2) return alert('Название слишком короткое');
      try {
        await api('/api/admin/suppliers', { method:'POST', body:{ name, contact_note: note } });
        $('#supName').value = ''; $('#supNote').value = '';
        await loadSuppliers();
      } catch (e) { alert(e.message); }
    });

    $('#btnAddProd')?.addEventListener('click', async () => {
      const name = $('#prodName').value.trim();
      const unit = $('#prodUnit').value.trim();
      const category = $('#prodCategory').value.trim() || 'Общее';
      const supplier_id = Number($('#prodSupplierId').value);
      if (name.length < 2) return alert('Название слишком короткое');
      if (!unit) return alert('Ед. изм. обязательна');
      if (!Number.isFinite(supplier_id)) return alert('Неверный ID поставщика');
      try {
        await api('/api/admin/products', { method:'POST', body:{ name, unit, category, supplier_id } });
        $('#prodName').value = ''; $('#prodUnit').value=''; $('#prodCategory').value=''; $('#prodSupplierId').value='';
        await loadProducts();
      } catch (e) { alert(e.message); }
    });

    await Promise.all([loadSuppliers(), loadProducts(), loadRequisitions()]);
  }

  try { window.Telegram?.WebApp?.ready?.(); } catch {}
  boot().catch(e => { alert('Ошибка загрузки: ' + e.message); });
})();
