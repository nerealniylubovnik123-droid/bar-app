(() => {
  'use strict';
  const API_BASE = location.origin;

  function getInitData() {
    // 1) Нормальный путь
    const w = window;
    const tg = w.Telegram && w.Telegram.WebApp;
    if (tg && typeof tg.initData === 'string' && tg.initData.length > 0) {
      return tg.initData;
    }
    // 2) Иногда данные лежат в initDataUnsafe
    if (tg && tg.initDataUnsafe && typeof tg.initDataUnsafe === 'object') {
      try {
        const params = new URLSearchParams();
        // cобираем ключевые поля, как требует проверка
        if (tg.initDataUnsafe.query_id) params.set('query_id', tg.initDataUnsafe.query_id);
        if (tg.initDataUnsafe.user) params.set('user', JSON.stringify(tg.initDataUnsafe.user));
        if (tg.initDataUnsafe.start_param) params.set('start_param', tg.initDataUnsafe.start_param);
        if (tg.initDataUnsafe.auth_date) params.set('auth_date', String(tg.initDataUnsafe.auth_date));
        if (tg.initDataUnsafe.hash) params.set('hash', tg.initDataUnsafe.hash);
        const s = params.toString();
        if (s && params.get('hash')) return s;
      } catch (e) {}
    }
    // 3) Telegram Desktop нередко кладёт данные в hash: #tgWebAppData=<urlencoded>
    if (location.hash && location.hash.includes('tgWebAppData=')) {
      try {
        const h = new URLSearchParams(location.hash.slice(1));
        const raw = h.get('tgWebAppData'); // это уже строка вида query_id=...&user=...&hash=...
        if (raw) return decodeURIComponent(raw);
      } catch (e) {}
    }
    return '';
  }

  const TG_INIT = getInitData();

  async function api(path, { method='GET', body, headers={} } = {}) {
    const res = await fetch(API_BASE + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-TG-INIT-DATA': TG_INIT, // передаём то, что смогли добыть
        ...headers
      },
      body: body ? JSON.stringify(body) : undefined
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
      // Покажем диагностическую информацию, чтобы быстро понять, где застряло
      const hasSDK = !!(window.Telegram && window.Telegram.WebApp);
      formBox.innerHTML = `
        <div class="card">
          <b>Ошибка: Missing initData</b><br/>
          Откройте эту страницу через кнопку <i>«Оформить заявку»</i> в чате с ботом.<br/><br/>
          Диагностика:<br/>
          SDK: ${hasSDK ? 'есть' : 'нет'}<br/>
          hash: ${location.hash ? 'есть' : 'пусто'}<br/>
          Версия Telegram: попробуйте мобильное приложение (iOS/Android) или обновите Desktop.
        </div>`;
      return;
    }

    const data = await api('/api/products');
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

  // На всякий случай уведомим Telegram-клиент, что мы готовы
  try { window.Telegram?.WebApp?.ready?.(); } catch {}

  load().catch(e => {
    formBox.innerHTML = '<div class="error">Ошибка: ' + e.message + '</div>';
  });
})();
