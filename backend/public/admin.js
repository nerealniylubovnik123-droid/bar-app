// admin.js — работает без initData. Роль определяется на бэке по tg_user_id.
// Источник tg_user_id: Telegram.WebApp.initDataUnsafe.user.id -> URL ?tg_user_id= -> localStorage -> prompt().

(function () {
  const state = {
    tgUserId: null,
    me: null,
    suppliers: [],
    products: [],
    requisitions: []
  };

  // ---- ID detection (без initData) ----
  function resolveTgUserId() {
    // 1) Telegram WebApp
    try {
      const id = window.Telegram?.WebApp?.initDataUnsafe?.user?.id;
      if (id) return Number(id);
    } catch (_) {}

    const url = new URL(window.location.href);
    // 2) query ?tg_user_id=
    const fromQuery = url.searchParams.get("tg_user_id");
    if (fromQuery && Number(fromQuery)) return Number(fromQuery);

    // 3) localStorage
    try {
      const ls = localStorage.getItem("tg_user_id");
      if (ls && Number(ls)) return Number(ls);
    } catch (_) {}

    return null;
  }

  function ensureTgUserId() {
    state.tgUserId = resolveTgUserId();
    if (state.tgUserId) {
      try { localStorage.setItem("tg_user_id", String(state.tgUserId)); } catch (_) {}
      return true;
    }
    const v = window.prompt("Введите ваш Telegram ID (число). Админ — 504348666:", "");
    if (!v || !Number(v)) return false;
    state.tgUserId = Number(v);
    try { localStorage.setItem("tg_user_id", String(state.tgUserId)); } catch (_) {}
    // Добавим в URL для наглядности
    const url = new URL(location.href);
    url.searchParams.set("tg_user_id", String(state.tgUserId));
    history.replaceState(null, "", url.toString());
    return true;
  }

  // ---- helpers ----
  function qstr() {
    return state.tgUserId ? `?tg_user_id=${encodeURIComponent(state.tgUserId)}` : "";
  }
  function authHeaders() {
    return state.tgUserId ? { "X-TG-USER-ID": String(state.tgUserId) } : {};
  }

  function toast(msg, ok = true) {
    let el = document.getElementById("toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "toast";
      el.className = "toast";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.className = `toast ${ok ? "ok" : "err"}`;
    el.hidden = false;
    setTimeout(() => (el.hidden = true), 3500);
  }

  // ---- API ----
  async function apiGet(path) {
    const res = await fetch(`${path}${qstr()}`, { headers: authHeaders() });
    if (!res.ok) throw new Error(await res.text().catch(() => "Ошибка запроса"));
    return res.json();
  }
  async function apiPost(path, body) {
    const res = await fetch(`${path}${qstr()}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(body || {})
    });
    if (!res.ok) throw new Error(await res.text().catch(() => "Ошибка запроса"));
    return res.json();
  }
  async function apiDelete(path) {
    const res = await fetch(`${path}${qstr()}`, {
      method: "DELETE",
      headers: authHeaders()
    });
    if (!res.ok) throw new Error(await res.text().catch(() => "Ошибка запроса"));
    return res.json();
  }

  // ---- UI render (минимум, без initData) ----
  function renderMe() {
    const el = document.getElementById("me");
    if (!el || !state.me) return;
    el.textContent = `${state.me.name || "Пользователь"} · ${state.me.role}`;
  }

  function renderSuppliers() {
    const wrap = document.getElementById("suppliers");
    if (!wrap) return;
    wrap.innerHTML = "";
    for (const s of state.suppliers) {
      const row = document.createElement("div");
      row.className = "product-row";
      const name = document.createElement("div");
      name.className = "product-name";
      name.textContent = s.name;
      const btn = document.createElement("button");
      btn.className = "btn btn-secondary";
      btn.textContent = "Удалить";
      btn.onclick = async () => {
        if (!confirm(`Удалить поставщика «${s.name}» и связанные данные?`)) return;
        try {
          await apiDelete(`/api/admin/suppliers/${s.id}`);
          toast("Поставщик удалён");
          await loadSuppliers();
        } catch (e) {
          toast(String(e.message || e), false);
        }
      };
      row.append(name, btn);
      wrap.appendChild(row);
    }
  }

  function renderProducts() {
    const wrap = document.getElementById("products");
    if (!wrap) return;
    wrap.innerHTML = "";
    for (const p of state.products) {
      const row = document.createElement("div");
      row.className = "product-row";
      const name = document.createElement("div");
      name.className = "product-name";
      name.textContent = `${p.name}${p.unit ? " · " + p.unit : ""}${p.category ? " · " + p.category : ""}`;
      const btn = document.createElement("button");
      btn.className = "btn btn-secondary";
      btn.textContent = "Удалить";
      btn.onclick = async () => {
        if (!confirm(`Удалить товар «${p.name}»?`)) return;
        try {
          await apiDelete(`/api/admin/products/${p.id}`);
          toast("Товар удалён");
          await loadProducts();
        } catch (e) {
          toast(String(e.message || e), false);
        }
      };
      row.append(name, btn);
      wrap.appendChild(row);
    }
  }

  function renderRequisitions() {
    const wrap = document.getElementById("requisitions");
    if (!wrap) return;
    wrap.innerHTML = "";
    for (const r of state.requisitions) {
      const row = document.createElement("div");
      row.className = "product-row";
      const name = document.createElement("div");
      name.className = "product-name";
      name.textContent = `#${r.id} · ${r.created_at} · ${r.user_name || ""}`;
      const btn = document.createElement("a");
      btn.className = "btn btn-secondary";
      btn.textContent = "Открыть";
      btn.href = `/api/admin/requisitions/${r.id}${qstr()}`;
      btn.target = "_blank";
      row.append(name, btn);
      wrap.appendChild(row);
    }
  }

  // ---- loaders ----
  async function loadMe() {
    state.me = await apiGet("/api/me");
    if (state.me.role !== "admin") {
      toast("Доступ только для администратора", false);
    }
    renderMe();
  }
  async function loadSuppliers() {
    state.suppliers = await apiGet("/api/admin/suppliers");
    renderSuppliers();
  }
  async function loadProducts() {
    state.products = await apiGet("/api/admin/products");
    renderProducts();
  }
  async function loadRequisitions() {
    state.requisitions = await apiGet("/api/admin/requisitions");
    renderRequisitions();
  }

  // ---- create forms ----
  function bindForms() {
    const fSup = document.getElementById("form-supplier");
    if (fSup) {
      fSup.addEventListener("submit", async (e) => {
        e.preventDefault();
        const name = fSup.querySelector("[name=name]").value.trim();
        const contact_note = fSup.querySelector("[name=contact_note]").value.trim();
        if (!name) return toast("Введите название поставщика", false);
        try {
          await apiPost("/api/admin/suppliers", { name, contact_note });
          fSup.reset();
          toast("Поставщик добавлен");
          await loadSuppliers();
        } catch (e2) {
          toast(String(e2.message || e2), false);
        }
      });
    }

    const fProd = document.getElementById("form-product");
    if (fProd) {
      fProd.addEventListener("submit", async (e) => {
        e.preventDefault();
        const name = fProd.querySelector("[name=name]").value.trim();
        const unit = fProd.querySelector("[name=unit]").value.trim();
        const category = fProd.querySelector("[name=category]").value.trim() || "Общее";
        const supplier_id = Number(fProd.querySelector("[name=supplier_id]").value) || null;
        if (!name) return toast("Введите название товара", false);
        try {
          await apiPost("/api/admin/products", { name, unit, category, supplier_id });
          fProd.reset();
          toast("Товар добавлен");
          await loadProducts();
        } catch (e2) {
          toast(String(e2.message || e2), false);
        }
      });
    }
  }

  // ---- init ----
  async function init() {
    if (!ensureTgUserId()) {
      toast("Не указан Telegram ID", false);
      return;
    }

    // Telegram UI init (необязательно)
    try { window.Telegram?.WebApp?.expand?.(); } catch (_) {}

    renderMe();
    bindForms();

    try { await loadMe(); } catch (e) { toast(String(e.message || e), false); }
    try { await loadSuppliers(); } catch (e) { console.warn(e); }
    try { await loadProducts(); } catch (e) { console.warn(e); }
    try { await loadRequisitions(); } catch (e) { console.warn(e); }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
