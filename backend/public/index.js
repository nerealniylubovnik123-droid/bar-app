(function(){
  'use strict';
  const API_BASE = location.origin;
  const diag = document.getElementById('diag');

  function log(s){
    if (!diag) return;
    diag.textContent += (diag.textContent ? '\n' : '') + s;
  }

  function getInitData(){
    const tg = window.Telegram && window.Telegram.WebApp;
    // 1) Обычный путь
    if (tg && typeof tg.initData === 'string' && tg.initData) return tg.initData;
    // 2) initDataUnsafe
    if (tg && tg.initDataUnsafe && typeof tg.initDataUnsafe === 'object'){
      try{
        const p = new URLSearchParams();
        if (tg.initDataUnsafe.query_id)    p.set('query_id', tg.initDataUnsafe.query_id);
        if (tg.initDataUnsafe.user)        p.set('user', JSON.stringify(tg.initDataUnsafe.user));
        if (tg.initDataUnsafe.start_param) p.set('start_param', tg.initDataUnsafe.start_param);
        if (tg.initDataUnsafe.auth_date)   p.set('auth_date', String(tg.initDataUnsafe.auth_date));
        if (tg.initDataUnsafe.hash)        p.set('hash', tg.initDataUnsafe.hash);
        if (p.get('hash')) return p.toString();
      }catch(e){}
    }
    // 3) Иногда TG Desktop кладёт в hash
    if (location.hash && location.hash.includes('tgWebAppData=')){
      try{
        const h = new URLSearchParams(location.hash.slice(1));
        const raw = h.get('tgWebAppData');
        if (raw) return decodeURIComponent(raw);
      }catch(e){}
    }
    return '';
  }

  async function whoAmI(init){
    const url = new URL(API_BASE + '/api/me');
    if (init) url.searchParams.set('initData', encodeURIComponent(init));
    const r = await fetch(url.toString());
    const j = await r.json().catch(()=>({}));
    if (!r.ok || j?.ok === false) throw new Error(j?.error || r.statusText);
    return j.user;
  }

  async function main(){
    try { window.Telegram?.WebApp?.ready?.(); } catch {}
    log('SDK: ' + (!!(window.Telegram && window.Telegram.WebApp)));
    log('hash: ' + (location.hash ? 'есть' : 'пусто'));

    const init = getInitData();
    log('initData: ' + (init ? 'получено' : 'пусто'));

    if (init){
      try{
        const u = await whoAmI(init);
        location.replace(u?.role === 'admin' ? '/admin' : '/staff');
        return;
      }catch(e){
        log('Ошибка с initData: ' + (e?.message || e));
      }
    }

    // Попытка без initData (если DEV_ALLOW_UNSAFE=true)
    try{
      const u = await whoAmI('');
      location.replace(u?.role === 'admin' ? '/admin' : '/staff');
    }catch(e){
      log('Без initData: ' + (e?.message || e));
      log('Откройте через кнопку WebApp в боте или временно включите DEV_ALLOW_UNSAFE=true.');
    }
  }

  main().catch(e=>log('Фатальная ошибка: ' + (e?.message || e)));
})();
