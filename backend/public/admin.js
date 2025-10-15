(() => {
  "use strict";

  // ======== env detection ========
  const tg = window.Telegram && window.Telegram.WebApp;
  const isTelegram = Boolean(tg && (tg.initData || tg.initDataUnsafe));
  const INIT_FALLBACK = "debug"; // используем вне Telegram, чтобы не блокироваться на initData

  // ======== UI helpers ========
  const $ = (sel) => document.querySelector(sel);
  const statusBox = $("#status") || (function(){
    const d = document.createElement("div");
    d.id = "status";
    d.style.cssText = "position:sticky;top:0;z-index:9999;padding:8px 12px;background:#fff;border-bottom:1px solid #eee;font:14px/1.4 system-ui";
    document.body.prepend(d);
    return d;
  })();

  function logStatus(lines) {
    statusBox.innerHTML = lines.map(l => `<div>${l}</div>`).join("");
  }

  // ======== initData builder (с фолбэком) ========
  function getInitDataString() {
    if (isTelegram && tg.initData) return tg.initData;
    if (isTelegram && tg.initDataUnsafe) {
      try {
        const p = new URLSearchParams();
        const u = tg.initDataUnsafe;
        if (u.query_id)     p.set("query_id", u.query_id);
        if (u.user)         p.set("user", JSON.stringify(u.user));
        if (u.start_param)  p.set("start_param", u.start_param);
        if (u.auth_date)    p.set("auth_date", String(u.auth_date));
        if (u.hash)         p.set("hash", u.hash);
        return p.toString();
      } catch {}
    }
    // ВНЕ Telegram: подставим стабильный фолбэк, который сервер примет
    return INIT_FALLBACK;
  }
  const INIT_DATA = getInitDataString();

  function getAdminToken() {
    try { return localStorage.getItem("admToken") || ""; } catch { return ""; }
  }
  function buildHeaders(extra = {}) {
    const token = getAdminToken();
    const h = { "Content-Type": "application/json", ...extra };
    if (INIT_DATA) h["X-Telegram-Init-Data"] = INIT_DATA;
    if (token) {
      h["Authorization"] = `Bearer ${token}`;
      h["X-Admin-Token"] = token;
    }
    return h;
  }

  async function apiPOST(path, body) {
    const res = await fetch(path, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({ ...(body || {}), initData: INIT_DATA })
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
    if (INIT_DATA) url.searchParams.set("initData", INIT_DATA);
    const res = await fetch(url, { headers: buildHeaders() });
    let json = null; try { json = await res.json(); } catch {}
    if (!res.ok || json?.ok === false) {
      const err = new Error(json?.error || res.statusText || `HTTP ${res.status}`);
      err.status = res.status; err.payload = json; throw err;
    }
    return json;
  }

  // ======== bootstrap ========
  (async function init() {
    try { tg?.ready?.(); } catch {}

    logStatus([
      "Определяем роль пользователя…",
      `SDK: ${isTelegram ? "true" : "false"}`,
      `hash: ${isTelegram ? (tg.initData || tg.initDataUnsafe?.hash ? "есть" : "нет") : "нет"}`,
      `initData: ${INIT_DATA ? "получено" : "нет"}`
    ]);

    // 1) пробуем POST /api/products (как в проде)
    try {
      await apiPOST("/api/products", {});
      logStatus([
        "Режим админа активен",
        `SDK: ${isTelegram ? "true" : "false"}`,
        "Загрузка товаров: OK (POST /api/products)"
      ]);
      // тут вызывать вашу отрисовку админки...
      return;
    } catch (e1) {
      // 2) пробуем GET /api/products (разрешён с initData=debug или с админ-токеном)
      try {
        await apiGET("/api/products");
        logStatus([
          "Режим админа активен",
          `SDK: ${isTelegram ? "true" : "false"}`,
          "Загрузка товаров: OK (GET /api/products)"
        ]);
        // тут вызывать вашу отрисовку админки...
        return;
      } catch (e2) {
        // Если сервер всё-таки не пустил — покажем краткую подсказку
        const hint = [
          "Не удалось получить список товаров.",
          "Проверьте одно из условий:",
          "• Откройте админку из Telegram WebApp (initData появится автоматически),",
          "• или добавьте админ-токен в localStorage.admToken,",
          "• или установите переменную окружения DEV_ALLOW_UNSAFE=true на сервере."
        ].join("<br>");
        logStatus([
          `SDK: ${isTelegram ? "true" : "false"}`,
          `hash: ${isTelegram ? (tg.initData || tg.initDataUnsafe?.hash ? "есть" : "нет") : "нет"}`,
          `initData: ${INIT_DATA ? "получено" : "нет"}`,
          `<span style="color:#c00">${hint}</span>`
        ]);
        console.warn("POST /api/products error:", e1);
        console.warn("GET /api/products error:", e2);
      }
    }
  })();

})();
