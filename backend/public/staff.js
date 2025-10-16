/* staff.js — новая версия (аккордеоны по категориям, без отображения поставщика) */
import { getInitData, withInit, fetchJSON } from "./shared.js";

const state = {
  products: [],
  byCat: new Map(),
  expanded: new Set(), // сохранение развёрнутых групп в сессии
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
  // сортировка: категории по алфавиту, внутри — по имени
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
      input.addEventListener("input", onAnyQtyChange);

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
    const qty = parseFloat(input.value.replace(",", "."));
    if (Number.isFinite(qty) && qty > 0) {
      items.push({ product_id: pid, qty });
    }
  });
  return items;
}

function validateSubmit() {
  const has = collectItems().length > 0;
  els.submitBtn.disabled = !has;
}

function onAnyQtyChange() {
  validateSubmit();
}

async function submit() {
  const items = collectItems();
  if (items.length === 0) return;

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
      // очистить поля
      els.catalog.querySelectorAll('input[type="number"]').forEach((i) => (i.value = ""));
      validateSubmit();
      els.submitBtn.textContent = "Готово ✅";
      setTimeout(() => (els.submitBtn.textContent = "Отправить заявку"), 1200);
      return;
    }
    throw new Error("Ошибка сервера");
  } catch (e) {
    console.error(e);
    alert("Не удалось отправить заявку. Проверьте соединение и попробуйте ещё раз.");
    els.submitBtn.textContent = "Отправить заявку";
    validateSubmit();
  }
}

async function main() {
  // показать краткую информацию о пользователе
  try {
    const me = await withInit((headers) => fetchJSON("/api/me", { headers }));
    if (me?.name) els.userInfo.textContent = me.name;
  } catch (_) {}

  // получить каталог (без показа поставщиков)
  const products = await withInit((headers) => fetchJSON("/api/products", { headers }));
  state.products = Array.isArray(products) ? products : [];
  // удаляем возможные следы снапшота поставщика, если пришли
  state.products = state.products.map((p) => {
    const copy = { ...p };
    delete copy.supplier_id;
    delete copy.supplier_name;
    return copy;
  });
  state.byCat = groupByCategory(state.products);

  render();
  els.submitBtn.addEventListener("click", submit);
}

main().catch((e) => {
  console.error(e);
  els.loading.textContent = "Ошибка загрузки. Обновите страницу.";
});
