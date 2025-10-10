(() => {
  'use strict';
  const API_BASE = location.origin;

  // Берём initData из Telegram WebApp SDK
  const TG_INIT =
    (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData) || '';

  async function api(path, { method='GET', body, headers={} } = {}) {
    const res = await fetch(API_BASE + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-TG-INIT-DATA': TG_INIT,     // <-- тут отправляем подпись
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
    // Если нет initData — значит открыли не из Telegram WebApp
    if (!TG_INIT) {
      formBox.innerHTML = `
        <div class="card">
          <b>Ошибка: Missing initData</b><br/>
          Откройте эту страницу через кнопку <i>«Оформить заявку»</i> внутри вашего Telegram-бота.
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

  load().catch(e => {
    formBox.innerHTML = '<div class="error">Ошибка: ' + e.message + '</div>';
  });
})();
