function tg() {
  return window.Telegram?.WebApp?.initData || "";
}

async function API(url, method = "GET", data = null) {
  const r = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-TG-INIT-DATA": tg()
    },
    body: data ? JSON.stringify(data) : null
  });

  return r.json().catch(() => ({ ok: false, error: "Invalid JSON" }));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function jsString(value) {
  return JSON.stringify(String(value ?? ""));
}

function statusLabel(status) {
  if (status === "ordered") return "Принята";
  if (status === "delivered") return "Приехала";
  return "Новая";
}

function requisitionStatus(orders = []) {
  if (!orders.length) return "pending";
  if (orders.every((order) => order.status === "delivered")) return "delivered";
  if (orders.some((order) => order.status === "ordered" || order.status === "delivered")) return "ordered";
  return "pending";
}

function switchAdminTab(tab) {
  const catalog = document.getElementById("page-catalog");
  const requisitions = document.getElementById("page-requisitions");
  const tabCatalog = document.getElementById("tab-catalog");
  const tabRequisitions = document.getElementById("tab-requisitions");

  const isCatalog = tab === "catalog";
  catalog.classList.toggle("hidden", !isCatalog);
  requisitions.classList.toggle("hidden", isCatalog);
  tabCatalog.classList.toggle("active", isCatalog);
  tabRequisitions.classList.toggle("active", !isCatalog);

  if (!isCatalog) loadOwnerRequisitions();
}

function toggleRequisition(button) {
  const entry = button.closest(".req-entry");
  const details = entry?.querySelector(".req-details");
  if (!entry || !details) return;

  const isOpen = entry.classList.toggle("is-open");
  details.classList.toggle("hidden", !isOpen);
  button.setAttribute("aria-expanded", String(isOpen));
}

