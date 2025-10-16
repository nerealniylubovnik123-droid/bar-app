// staff.js — фикс Missing initData:
// - initData из Telegram, URL, localStorage('tg_init_data')
// - если нет — prompt() → сохраняем в localStorage и перезагружаем
// - отправляем initData в query, заголовке X-TG-INIT-DATA и (для POST) в теле

(function () {
  const state = {
    me: null,
    products: [],
    filtered: [],
    initData: null,
  };

  function resolveInitData() {
    // 1) Telegram WebApp
    try {
      if (window.Telegram?.WebApp?.initData) return Telegram.WebApp.initData;
    } catch (_) {}

    const url = new URL(window.location.href);
    // 2) query ?initData=...
    const q = url.searchParams.get("initData");
    if (q) return q;

    // 3) hash #initData=...
    if (url.hash && url.hash.includes("initData=")) {
      try {
        const params = new URLSearchParams(url.hash.replace(/^#/, ""));
        const h = params.get("initData");
        if (h) return h;
      } catch (_) {}
    }

    // 4) localStorage
    try {
      const ls = localStorage.getItem("tg_init_data");
      if (ls) return ls;
    } catch (_) {}

    return null;
  }

  function ensureInitDataOrPrompt() {
    if (state.initData) return true;
    // Попросим вставить initData вручную (для дев/стенда)
    const v = window.prompt(
      "Требуется Telegram WebApp initData.\nВставьте строку initData сюда (или откройте страницу из Telegram):",
      ""
    );
    if (v && v.trim().length > 0) {
      state.initData = v.trim();
      try {
        localStorage.setItem("tg_init_data", state.initData);
      } catch (_) {}
      // перезагружаем, чтобы вся логика пошла с initData
      location.replace(location.pathname + "?initData=" + encodeURIComponent(state.initData));
      return false; // сейчас произойдет reload
    }
    return false;
  }

  function extractList(payload) {
    if (Array.isArray(payload)) return payload;
    if (payload && Array.isArray(payload.products)) return payload.products;
    if (payload && Array.isArray(payload.data)) return payload.data;
    if (payload && Array.isArray(payload.items)) return payload.items;
    return [];
  }

  async function fetchMe() {
    const q = state.initData ? `?initData=${encodeURIComponent(state.initData)}` : "";
    const res = await fetch(`/api/me${q}`, {
      headers: state.initData ? { "X-TG-INIT-DATA": state.initData } : {},
    });
    if (!res.ok) throw new Error(await res.text().catch(() => "Ошибка загрузки профиля"));
    return res.json();
  }

  async function fetchProducts() {
    const q = state.initData ? `?initData=${encodeURIComponent(state.initData)}` : "";
    const res = await fetch(`/api/products${q}`, {
      headers: state.initData ? { "X-TG-INIT-DATA": state.initData } : {},
    });
    if (!res.ok) throw new Error(await res.text().catch(() => "Ошибка загрузки товаров"));
    const data = await res.json().catch(() => []);
    return extractList(data);
  }

  function groupByCategory(list) {
    const map = new Map();
    for (const p of list) {
      const cat = (p.category || "Без категории").trim();
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat).push(p);
    }
    return new Map(
      [...map.entries()]
        .sort((a, b) => a[0].localeCompare(b[0], "ru"))
        .map(([cat, items]) => [
          cat,
          items.sort((x, y) => x.name.localeCompare(y.name, "ru")),
        ])
    );
  }

  function renderMe() {
    const el = document.getElementById("me");
    if (state.me)
      el.textContent = `${state.me.name || "Сотрудник"}${state.me.role ? " · " + state.me.role : ""}`;
  }

  function makeProductRow(p) {
    const row = document.createElement("div");
    row.className = "product-row";

    const name = document.createElement("div");
    name.className = "product-name";
    name.textContent = p.name;

    const qty = document.createElement("input");
    qty.type = "number";
    qty.min = "0";
    qty.step = "0.01";
    qty.placeholder = "0";
    qty.className = "qty-input";
    qty.dataset.productId = p.id;

    row.append(name, qty);
    return row;
  }

  function makeGroup(cat, items) {
    const details = document.createElement("details");
    details.className = "group";
    details.open = false;

    const summary = document.createElement("summary");
    summary.className = "group-title";
    summary.textContent = `${cat} (${items.length})`;

    const list = document.createElement("div");
    list.className = "group-list";
    for (const p of items) list.appendChild(makeProductRow(p));

    details.append(summary, list);
    return details;
  }

  function renderGroups() {
    const container = document.getElementById("groups");
    container.innerHTML = "";
    const groups = groupByCategory(state.filtered);
    for (const [cat, items] of groups.entries()) {
      container.appendChild(makeGroup(cat, items));
    }
  }

  function applySearch() {
    const q = document.getElementById("search").value.trim().toLowerCase();
    state.filtered = q
      ? state.products.filter(
          (p) =>
            String(p.name || "").toLowerCase().includes(q) ||
            String(p.category || "").toLowerCase().includes(q)
        )
      : state.products.slice();
    renderGroups();
  }

  function clearAll() {
    document.getElementById("search").value = "";
    document.querySelectorAll(".qty-input").forEach((el) => (el.value = ""));
  }

  function collectItems() {
    const items = [];
    document.querySelectorAll(".qty-input").forEach((el) => {
      const v = parseFloat(String(el.value).replace(",", "."));
      if (!isNaN(v) && v > 0)
        items.push({ product_id: Number(el.dataset.productId), qty: v });
    });
    return items;
  }

  function toast(msg, ok = true) {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.className = `toast ${ok ? "ok" : "err"}`;
    el.hidden = false;
    setTimeout(() => (el.hidden = true), 3500);
  }

  async function submit() {
    const items = collectItems();
    if (items.length === 0) return toast("Добавьте количество хотя бы по одному товару", false);

    const body = { items };
    if (state.initData) body.initData = state.initData;

    const res = await fetch("/api/requisitions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(state.initData ? { "X-TG-INIT-DATA": state.initData } : {}),
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const t = await res.text().catch(() => "Ошибка отправки");
      toast(t || "Ошибка отправки", false);
      return;
    }

    clearAll();
    toast("Заявка отправлена ✅");
  }

  async function init() {
    state.initData = resolveInitData();

    // Если нет initData — запросим у пользователя (dev-стенд)
    if (!state.initData) {
      const willContinue = ensureInitDataOrPrompt();
      if (!willContinue) return; // произойдёт перезагрузка или пользователь отменил
    }

    try {
      state.me = await fetchMe();
      renderMe();
    } catch (e) {
      console.warn("ME error:", e);
    }

    try {
      const list = await fetchProducts();
      state.products = list.filter((p) =>
        typeof p.active === "undefined" ? true : !!p.active
      );
      state.filtered = state.products.slice();
      renderGroups();
    } catch (e) {
      console.error("PRODUCTS error:", e);
      toast(
        typeof e?.message === "string" && e.message.length < 200
          ? e.message
          : "Ошибка загрузки товаров",
        false
      );
    }

    document.getElementById("search").addEventListener("input", applySearch);
    document.getElementById("btnClear").addEventListener("click", () => {
      clearAll();
      applySearch();
    });
    document.getElementById("btnSubmit").addEventListener("click", submit);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
