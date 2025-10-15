(() => {
  "use strict";

  const tg = window.Telegram?.WebApp;
  const isTelegram = !!(tg && (tg.initData || tg.initDataUnsafe));
  const INIT = isTelegram ? (tg.initData || (() => {
    try {
      const u = tg.initDataUnsafe, p = new URLSearchParams();
      if (u?.query_id) p.set("query_id", u.query_id);
      if (u?.user) p.set("user", JSON.stringify(u.user));
      if (u?.auth_date) p.set("auth_date", u.auth_date);
      if (u?.hash) p.set("hash", u.hash);
      return p.toString();
    } catch { return ""; }
  })()) : "debug";

  function getToken() {
    try { return localStorage.getItem("admToken") || ""; } catch { return ""; }
  }

  function headers(extra = {}) {
    const t = getToken();
    const h = { "Content-Type": "application/json", "X-From-Admin": "1", ...extra };
    if (INIT) h["X-Telegram-Init-Data"] = INIT;
    if (t) { h["Authorization"] = `Bearer ${t}`; h["X-Admin-Token"] = t; }
    return h;
  }

  const box = document.getElementById("status") || (() => {
    const d = document.createElement("div");
    d.id = "status";
    d.style.cssText = "padding:10px;background:#fff;border-bottom:1px solid #ddd;font:14px system-ui";
    document.body.prepend(d);
    return d;
  })();
  const say = (arr) => box.innerHTML = arr.map(x=>`<div>${x}</div>`).join("");

  async function api(path) {
    try {
      const r = await fetch(path, { headers: headers() });
      const j = await r.json().catch(()=> ({}));
      if (!r.ok || j.ok === false) throw new Error(j.error || r.statusText);
      return j;
    } catch (e) {
      console.warn("fetch", path, e);
      throw e;
    }
  }

  (async () => {
    say([`SDK: ${isTelegram}`, `initData: ${INIT ? "ok":"none"}`]);
    try {
      const res = await api("/api/products");
      const count = Array.isArray(res.products) ? res.products.length : 0;
      say([
        "✅ Режим админа активен",
        `Товаров получено: ${count}`,
        `<small>initData: ${INIT ? "ok":"none"}, X-From-Admin: 1</small>`
      ]);
    } catch (e) {
      say([
        "❌ Не удалось загрузить товары.",
        "Если открываешь не из Telegram:",
        "<b>1)</b> установи переменную <code>DEV_ALLOW_UNSAFE=true</code> на сервере,",
        "<b>2)</b> или добавь <code>admToken</code> в localStorage.",
        `<small>${e.message}</small>`
      ]);
    }
  })();
})();