function formatShortDate(value) {
  const date = new Date(String(value || "").replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return String(value || "");

  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  return `${dd}.${mm} · ${hh}:${mi}`;
}

function formatSupplierOrderText(_reqItem, order) {
  return order.items.map((it) => {
    const unit = it.unit ? ` ${it.unit}` : "";
    return `${it.name} — ${it.qty}${unit}`;
  }).join("\n");
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

async function copySupplierOrder(button) {
  const text = button.dataset.copyText || "";
  if (!text) return;

  try {
    await copyTextToClipboard(text);
    const originalText = button.textContent;
    button.textContent = "Скопировано";
    button.disabled = true;

    window.setTimeout(() => {
      button.textContent = originalText || "Копировать";
      button.disabled = false;
    }, 1200);
  } catch (error) {
    alert("Не удалось скопировать текст");
  }
}

async function loadSuppliers() {
  const r = await API("/api/admin/suppliers");
  if (!r.ok) return console.warn("loadSuppliers:", r.error);

  const box = document.getElementById("suppliers");
  box.innerHTML = "";

  if (!r.suppliers?.length) {
    box.innerHTML = `<div class="empty-state muted-text">Поставщиков пока нет</div>`;
    return;
  }

  r.suppliers.forEach((s) => {
    const row = document.createElement("div");
    row.className = "list-row supplier-row";
    row.innerHTML = `
      <div class="row-main">
        <div class="row-title">${escapeHtml(s.name)}</div>
        <div class="row-sub">${escapeHtml(s.contact_note || "Без заметки")}</div>
      </div>
      <div class="row-actions">
        <button class="ghost-btn mini-btn" onclick='editSupplier(${s.id}, ${jsString(s.name)}, ${jsString(s.contact_note || "")})'>Ред</button>
        <button class="ghost-btn mini-btn danger-btn" onclick="deleteSupplier(${s.id})">Удал</button>
      </div>
    `;
    box.appendChild(row);
  });
}

async function addSupplier() {
  const name = document.getElementById("sup-name").value.trim();
  const note = document.getElementById("sup-note").value.trim();
  if (!name) return alert("Введите название");

  const r = await API("/api/admin/suppliers", "POST", {
    name,
    contact_note: note
  });
  if (!r.ok) return alert(r.error);

  document.getElementById("sup-name").value = "";
  document.getElementById("sup-note").value = "";

  await Promise.all([loadSuppliers(), loadProductFormSuppliers()]);
}

async function editSupplier(id, currentName = "", currentNote = "") {
  const name = prompt("Новое название:", currentName);
  if (!name) return;

  const note = prompt("Новая заметка:", currentNote);
  const r = await API(`/api/admin/suppliers/${id}`, "PATCH", {
    name,
    contact_note: note || ""
  });
  if (!r.ok) return alert(r.error);

  await Promise.all([loadSuppliers(), loadProductFormSuppliers()]);
}

async function deleteSupplier(id) {
  if (!confirm("Удалить поставщика?")) return;

  const r = await API(`/api/admin/suppliers/${id}`, "DELETE");
  if (!r.ok) return alert(r.error);

  await Promise.all([loadSuppliers(), loadProductFormSuppliers(), loadProducts()]);
}

async function loadCategories() {
  const r = await API("/api/admin/categories");
  if (!r.ok) return console.warn("loadCategories:", r.error);

  const sel = document.getElementById("prod-category");
  sel.innerHTML = "";

  r.categories.forEach((cat) => {
    const o = document.createElement("option");
    o.value = cat;
    o.textContent = cat;
    sel.appendChild(o);
  });

  const o2 = document.createElement("option");
  o2.value = "__new";
  o2.textContent = "— новая категория —";
  sel.appendChild(o2);

  if (!r.categories.length) sel.value = "__new";
}

async function loadProducts() {
  const r = await API("/api/admin/products");
  if (!r.ok) return console.warn("loadProducts:", r.error);

  const box = document.getElementById("products");
  box.innerHTML = "";

  if (!r.products?.length) {
    box.innerHTML = `<div class="empty-state muted-text">Товаров пока нет</div>`;
    return;
  }

  const groups = {};
  r.products.forEach((p) => {
    const key = p.category || "Без категории";
    if (!groups[key]) groups[key] = [];
    groups[key].push(p);
  });

  Object.entries(groups).forEach(([category, items]) => {
    const group = document.createElement("section");
    group.className = "group-block";

    const head = document.createElement("div");
    head.className = "group-title";
    head.innerHTML = `<span>${escapeHtml(category)}</span><small>${items.length} позиций</small>`;
    group.appendChild(head);

    items.forEach((p) => {
      const row = document.createElement("div");
      row.className = "list-row product-line";
      row.innerHTML = `
        <div class="row-main">
          <div class="row-title">${escapeHtml(p.name)} <span class="inline-unit">${escapeHtml(p.unit)}</span></div>
          <div class="row-sub">Поставщик: ${escapeHtml(p.supplier_name || "—")}</div>
        </div>
        <div class="row-actions">
          <button class="ghost-btn mini-btn" onclick='editProduct(${p.id}, ${jsString(p.name)}, ${jsString(p.unit)}, ${jsString(p.category)}, ${Number(p.supplier_id || 0)})'>Ред</button>
          <button class="ghost-btn mini-btn danger-btn" onclick="deleteProduct(${p.id})">Удал</button>
          <button class="ghost-btn mini-btn" onclick="editAlt(${p.id})">Alt</button>
        </div>
      `;
      group.appendChild(row);
    });

    box.appendChild(group);
  });
}

async function loadProductFormSuppliers() {
  const r = await API("/api/admin/suppliers");
  if (!r.ok) return console.warn("loadProductFormSuppliers:", r.error);

  const sel = document.getElementById("prod-supplier");
  sel.innerHTML = "";

  r.suppliers.forEach((s) => {
    const o = document.createElement("option");
    o.value = s.id;
    o.textContent = s.name;
    sel.appendChild(o);
  });
}

async function addProduct() {
  const name = document.getElementById("prod-name").value.trim();
  const unit = document.getElementById("prod-unit").value.trim();

  const category = (() => {
    const sel = document.getElementById("prod-category");
    const custom = document.getElementById("prod-category-new").value.trim();
    if (custom) return custom;
    if (sel && sel.value && sel.value !== "__new") return sel.value;
    return "";
  })();

  const supplier_id = Number(document.getElementById("prod-supplier").value);

  if (!name) return alert("Введите название");
  if (!unit) return alert("Введите ед. изм.");
  if (!category) return alert("Категория обязательна");
  if (!supplier_id) return alert("Выберите поставщика");

  const r = await API("/api/admin/products", "POST", {
    name,
    unit,
    category,
    supplier_id
  });
  if (!r.ok) return alert(r.error);

  document.getElementById("prod-name").value = "";
  document.getElementById("prod-unit").value = "";
  document.getElementById("prod-category-new").value = "";

  await Promise.all([loadProducts(), loadCategories()]);
}

async function editProduct(id, currentName = "", currentUnit = "", currentCategory = "", currentSupplierId = 0) {
  const name = prompt("Название:", currentName);
  if (!name) return;

  const unit = prompt("Ед. изм.:", currentUnit);
  if (!unit) return;

  const category = prompt("Категория:", currentCategory);
  if (!category) return;

  const supplier = prompt("ID основного поставщика:", String(currentSupplierId || ""));
  if (!supplier) return;

  const r = await API(`/api/admin/products/${id}`, "PATCH", {
    name,
    unit,
    category,
    supplier_id: Number(supplier)
  });
  if (!r.ok) return alert(r.error);

  await Promise.all([loadProducts(), loadCategories(), loadProductFormSuppliers()]);
}

async function deleteProduct(id) {
  if (!confirm("Удалить товар?")) return;

  const r = await API(`/api/admin/products/${id}`, "DELETE");
  if (!r.ok) return alert(r.error);

  await Promise.all([loadProducts(), loadCategories()]);
}

async function editAlt(productId) {
  const name = prompt("Введите НАЗВАНИЕ поставщика:");
  if (!name) return;

  const suppliers = await API("/api/admin/suppliers");
  if (!suppliers.ok) return alert("Ошибка загрузки поставщиков");

  const supplier = suppliers.suppliers.find(
    (s) => s.name.toLowerCase() === name.trim().toLowerCase()
  );

  if (!supplier) return alert("Поставщик не найден!");

  const r = await API(`/api/admin/products/${productId}/alternatives`, "POST", {
    supplier_id: supplier.id
  });
  if (!r.ok) return alert(r.error);

  alert(`Добавлен альтернативный поставщик: ${supplier.name}`);
}

async function loadOwnerRequisitions() {
  const r = await API("/api/admin/requisitions");
  if (!r.ok) return console.warn("loadOwnerRequisitions:", r.error);

  const box = document.getElementById("requisitions");
  box.innerHTML = "";

  if (!r.requisitions?.length) {
    box.innerHTML = `<div class="empty-state muted-text">Заявок за последний месяц пока нет</div>`;
    return;
  }

  r.requisitions.forEach((reqItem) => {
    const reqStatus = requisitionStatus(reqItem.orders);
    const entry = document.createElement("div");
    entry.className = `req-entry req-${reqStatus}`;

    const supplierRows = reqItem.orders.map((order) => {
      const copyText = formatSupplierOrderText(reqItem, order);
      const itemsHtml = order.items.map((it) => `
        <div class="item-line">
          <span class="item-name">${escapeHtml(it.name)}</span>
          <span class="item-qty">${escapeHtml(it.qty)} ${escapeHtml(it.unit || "")}</span>
        </div>
      `).join("");

      const canMarkOrdered = order.status === "pending";

      return `
        <div class="supplier-block">
          <div class="supplier-line">
            <div class="supplier-line-main">
              <div class="row-title">${escapeHtml(order.supplier_name)}</div>
              <div class="row-sub">${order.items.length} позиций · поставщик #${escapeHtml(order.supplier_id)}</div>
            </div>
            <div class="row-actions supplier-actions">
              <span class="status-badge ${escapeHtml(order.status)}">${statusLabel(order.status)}</span>
              <button type="button" class="ghost-btn mini-btn copy-supplier-btn" data-copy-text="${escapeHtml(copyText)}">
                Копировать
              </button>
              <button class="ghost-btn mini-btn" ${canMarkOrdered ? "" : "disabled"} onclick="event.stopPropagation(); markOrdered(${order.order_id})">
                ${canMarkOrdered ? "Заказал" : "Отмечено"}
              </button>
            </div>
          </div>
          <div class="supplier-items">
            ${itemsHtml}
          </div>
        </div>
      `;
    }).join("");

    entry.innerHTML = `
      <button type="button" class="req-summary" aria-expanded="false" onclick="toggleRequisition(this)">
        <div class="requisition-summary-main">
          <div class="requisition-title-row compact-title-row">
            <span class="row-title">Заявка #${reqItem.requisition_id}</span>
            <span class="summary-user">${escapeHtml(reqItem.user_name || reqItem.user_id || "Сотрудник")}</span>
          </div>
          <div class="summary-meta-row">
            <span class="summary-meta">${escapeHtml(formatShortDate(reqItem.created_at || ""))}</span>
            <span class="summary-meta">${reqItem.orders.length} поставщика</span>
          </div>
        </div>
        <div class="summary-right">
          <span class="status-badge ${reqStatus}">${statusLabel(reqStatus)}</span>
          <span class="expand-mark">⌄</span>
        </div>
      </button>
      <div class="req-details hidden">
        <div class="meta-row req-meta-row">
          <span>Дата: ${escapeHtml(reqItem.created_at || "")}</span>
          <span>Поставщиков: ${reqItem.orders.length}</span>
        </div>
        ${supplierRows}
      </div>
    `;

    box.appendChild(entry);
  });

  box.querySelectorAll(".copy-supplier-btn").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      copySupplierOrder(button);
    });
  });
}

async function markOrdered(orderId) {
  const r = await API(`/api/admin/orders/${orderId}/ordered`, "POST");
  if (!r.ok) return alert(r.error || "Не удалось отметить заказ");
  await loadOwnerRequisitions();
}

loadSuppliers();
loadCategories();
loadProductFormSuppliers();
loadProducts();
loadOwnerRequisitions();
