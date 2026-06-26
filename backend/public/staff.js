"use strict";

const API_BASE = location.origin;

async function API(path, method = "GET", data = null) {
  const opts = { method, headers: {} };
  const tg = window.Telegram?.WebApp;

  if (tg?.initData) opts.headers["X-TG-INIT-DATA"] = tg.initData;
  if (data) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(data);
  }

  const res = await fetch(API_BASE + path, opts);
  return await res.json().catch(() => ({}));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function statusLabel(status) {
  if (status === "ordered") return "Принята";
  if (status === "delivered") return "Приехала";
  return "Новая";
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

function renderProductsByCategory(products) {
  const container = document.getElementById("category-list");
  container.innerHTML = "";

  const map = new Map();
  for (const product of products) {
    const key = product.category || "Без категории";
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(product);
  }

  const sortedCategories = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], "ru"));

  for (const [category, items] of sortedCategories) {
    items.sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "ru"));

    const group = document.createElement("section");
    group.className = "group-block category-group is-collapsed";

    const title = document.createElement("button");
    title.type = "button";
    title.className = "group-title group-toggle";
    title.setAttribute("aria-expanded", "false");
    title.innerHTML = `
      <span>${escapeHtml(category)}</span>
      <span class="group-toggle-right">
        <small>${items.length} позиций</small>
        <span class="expand-mark">⌄</span>
      </span>
    `;

    const itemsWrap = document.createElement("div");
    itemsWrap.className = "group-items hidden";

    title.addEventListener("click", () => {
      const isOpen = group.classList.toggle("is-open");
      group.classList.toggle("is-collapsed", !isOpen);
      itemsWrap.classList.toggle("hidden", !isOpen);
      title.setAttribute("aria-expanded", String(isOpen));
    });

    group.appendChild(title);

    items.forEach((product) => {
      const row = document.createElement("div");
      row.className = "list-row product-row";
      row.innerHTML = `
        <div class="row-main">
          <div class="row-title">${escapeHtml(product.name)}</div>
          <div class="row-sub">${escapeHtml(product.unit)}</div>
        </div>
        <input id="qty-${product.id}" type="number" min="0" placeholder="0" class="qty-input">
      `;
      itemsWrap.appendChild(row);
    });

    group.appendChild(itemsWrap);
    container.appendChild(group);
  }

  container.querySelectorAll(".qty-input").forEach((input) => {
    input.addEventListener("input", updateSelectionSummary);
  });
  updateSelectionSummary();
}

function updateSelectionSummary() {
  const qtyInputs = document.querySelectorAll("[id^='qty-']");
  const selected = [...qtyInputs].filter((input) => Number(input.value) > 0).length;
  const count = document.getElementById("selected-count");
  const send = document.getElementById("send-btn");

  if (count) count.textContent = String(selected);
  if (send) send.disabled = selected === 0;
}

function loadProducts() {
  API("/api/products").then((r) => {
    if (!r.ok) return alert("Ошибка загрузки товаров");
    renderProductsByCategory(r.products);
  });
}

document.getElementById("send-btn").onclick = async () => {
  const qtyInputs = document.querySelectorAll("[id^='qty-']");
  const items = [];

  qtyInputs.forEach((input) => {
    const v = Number(input.value);
    if (v > 0) {
      const pid = Number(input.id.replace("qty-", ""));
      items.push({ product_id: pid, qty: v });
    }
  });

  if (items.length === 0) return alert("Выберите хотя бы один товар");

  const r = await API("/api/requisitions", "POST", { items });
  if (!r.ok) return alert(r.error);

  qtyInputs.forEach((input) => {
    input.value = "";
  });
  updateSelectionSummary();

  alert(`Заявка #${r.requisition_id} отправлена!`);
  loadActiveOrders();
};

function renderActiveOrders(requisitions) {
  const container = document.getElementById("active-orders");
  container.innerHTML = "";

  if (!requisitions || requisitions.length === 0) {
    container.innerHTML = "<div class='empty-state muted-text'>Активных заявок нет</div>";
    return;
  }

  requisitions.forEach((reqItem) => {
    const entry = document.createElement("div");
    entry.className = "req-entry is-open";

    const supplierRows = reqItem.orders.map((order) => {
      const itemsHtml = order.items.map((it) => `
        <div class="item-line">
          <span class="item-name">${escapeHtml(it.name)}</span>
          <span class="item-qty">${escapeHtml(it.qty)} ${escapeHtml(it.unit || "")}</span>
        </div>
      `).join("");

      const isDelivered = order.status === "delivered";

      return `
        <div class="supplier-block">
          <div class="supplier-line">
            <div class="supplier-line-main">
              <div class="row-title">${escapeHtml(order.supplier_name)}</div>
              <div class="row-sub">${order.items.length} позиций</div>
            </div>
            <div class="row-actions supplier-actions">
              <span class="status-badge ${escapeHtml(order.status)}">${statusLabel(order.status)}</span>
              <button class="ghost-btn mini-btn" ${isDelivered ? "disabled" : ""} onclick="markDelivered(${order.order_id})">
                ${isDelivered ? "Получено" : "Отметить"}
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
      <div class="req-summary static-summary compact-static-summary">
        <div class="requisition-summary-main">
          <div class="requisition-title-row compact-title-row">
            <span class="row-title">Заявка #${reqItem.requisition_id}</span>
            <span class="status-badge ${escapeHtml((reqItem.orders || []).every((o) => o.status === "delivered") ? "delivered" : (reqItem.orders || []).some((o) => o.status === "ordered" || o.status === "delivered") ? "ordered" : "pending")}">${statusLabel((reqItem.orders || []).every((o) => o.status === "delivered") ? "delivered" : (reqItem.orders || []).some((o) => o.status === "ordered" || o.status === "delivered") ? "ordered" : "pending")}</span>
          </div>
          <div class="summary-meta-row">
            <span class="summary-meta">${escapeHtml(formatShortDate(reqItem.created_at || ""))}</span>
            <span class="summary-meta">${reqItem.orders.length} поставщика</span>
          </div>
        </div>
      </div>
      <div class="req-details staff-open-details">
        ${supplierRows}
      </div>
    `;

    container.appendChild(entry);
  });
}

async function loadActiveOrders() {
  const r = await API("/api/my-orders");
  if (!r.ok) return;
  renderActiveOrders(r.requisitions);
}

async function markDelivered(orderId) {
  const r = await API(`/api/my-orders/${orderId}/delivered`, "POST");
  if (!r.ok) return alert(r.error || "Не удалось отметить получение");
  loadActiveOrders();
}

loadProducts();
loadActiveOrders();
