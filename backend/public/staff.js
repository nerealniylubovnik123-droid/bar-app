// staff.js — обновлено для упрощённого интерфейса сотрудника:
// - без поставщиков
// - группы товаров по категориям (сворачиваемые)
// - каждая строка: товар + поле количества на одной линии

(function () {
  const state = {
    me: null,
    products: [],
    filtered: [],
    initData: null,
  };

  // Получаем initData из Telegram WebApp или из URL
  function resolveInitData() {
    try {
      if (window.Telegram?.WebApp?.initData) return Telegram.WebApp.initData;
    } catch (_) {}

    const url = new URL(window.location.href);
    const q = url.searchParams.get("initData");
    if (q) return q;

    if (url.hash.includes("initData=")) {
      const params = new URLSearchParams(url.hash.replace(/^#/, ""));
      return params.get("initData");
    }
    return null;
  }

  async function fetchMe() {
    const q = state.initData ? `?initData=${encodeURIComponent(state.initData)}` : "";
    const res = await fetch(`/api/me${q}`);
    if (!res.ok) throw new Error("Ошибка загрузки профиля");
    return res.json();
  }

  async function fetchProducts() {
    const q = state.initData ? `?initData=${encodeURIComponent(state.initData)}` : "";
    const res = await fetch(`/api/products${q}`);
    if (!res.ok) throw new Error("Ошибка загрузки товаров");
    return res.json();
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
            p.name.toLowerCase().includes(q) ||
            (p.category || "").toLowerCase().includes(q)
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
      const v = parseFloat(el.value.replace(",", "."));
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
    setTimeout(() => (el.hidden = true), 3000);
  }

  async function submit() {
    const items = collectItems();
    if (items.length === 0) return toast("Добавьте количество хотя бы по одному товару", false);

    const body = { items, initData: state.initData };
    const res = await fetch("/api/requisitions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      toast("Ошибка отправки", false);
      return;
    }

    clearAll();
    toast("Заявка отправлена ✅");
  }

  async function init() {
    state.initData = resolveInitData();
    try {
      state.me = await fetchMe();
      renderMe();
    } catch (e) {
      console.warn(e);
    }

    try {
      const data = await fetchProducts();
      state.products = Array.isArray(data) ? data.filter((p) => p.active !== 0) : [];
      state.filtered = state.products.slice();
      renderGroups();
    } catch (e) {
      toast("Ошибка загрузки товаров", false);
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
