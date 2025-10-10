(() => {
  'use strict';
  const API_BASE = location.origin;

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
        const raw = h.get('tgWebAppData');
        if (raw) return decodeURIComponent(raw);
      } catch (e) {}
    }
    return '';
  }
  const TG_INIT = getInitData();

  async function api(path, { method='GET', body } = {}) {
    const url = new URL(API_BASE + path);

    // НЕ кладём initData в заголовок (там ломается из-за кириллицы).
    // Для GET — кладём в query, для POST — в body.
    if (method === 'GET') {
      if (TG_INIT) url.searchParams.set('initData', encodeURIComponent(TG_INIT));
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

  const formBox = document.getElementById('form');
  const resultBox = document.getElementById('result');

  function el(t, a={}, ...c){ const e=document.createElement(t); for(const[k,v]of Object.entries(a)){ if(k==='className')e.className=v; else if(k==='html')e.innerHTML=v; else e.setAttribute(k,v);} for(const x of c){ e.appendChild(typeof x==='string'?document.createTextNode(x):x);} return e; }
  const btn=(t, on)=>{ const b=el('button',{className:'btn',type:'button'},t); if(on)b.addEventListener('click',on); return b; };

  async function load() {
    if (!TG_INIT) {
      const hasSDK = !!(window.Telegram && window.Telegram.WebApp);
      formBox.innerHTML = `
        <div class="card">
          <b>Ошибка: Missing initData</b><br/>
          Откройте через кнопку в чате с ботом.<br/><br/>
          SDK: ${hasSDK ? 'есть' : 'нет'} • hash: ${location.hash ? 'есть' : 'пусто'}
        </div>`;
      return;
    }

    const data = await api('/api/products', { method:'GET' });
    const products = data.products || [];
    if (!products.length) {
      formBox.innerHTML = '<div class="card">Нет активных товаров. Попросите администратора добавить их в «Справочники».</div>';
      return;
    }

    const rows = products.map(p => {
      const row = el('div', { className:'spaced' },
        el('label', {}, `${p.name} (${p.unit})`),
        el('input', { type:'number', min:'0', step:'0.01', placeholder:'Количество', 'data-pid': String(p.id), style:'width:120px' })
      );
      return el('div', { className:'card' }, row);
    });

    const submit = btn('Отправить заявку', async () => {
      const inputs = Array.from(formBox.querySelectorAll('input[data-pid]'));
      const items = inputs.map(i => ({ product_id: Number(i.getAttribute('data-pid')), qty: Number(i.value) }))
                         .filter(x => x.qty > 0);
      if (!items.length) { alert('Добавьте хотя бы одну позицию'); return; }
      try {
        const r = await api('/api/requisitions', { method:'POST', body:{ items }});
        resultBox.style.display = 'block';
        resultBox.textContent = 'Заявка создана: #' + r.requisition_id;
        inputs.forEach(i => i.value = '');
      } catch (e) { alert(e.message); }
    });

    formBox.innerHTML = '';
    rows.forEach(r => formBox.appendChild(r));
    formBox.appendChild(el('div',{className:'spaced',style:'margin-top:1rem'}, submit));
  }

  try { window.Telegram?.WebApp?.ready?.(); } catch {}
  load().catch(e => { formBox.innerHTML = '<div class="error">Ошибка: ' + e.message + '</div>'; });
})();
