(async () => {
  const API = '/api/products';
  const categoriesEl = document.getElementById('categories');
  const recoEl = document.getElementById('reco');
  const recoList = document.getElementById('recoList');
  const toggleAllBtn = document.getElementById('toggleAll');
  const countEl = document.getElementById('count');

  let products = [];
  let expandedAll = false;
  const cart = new Map();

  // --- utils ---
  const escapeHtml = s => (s ?? '').toString().replace(/[&<>"']/g, m => (
    {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]
  ));
  const plural = (n,a,b,c)=>{
    n=Math.abs(n)%100;const n1=n%10;
    if(n>10&&n<20)return c;if(n1>1&&n1<5)return b;if(n1===1)return a;return c;
  };

  function renderCategories() {
    const grouped = {};
    for (const p of products) {
      const cat = p.category || 'Без категории';
      (grouped[cat] ||= []).push(p);
    }

    categoriesEl.innerHTML = Object.entries(grouped).map(([cat, list])=>{
      const items = list.map(p=>`
        <div class="item" data-id="${p.id}">
          <div class="item-name">${escapeHtml(p.name)} <span class="item-unit">${p.unit||''}</span></div>
          <input type="number" min="0" step="0.5" placeholder="0" class="qty-input" />
        </div>
      `).join('');

      return `
        <div class="category" data-cat="${escapeHtml(cat)}">
          <div class="category-header">
            <span>${escapeHtml(cat)}</span>
            <div class="caret">›</div>
          </div>
          <div class="category-items">${items}</div>
        </div>
      `;
    }).join('');

    attachHandlers();
  }

  function attachHandlers() {
    // раскрытие групп
    categoriesEl.querySelectorAll('.category-header').forEach(h=>{
      h.addEventListener('click',()=>{
        const cat=h.parentElement;
        const open=cat.classList.toggle('open');
        h.querySelector('.caret').style.transform=open?'rotate(90deg)':'none';
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
    const n=cart.size;
    countEl.textContent=`Выбрано: ${n} ${plural(n,'позиция','позиции','позиций')}`;
  }

  function renderRecommendations(){
    const selectedIds=new Set(cart.keys());
    const selectedCats=new Set(
      products.filter(p=>selectedIds.has(String(p.id))).map(p=>p.category||'Без категории')
    );
    const candidates=products.filter(p=>
      selectedCats.has(p.category||'Без категории')&&!selectedIds.has(String(p.id))
    ).slice(0,6);

    if(!candidates.length){recoEl.style.display='none';return;}
    recoEl.style.display='block';
    recoList.innerHTML=candidates.map(p=>`
      <div class="reco-item" data-id="${p.id}" data-cat="${escapeHtml(p.category||'Без категории')}">${escapeHtml(p.name)}</div>
    `).join('');

    recoList.querySelectorAll('.reco-item').forEach(el=>{
      el.addEventListener('click',()=>{
        const cat=el.dataset.cat;
        const id=el.dataset.id;
        const block=document.querySelector(`.category[data-cat="${CSS.escape(cat)}"]`);
        if(block&&!block.classList.contains('open')){
          block.classList.add('open');
          block.querySelector('.caret').style.transform='rotate(90deg)';
        }
        const item=block?.querySelector(`.item[data-id="${CSS.escape(id)}"]`);
        if(item){
          item.scrollIntoView({behavior:'smooth',block:'center'});
          const input=item.querySelector('.qty-input');
          input.focus();
        }
      });
    });
  }

  toggleAllBtn.addEventListener('click',()=>{
    expandedAll=!expandedAll;
    document.querySelectorAll('.category').forEach(c=>{
      c.classList.toggle('open',expandedAll);
      c.querySelector('.caret').style.transform=expandedAll?'rotate(90deg)':'none';
    });
    toggleAllBtn.textContent=expandedAll?'Свернуть все':'Развернуть все';
  });

  // --- load products ---
  async function loadProducts(){
    try{
      const res=await fetch(API);
      const data=await res.json();
      products=(Array.isArray(data.products)?data.products:data)||[];
      renderCategories();
    }catch(e){
      categoriesEl.innerHTML='<p>Ошибка загрузки товаров</p>';
    }
  }

  await loadProducts();
})();
