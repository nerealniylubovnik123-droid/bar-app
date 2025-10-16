// shared.js — единые хелперы для фронтенда

export function hasTelegramSDK() {
  return typeof window !== "undefined" && !!window.Telegram && !!window.Telegram.WebApp && !!window.Telegram.WebApp.initDataUnsafe;
}

export function getInitData() {
  if (!hasTelegramSDK()) return null;
  const unsafe = window.Telegram.WebApp.initDataUnsafe;
  // Telegram отдаёт корректные поля user, auth_date, hash и т.д.
  return window.Telegram.WebApp.initData || null; // ВАЖНО: используем ровно ту строку, которую дал Telegram
}

export async function fetchJSON(url, init = {}) {
  const res = await fetch(url, init);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
  }
  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json") ? res.json() : null;
}

// универсальный обёртка: подмешивает initData только если есть SDK
export async function withInit(doFetch) {
  const initData = getInitData();
  const headers = {};
  if (initData) headers["X-TG-INIT-DATA"] = initData;
  return await doFetch(headers, initData);
}

// (опционально) показываем статус SDK/инициализации на главной
export function showDebugInitInfo(containerId = "userInfo") {
  const el = document.getElementById(containerId);
  if (!el) return;

  const sdk = hasTelegramSDK();
  const initData = getInitData();
  const hash = (() => {
    if (!initData) return "нет";
    try {
      const usp = new URLSearchParams(initData);
      return usp.get("hash") ? "есть" : "нет";
    } catch {
      return "нет";
    }
  })();

  el.textContent = `SDK: ${sdk ? "true" : "false"} | hash: ${hash} | initData: ${initData ? "получено" : "нет"}`;

  // если SDK=false, подскажем про DEV
  if (!sdk) {
    const warn = document.createElement("div");
    warn.style.fontSize = "12px";
    warn.style.opacity = "0.7";
    warn.style.marginTop = "4px";
    warn.textContent = "Откройте через кнопку WebApp в боте или временно включите DEV_ALLOW_UNSAFE=true на сервере.";
    el.parentElement?.appendChild(warn);
  }
}
