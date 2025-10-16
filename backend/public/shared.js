window.tg = window.Telegram && Telegram.WebApp ? Telegram.WebApp : null;
if (tg) tg.expand();

function getInitData() {
  return (tg && tg.initData) ? tg.initData : (localStorage.getItem('DEV_INIT_DATA') || '');
}

async function api(path, options = {}) {
  options.headers = Object.assign({}, options.headers || {}, {
    'Content-Type': 'application/json',
    'X-TG-INIT-DATA': getInitData(),
  });
  const base = (window.API_BASE || '') + path;
  const res = await fetch(base, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    const msg = (data && data.error) ? data.error : res.statusText;
    alert('Ошибка: ' + msg);
    throw new Error(msg);
  }
  return data;
}

window.AppAPI = { api, tg };
