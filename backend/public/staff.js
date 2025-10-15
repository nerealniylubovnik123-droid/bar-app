(async () => {
  'use strict';

  /* ========================= CONFIG ========================= */
  const ENDPOINTS = {
    PRIMARY: '/api/products',        // защищённый (POST/GET с initData)
    PUBLIC:  '/api/public/products', // публичный (GET), если есть
    SEND:    '/api/requisitions',    // отправка заявки
  };

  /* ========================= AUTH HELPERS ========================= */
  function getInitDataString() {
    const tg = window.Telegram && window.Telegram.WebApp;
    if (tg?.initData) return tg.initData;
    // совместимость со старыми версиями SDK
    if (tg?.initDataUnsafe) {
      try {
        const p = new URLSearchParams();
        const u = tg.initDataUnsafe;
        if (u.query_id)     p.set('query_id', u.query_id);
        if (u.user)         p.set('user', JSON.stringify(u.user));
        if (u.start_param)  p.set('start_param', u.start_param);
        if (u.auth_date)    p.set('auth_date', String(u.auth_date));
        if (u.hash)         p.set('hash', u.hash);
        return p.toString();
      } catch {}
    }
    return '';
  }
  const TG_INIT = getInitDataString();

  function getAdminToken() {
    try { return localStorage.getItem('admToken') || ''; } catch { return ''; }
  }

  function buildHeaders(extra = {}) {
    const token = getAdminToken();
    const h = { 'Content-Type': 'application/json', ...extra };
    if (TG_INIT) h['X-Telegram-Init-Data'] = TG_INIT; // миддлвари часто читают из заголовка
    if (token) {
      h['X-Admin-Token'] = token;
      h['Authorization'] = `Bearer ${token}`;
    }
    return h;
  }

  async function apiPOST(path, body) {
    const res = await fetch(path, {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify({ ...(body || {}), initData: TG_INIT }) // и в body тоже
    });
    let json = null; try { json = await res.json(); } catch {}
    if (!res.ok || json?.ok === false) {
      const err = new Error(json?.error || res.statusText || `HTTP ${res.status}`);
      err.status = res.status; err.payload = json; throw err;
    }
    return json;
  }

  async function apiGET(path) {
    const url = new URL(path, location.origin);
    if (TG_INIT) url.searchParams.set('initData', encodeURIComponent(TG_INIT)); // и в query
    const res = await fetch(url, { method: 'GET', headers: buildHeaders() });
    let json = null; try { json = await res.json(); } catch {}
    if (!res.ok || json?.ok === false) {
      const err = new Error(json?.error || res.statusText || `HTTP ${res.status}`);
      err.status = res.status; err.payload = json; throw err;
    }
    return json;
  }

  /* ========================= DOM ========================= */
  const categoriesEl = document.getElementById('categories');
  const recoEl = document.getElementById('reco');
  const recoList = document.getElementById('recoList');
  const toggleAllBtn = document.getElementById('toggleAll') || document.getElementById('btnExpand'); // поддержка обоих вариантов
  const countEl = document.getElementById('count') || document.getElementById('selectedCounter');
  const sendBtn = document.getElementById('sendBtn') || document.getElementById('btnSend');

  /* ========================= STATE ========================= */
  let products = [];
  let expandedAll = false;            // старт: свёрнуто
  const cart = new Map();             // productId -> qty

  /* ========================= UTILS ========================= */
  const escapeHtml = s => (s ?? '').toString().replace(/[&<>"']/g, m => (
    {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]
  ));
  const plural = (n,a,b,c)=>{
    n=Math.abs(n)%100;const n1=n%10;
    if(n>10&&n<20)return c;if(n1>1&&n1<5)return b;if(n1===1)return a;return c;
  };
  const by = k => (a,b)=>(a[k]||'').localeCompare(b[k]||'','ru',{sensitivity:'base'});

  function normalizeProducts(raw) {
    return raw.map(x => ({
      id: x.id ?? x.product_id ?? x._id,
      name: x.name ?? x.title ?? '',
      unit: x.unit ?? x.uom ?? x.measure ?? '',
      category: x.category ?? x.group ?? 'Без категории'
    }));
  }

  /* ========================= RENDER ========================= */
  function renderCategories() {
    const grouped = {};
    for (const p of products) {
      const cat = p.category || 'Без категории';
      (grouped[cat] ||= []).push(p);
    }
    for (const k in grouped) grouped[k].sort(by('name'));

    categoriesEl.innerHTML = Object.entries(grouped).sort((a,b)=>a[0].localeCompare(b[0],'ru'))
      .map(([cat, list])=>{
        const items = list.map(p=>`
          <div class="item" data-id="${p.id}">
            <div class="item-name">${escapeHtml(p.name)} <span class="item-unit">${p.unit||''}</span></div>
            <input type="number" min="0" step="0.5" placeholder="0" class="qty-input" />
          </div>
        `).join('');

        // Контейнер группы — белая карточка. Раскрытие через класс .open и max-height (без прыжков).
        return `
          <div class="category ${expandedAll ? 'open':''}" data-cat="${escapeHtml(cat)}">
            <div class="category-header">
              <span>${escapeHtml(cat)}</span>
              <div class="caret">›</div>
            </div>
            <div class="category-items" style="${expandedAll ? 'max-height:2000px':''}">${items}</div>
          </div>
        `;
      }).join('');

    attachHandlers();
    updateCount();
    renderRecommendations();
    if (toggleAllBtn) {
      toggleAllBtn.textContent = expandedAll ? 'Свернуть все' : 'Развернуть все';
      toggleAllBtn.dataset.mode = expandedAll ? 'close' : 'open';
    }
  }

  function attachHandlers() {
    // раскрытие групп — без удаления из потока, только max-height
    categoriesEl.querySelectorAll('.category').forEach(catEl=>{
      const header = catEl.querySelector('.category-header');
      const panel  = catEl.querySelector('.category-items');
      header.addEventListener('click', ()=>{
        const isOpen = catEl.classList.toggle('open');
        header.querySelector('.caret').style.transform = isOpen ? 'rotate(90deg)' : 'none';
        panel.style.maxHeight = isOpen ? panel.scrollHeight + 'px' : '0px';
      });
    });

    // ввод количества
    categoriesEl.querySelectorAll('.qty-input').forEach(inp=>{
      inp.addEventListener('input',()=>{
        const row=inp.closest('.item');
        const id=row.dataset.id;
        const val=parseFloat(inp.value)||0;
        if(val>0) cart.set(id,val); else cart.delete(id);
        updateCount();
        renderRecommendations();
      });
    });
  }

  function updateCount(){
    if (!countEl) return;
    const n=cart.size;
    countEl.textContent=`Выбрано: ${n} ${plural(n,'позиция','позиции','позиций')}`;
  }

  function renderRecommendations(){
    if (!recoEl || !recoList) return;
    const selectedIds=new Set(cart.keys());
    const selectedCats=new Set(
      products.filter(p=>selectedIds.has(String(p.id))).map(p=>p.category||'Без категории')
    );
    const candidates=products.filter(p=>
      selectedCats.has(p.category||'Без категории')&&!selectedIds.has(String(p.id))
    ).sort(by('name')).slice(0,6);

    if(!candidates.length){recoEl.style.display='none';return;}
    recoEl.style.display='block';
    recoList.innerHTML=candidates.map(p=>`
      <div class="reco-item" data-id="${p.id}" data-cat="${escapeHtml(p.category||'Без категории')}">${escapeHtml(p.name)}</div>
    `).join('');

    // клик по рекомендации — раскрыть нужную группу и сфокусировать поле (без автозаполнения)
    recoList.querySelectorAll('.reco-item').forEach(el=>{
      el.addEventListener('click',()=>{
        const cat=el.dataset.cat;
        const id=el.dataset.id;
        const block=document.querySelector(`.category[data-cat="${CSS.escape(cat)}"]`);
        if(block){
          const panel=block.querySelector('.category-items');
          block.classList.add('open');
          block.querySelector('.caret').style.transform='rotate(90deg)';
          panel.style.maxHeight = panel.scrollHeight + 'px';
          const item=block.querySelector(`.item[data-id="${CSS.escape(id)}"]`);
          if(item){
            item.scrollIntoView({behavior:'smooth',block:'center'});
            const input=item.querySelector('.qty-input');
            input?.focus();
          }
        }
      });
    });
  }

  if (toggleAllBtn) {
    toggleAllBtn.addEventListener('click',()=>{
      expandedAll=!expandedAll;
      document.querySelectorAll('.category').forEach(c=>{
        const panel=c.querySelector('.category-items');
        c.classList.toggle('open', expandedAll);
        c.querySelector('.caret').style.transform=expandedAll?'rotate(90deg)':'none';
        panel.style.maxHeight = expandedAll ? panel.scrollHeight + 'px' : '0px';
      });
      toggleAllBtn.textContent=expandedAll?'Свернуть все':'Развернуть все';
      toggleAllBtn.dataset.mode = expandedAll ? 'close' : 'open';
    });
  }

  if (sendBtn) {
    sendBtn.addEventListener('click', async ()=>{
      const items = Array.from(cart.entries()).map(([product_id, qty]) => ({
        product_id: /^\d+$/.test(String(product_id)) ? Number(product_id) : product_id,
        qty
      }));
      if (!items.length) return;
      sendBtn.disabled = true;
      try {
        await apiPOST(ENDPOINTS.SEND, { items });
        cart.clear();
        updateCount();
        // можно показать тост — опущено для краткости
      } catch(e) {
        console.error(e);
      } finally {
        sendBtn.disabled = false;
      }
    });
  }

  /* ========================= LOAD PRODUCTS (устойчиво) ========================= */
  async function loadProducts() {
    // 1) Защищённый POST /api/products с initData в body + header
    try {
      const j = await apiPOST(ENDPOINTS.PRIMARY, {});
      const list = Array.isArray(j) ? j : (Array.isArray(j.products) ? j.products : []);
      if (list.length) return normalizeProducts(list);
      throw new Error('EMPTY_LIST_POST');
    } catch (e1) {
      console.warn('POST /api/products failed:', e1?.status || '', e1?.message || e1);
      // 2) GET /api/products?initData=...
      try {
        const j = await apiGET(ENDPOINTS.PRIMARY);
        const list = Array.isArray(j) ? j : (Array.isArray(j.products) ? j.products : []);
        if (list.length) return normalizeProducts(list);
        throw new Error('EMPTY_LIST_GET');
      } catch (e2) {
        console.warn('GET /api/products failed:', e2?.status || '', e2?.message || e2);
        // 3) Публичный GET /api/public/products
        try {
          const res = await fetch(ENDPOINTS.PUBLIC, { headers: buildHeaders() });
          const j = await res.json().catch(()=> ({}));
          if (!res.ok || j?.ok === false) throw new Error(j?.error || `HTTP ${res.status}`);
          const list = Array.isArray(j) ? j : (Array.isArray(j.products) ? j.products : []);
          if (list.length) return normalizeProducts(list);
          throw new Error('EMPTY_LIST_PUBLIC');
        } catch (e3) {
          console.warn('GET /api/public/products failed:', e3?.status || '', e3?.message || e3);
          const err = new Error('NO_PRODUCTS_ENDPOINT');
          err.causes = { e1, e2, e3 };
          throw err;
        }
      }
    }
  }

  /* ========================= INIT ========================= */
  try { window.Telegram?.WebApp?.ready?.(); } catch {}

  try {
    const raw = await loadProducts();
    products = raw;
    renderCategories();
  } catch (e) {
    console.error('Unable to load products:', e);
    categoriesEl.innerHTML = `
      <div class="empty" style="padding:14px 10px; border:1px dashed #ddd; border-radius:12px; background:#fff; color:#444;">
        Ошибка загрузки товаров
      </div>`;
  }
})();
