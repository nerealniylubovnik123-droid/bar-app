(() => {
  'use strict';
  const API_BASE = location.origin;

  /* ---------- initData ---------- */
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
        if (p.get('hash')) return p.toString();
      } catch {}
    }
    if (location.hash.includes('tgWebAppData=')) {
      try {
        const h = new URLSearchParams(location.hash.slice(1));
        const raw = h.get('tgWebAppData');
        if (raw) return decodeURIComponent(raw);
      } catch {}
    }
    return '';
  }
  const TG_INIT = getInitData();

  /* ---------- API ---------- */
  async function api(path, { method='GET', body } = {}) {
    const url = new URL(API_BASE + path);
    const m = method.toUpperCase();
    if (m === 'POST') {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...(body||{}), initData: TG_INIT })
      });
      const j = await res.json().catch(()=>({}));
      if (!res.ok || j?.ok === false) throw new Error(j?.error || res.statusText);
      return j;
    }
    if (TG_INIT) url.searchParams.set('initData', encodeURIComponent(TG_INIT));
    const res = await fetch(url, { method: m, headers: { 'Content-Type': 'application/json' } });
    const j = await res.json().catch(()=>({}));
    if (!res.ok || j?.ok === false) throw new Error(j?.error || res.statusText);
    return j;
  }

  /* ---------- helpers / state ---------- */
  const $ = s => document.querySelector(s);
  function el(t, a={}, ...c){
    const e = document.createElement(t);
    for (const [k,v] of Object.entries(a)){
      if (k === 'className') e.className = v;
      else if (k === 'html') e.innerHTML = v;
      else e.setAttribute(k, v);
    }
    for (const x of c) e.appendChild(typeof x === 'string' ? document.createTextNode(x) : x);
    return e;
  }

  const formBox = $('#form');
  const resultBox = $('#result');
  const recoBox = $('#reco');

  let PRODUCTS = [];                         // [{id,name,unit,category,supplier_id,supplier_name}]
  const inputByPid = new Map();              // основная форма: product_id -> <input>
  const recoInputByPid = new Map();          // рекомендации: product_id -> <input> (есть в «рекомендациях»)

  function readSelectedIds() {
    const out = [];
    for (const [pid, input] of inputByPid.entries()) {
      const q = Number(input.value);
      if (q > 0) out.push(Number(pid));
    }
    return out;
  }

  function groupBy(arr, keyFn) {
    const map = new Map();
    for (const item of arr) {
      const k = keyFn(item);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(item);
    }
    return map;
  }

  /* ---------- РЕКОМЕНДАЦИИ (как раньше, синхронизация сохранена) ---------- */
  function renderRecommendations() {
    recoBox.innerHTML = '';
    recoInputByPid.clear();

    const selectedIds = new Set(readSelectedIds());
    if (selectedIds.size === 0) {
      recoBox.appendChild(el('div', { className:'card' }, 'Сначала добавьте в заявку хотя бы один товар — рекомендации покажут позиции от тех же поставщиков.'));
      return;
    }

    const supplierIdsInUse = new Set(
      PRODUCTS.filter(p => selectedIds.has(p.id)).map(p => p.supplier_id)
    );

    const recommended = PRODUCTS
      .filter(p => supplierIdsInUse.has(p.supplier_id) && !selectedIds.has(p.id))
      .sort((a,b)=>a.name.localeCompare(b.name,'ru'));

    if (!recommended.length) {
      recoBox.appendChild(el('div', { className:'card' }, 'Подходящих рекомендаций нет — все товары этих поставщиков уже выбраны.'));
      return;
    }

    const toolbar = el('div', { className:'spaced', style:'margin-bottom:8px' },
      el('div', { className:'muted' }, 'Введите количество прямо здесь — оно сразу появится в основной форме.'),
      (() => {
        const btn = el('button', { className:'btn', type:'button' }, 'Добавить все (≠0)');
        btn.addEventListener('click', () => {
          for (const [pid, rinp] of recoInputByPid.entries()) {
            const val = Number(rinp.value);
            if (!val || val <= 0) continue;
            const main = inputByPid.get(pid);
            if (main) main.value = String(val);
          }
          window.scrollTo({ top: 0, behavior: 'smooth' });
        });
        return btn;
      })()
    );
    recoBox.appendChild(toolbar);

    // группируем рекомендации по поставщикам (логика рекомендаций привязана к поставщику)
    const bySupplier = groupBy(recommended, p => `${p.supplier_id}__${p.supplier_name}`);
    const supplierKeys = [...bySupplier.keys()].sort((a,b)=>{
      const an = a.split('__')[1]||''; const bn = b.split('__')[1]||'';
      return an.localeCompare(bn,'ru');
    });

    for (const key of supplierKeys) {
      const [sid, sname] = key.split('__');
      const card = el('div', { className:'card' });
      card.appendChild(el('div', { className:'muted', html: `<b>${sname || 'Поставщик'}</b>` }));

      for (const p of bySupplier.get(key)) {
        const mainInput = inputByPid.get(p.id);

        const qtyInput = el('input', { type:'number', min:'0', step:'0.01', placeholder:'Кол-во', style:'width:120px' });
        recoInputByPid.set(p.id, qtyInput);
        if (mainInput && Number(mainInput.value) > 0) qtyInput.value = String(mainInput.value);

        qtyInput.addEventListener('input', () => { if (mainInput) mainInput.value = qtyInput.value; });

        const plus = el('button', { className:'btn', type:'button' }, '+1');
        plus.addEventListener('click', () => {
          const cur = Number(qtyInput.value) || 0;
          qtyInput.value = String(cur + 1);
          qtyInput.dispatchEvent(new Event('input'));
        });
        const clear = el('button', { className:'btn', type:'button' }, 'Очистить');
        clear.addEventListener('click', () => {
          qtyInput.value = '';
          qtyInput.dispatchEvent(new Event('input'));
        });

        const line = el('div', { className:'spaced' },
          el('span', {}, `${p.name} (${p.unit})`),
          el('div', {}, qtyInput, ' ', plus, ' ', clear)
        );
        card.appendChild(line);
      }
      recoBox.appendChild(card);
    }
  }

  /* ---------- РЕНДЕР ОСНОВНОЙ ФОРМЫ: ГРУППИРОВКА ПО КАТЕГОРИЯМ ---------- */
  async function load() {
    if (!TG_INIT) {
      formBox.innerHTML = '<div class="card">Ошибка: Missing initData. Откройте через кнопку в боте.</div>';
      return;
    }

    const data = await api('/api/products', { method:'GET' });
    PRODUCTS = (data.products || []).slice().sort((a,b)=>{
      const ac = (a.category||'').toLowerCase();
      const bc = (b.category||'').toLowerCase();
      if (ac === bc) return a.name.localeCompare(b.name,'ru');
      return ac.localeCompare(bc,'ru');
    });

    if (!PRODUCTS.length) {
      formBox.innerHTML = '<div class="card">Нет активных товаров. Попросите администратора добавить их в «Справочники».</div>';
      return;
    }

    formBox.innerHTML = '';
    inputByPid.clear();

    // Формируем группы по category (пустую считаем «Прочее»)
    const byCategory = groupBy(PRODUCTS, p => (p.category && p.category.trim()) ? p.category.trim() : 'Прочее');
    const categories = [...byCategory.keys()].sort((a,b)=>a.localeCompare(b,'ru'));

    for (const cat of categories) {
      const card = el('div', { className:'card' });
      card.appendChild(el('div', { className:'muted', html: `<b>${cat}</b>` }));

      const items = byCategory.get(cat).slice().sort((a,b)=>a.name.localeCompare(b.name,'ru'));
      for (const p of items) {
        const inp = el('input', { type:'number', min:'0', step:'0.01', placeholder:'Кол-во', style:'width:120px' });
        inputByPid.set(p.id, inp);

        // синхронизация с рекомендациями
        inp.addEventListener('input', () => {
          const rInp = recoInputByPid.get(p.id);
          if (rInp) rInp.value = inp.value || '';
        });

        const row = el('div', { className:'spaced' },
          el('label', {}, `${p.name} (${p.unit})`),
          el('span', { className:'muted' }, p.supplier_name ? `Поставщик: ${p.supplier_name}` : ''),
          inp
        );
        card.appendChild(row);
      }
      formBox.appendChild(card);
    }

    // Кнопки
    $('#btnReco').onclick = renderRecommendations;

    $('#btnSubmit').onclick = async () => {
      const items = [];
      for (const [pid, input] of inputByPid.entries()) {
        const q = Number(input.value);
        if (q > 0) items.push({ product_id: Number(pid), qty: q });
      }
      if (!items.length) { alert('Добавьте хотя бы одну позицию'); return; }

      try {
        const r = await api('/api/requisitions', { method:'POST', body:{ items }});
        resultBox.style.display = 'block';
        resultBox.textContent = 'Заявка создана: #' + r.requisition_id;

        // очистим всё
        inputByPid.forEach(inp => inp.value = '');
        recoInputByPid.forEach(inp => inp.value = '');
        recoBox.innerHTML = '';
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } catch (e) {
        alert(e.message);
      }
    };
  }

  try { window.Telegram?.WebApp?.ready?.(); } catch {}
  load().catch(e => { formBox.innerHTML = '<div class="card">Ошибка: '+e.message+'</div>'; });
})();
