// staff.js v20251015-5 — категории сворачиваются, поставщик скрыт
console.log('staff.js v20251015-5 loaded');

(function() {
  const tg = window.Telegram?.WebApp;
  tg?.expand();

  const $ = (sel, root = document) => root.querySelector(sel);
  const meBox = $('#meBox');
  const errBox = $('#err');
  const okBox = $('#ok');
  const suppliersContainer = $('#suppliersContainer');
  const submitBtn = $('#submitBtn');
  const clearBtn = $('#clearBtn');
  const itemsCountEl = $('#itemsCount');

  let products = [];
  let qtyMap = new Map();

  const initData = (() => {
    try {
      const u = new URL(window.location.href);
      const fromQuery = u.searchParams.get('initData');
      if (fromQuery) return fromQuery;
      if (tg?.initData) return tg.initData;
      return localStorage.getItem('tg_initData') || '';
    } catch { return ''; }
  })();
  if (initData) localStorage.setItem('tg_initData', initData);

  const apiGet = async (url) => {
    const sep = url.includes('?') ? '&' : '?';
    const r = await fetch(`${url}${sep}initData=${encodeURIComponent(initData)}`);
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  };

  const apiPost = async (url, body) => {
    const r = await fetch(url, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({initData, ...body})
    });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  };

  const showErr = (m)=>{errBox.textContent=m;errBox.style.display='block';okBox.style.display='none';};
  const showOk  = (m)=>{okBox.textContent=m;okBox.style.display='block';errBox.style.display='none';};
  const clearMsgs=()=>{errBox.style.display='none';okBox.style.display='none';};
  const escapeHtml=(s)=>String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

  function updateSummary(){
    const c=[...qtyMap.values()].filter(v=>v>0).length;
    itemsCountEl.textContent=String(c);
  }

  function round2(x){return Math.round(x*100)/100;}

  function render(){
    suppliersContainer.innerHTML='';
    const bySupplier=new Map();
    for(const p of products){
      const k=String(p.supplier_id??'0');
      if(!bySupplier.has(k))bySupplier.set(k,[]);
      bySupplier.get(k).push(p);
    }

    let i=0;
    for(const [,list] of bySupplier.entries()){
      i++;
      const details=document.createElement('details');
      details.className='supplier-section';
      details.open=true;

      const summary=document.createElement('summary');
      const head=document.createElement('div');
      head.className='supplier-head';
      head.innerHTML=`
        <h2 class="supplier-title">
          <span class="caret"></span>Категория ${i}
          <span class="muted">• ${list.length} поз.</span>
        </h2>
        <button class="btn" data-clear>Сбросить</button>
      `;
      summary.appendChild(head);
      details.appendChild(summary);

      const grid=document.createElement('div');
      grid.className='products';

      for(const p of list){
        const card=document.createElement('div');
        card.className='product';
        card.dataset.id=p.id;

        const name=document.createElement('div');
        name.className='product-name';
        name.textContent=p.name;

        const meta=document.createElement('div');
        meta.className='product-meta';
        meta.innerHTML=`
          <span class="muted">ID ${p.id}</span>
          ${p.unit?`<span>ед.: ${escapeHtml(p.unit)}</span>`:''}
        `;

        const qtyRow=document.createElement('div');
        qtyRow.className='qty-row';
        const input=document.createElement('input');
        input.type='number';
        input.min='0';input.step='0.01';
        input.className='qty-input';
        input.value=qtyMap.get(p.id)||'';

        const plus=document.createElement('button');
        plus.className='btn square';plus.textContent='+';
        const minus=document.createElement('button');
        minus.className='btn square';minus.textContent='−';
        const controls=document.createElement('div');
        controls.className='qty-controls';
        controls.append(minus,plus);

        qtyRow.append(input,controls);
        card.append(name,meta,qtyRow);
        grid.append(card);

        input.addEventListener('input',()=>{
          const v=parseFloat(input.value);
          if(!v||v<=0)qtyMap.delete(p.id);
          else qtyMap.set(p.id,round2(v));
          updateSummary();
        });
        plus.addEventListener('click',()=>{
          const cur=qtyMap.get(p.id)||0;
          const next=round2(cur+1);
          qtyMap.set(p.id,next);
          input.value=next;
          updateSummary();
        });
        minus.addEventListener('click',()=>{
          const cur=qtyMap.get(p.id)||0;
          const next=Math.max(0,round2(cur-1));
          if(next<=0)qtyMap.delete(p.id);else qtyMap.set(p.id,next);
          input.value=next||'';
          updateSummary();
        });
      }

      details.appendChild(grid);
      suppliersContainer.appendChild(details);

      head.querySelector('[data-clear]').addEventListener('click',(e)=>{
        e.preventDefault();e.stopPropagation();
        for(const p of list)qtyMap.delete(p.id);
        render();
        updateSummary();
      });
    }
    updateSummary();
  }

  clearBtn.addEventListener('click',()=>{qtyMap.clear();render();updateSummary();});

  submitBtn.addEventListener('click',async()=>{
    clearMsgs();
    const items=[...qtyMap.entries()].filter(([,v])=>v>0)
      .map(([product_id,qty])=>({product_id,qty}));
    if(!items.length){showErr('Вы не указали количество.');return;}
    submitBtn.disabled=true;submitBtn.textContent='Отправка...';
    try{
      const r=await apiPost('/api/requisitions',{items});
      showOk(`Заявка №${r.requisition_id} оформлена.`);
      qtyMap.clear();render();
      tg?.HapticFeedback?.notificationOccurred('success');
    }catch(e){
      showErr(e.message||'Ошибка отправки');
      tg?.HapticFeedback?.notificationOccurred('error');
    }finally{
      submitBtn.disabled=false;submitBtn.textContent='Отправить заявку';
    }
  });

  (async function init(){
    try{
      const me=await apiGet('/api/me');
      meBox.textContent=me?.name||'Сотрудник';
    }catch{meBox.textContent='Сотрудник';}

    try{
      const list=await apiGet('/api/products');
      products=(Array.isArray(list)?list:[]).filter(p=>!p.disabled);
      render();
    }catch{showErr('Не удалось загрузить товары');}
  })();
})();
