/* staff.js — версия с ролевым гардом и аккордеонами */
import { getInitData, withInit, fetchJSON } from "./shared.js";

const state = {
  products: [],
  byCat: new Map(),
  expanded: new Set(),
};

const els = {
  loading: document.getElementById("loading"),
  catalog: document.getElementById("catalog"),
  submitBtn: document.getElementById("submitBtn"),
  userInfo: document.getElementById("userInfo"),
};

function groupByCategory(products) {
  const byCat = new Map();
  for (const p of products) {
    const cat = (p.category || "Прочее").trim() || "Прочее";
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat).push(p);
  }
  return new Map(
    [...byCat.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], "ru"))
      .map(([cat, arr]) => [cat, arr.sort((x, y) => x.name.localeCompare(y.name, "ru"))])
  );
}

function render() {
  els.catalog.innerHTML = "";
  const acc = document.createElement("div");
  acc.className = "accordion";

  for (const [cat, items] of state.byCat.entries()) {
    const item = document.createElement("div");
    item.className = "acc-item";
    if (state.expanded.has(cat)) item.classList.add("open");

    const head = document.createElement("div");
    head.className = "acc-head";
    head.innerHTML = `<span>${cat}</span><span class="chev">▶</span>`;
    head.addEventListener("click", () => {
      item.classList.toggle("open");
      if (item.classList.contains("open")) state.expanded.add(cat);
      else state.expanded.delete(cat);
    });

    const body = document.createElement("div");
    body.className = "acc-body";
    const ul = document.createElement("ul");
    ul.className = "list";

    for (const p of items) {
      const li = document.createElement("li");
      li.className = "row";
      li.dataset.pid = p.id;

      const title = document.createElement("div");
      title.className = "row-title";
      title.textContent = p.name;
      if (p.unit) {
        const unit = document.createElement("span");
        unit.className = "unit";
        unit.textContent = `(${p.unit})`;
        title.appendChild(unit);
      }

      const qty = document.createElement("div");
      qty.className = "qty";
      const input = document.createElement("input");
      input.type = "number";
      input.min = "0";
      input.step = "any";
      input.inputMode = "decimal";
      input.placeholder = "0";
      input.addEventListener("input", validateSubmit);

      qty.appendChild(input);
      li.appendChild(title);
      li.appendChild(qty);
      ul.appendChild(li);
    }

    body.appendChild(ul);
    item.appendChild(head);
    item.appendChild(body);
    acc.appendChild(item);
  }

  els.catalog.appendChild(acc);
  els.loading.style.display = "none";
  els.catalog.style.display = "block";
  validateSubmit();
}

function collectItems() {
  const items = [];
  els.catalog.querySelectorAll(".row").forEach((row) => {
    const pid = Number(row.dataset.pid);
    const input = row.querySelector('input[type="number"]');
    const v = (input.value || "").toString().replace(",", ".");
    const qty = parseFloat(v);
    if (Number.isFinite(qty) && qty > 0) items.push({ product_id: pid, qty });
  });
  return items;
}

function validateSubmit() {
  els.submitBtn.disabled = collectItems().length === 0;
}

async function submit() {
  const items = collectItems();
  if (!items.length) return;

  els.submitBtn.disabled = true;
  els.submitBtn.textContent = "Отправка…";
  try {
    const res = await withInit((headers, initData) =>
      fetchJSON("/api/requisitions", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ items, initData }),
      })
    );
    if (res?.ok) {
      els.catalog.querySelectorAll('input[type="number"]').forEach((i) => (i.value = ""));
      validateSubmit();
      els.submitBtn.textContent = "Готово ✅";
      setTimeout(() => (els.submitBtn.textContent = "Отправить заявку"), 1200);
      return;
    }
    throw new Error("Server error");
  } catch (e) {
    console.error(e);
    alert("Не удалось отправить заявку. Попробуйте ещё раз.");
    els.submitBtn.textContent = "Отправить заявку";
    validateSubmit();
  }
}

async function main() {
  // 1) Ролевой гард: админов уводим на /admin
  let me = null;
  try {
    me = await withInit((headers) => fetchJSON("/api/me", { headers }));
  } catch (e) {
    // если сервер в проде и мы вне Telegram — /api/me вернёт 401/403
    // в деве с DEV_ALLOW_UNSAFE=true — пройдёт
  }
  if (me && me.role === "admin") {
    window.location.replace("/admin");
    return;
  }

  // Показать имя пользователя (если есть)
  if (me?.name) els.userInfo.textContent = me.name;

  // 2) Загрузка каталога
  const products = await withInit((headers) => fetchJSON("/api/products", { headers }));
  state.products = Array.isArray(products) ? products : [];
  state.products = state.products.map((p) => {
    const c = { ...p };
    delete c.supplier_id;
    delete c.supplier_name;
    return c;
    });
  state.byCat = groupByCategory(state.products);

  render();
  els.submitBtn.addEventListener("click", submit);
}

main().catch((e) => {
  console.error(e);
  els.loading.textContent = "Ошибка загрузки. Обновите страницу.";
});
