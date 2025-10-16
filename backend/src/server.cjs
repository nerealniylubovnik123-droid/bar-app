/**
 * server.cjs — основной сервер Express для bar-app
 * Telegram WebApp авторизация, SQLite (better-sqlite3)
 * Версия с поддержкой JSON каталога (/mnt/data/catalog.json)
 */

require("dotenv").config();
const express = require("express");
const compression = require("compression");
const helmet = require("helmet");
const morgan = require("morgan");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
// ✅ кросс-совместимый fetch: встроенный в Node 18+, иначе — динамический импорт node-fetch
const fetch = global.fetch || ((...a) => import("node-fetch").then(m => m.default(...a)));
const Database = require("better-sqlite3");

// === модуль каталога JSON ===
const {
  exportCatalogToJson,
  importCatalogFromJsonIfEmpty,
} = require("./catalogStore.cjs");

// === инициализация ===
const app = express();
const PORT = process.env.PORT || 8080;
const DEV_ALLOW_UNSAFE = process.env.DEV_ALLOW_UNSAFE === "true";
const ADMIN_TG_IDS = (process.env.ADMIN_TG_IDS || "")
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);
const BOT_TOKEN = process.env.BOT_TOKEN || "";
const DB_FILE =
  process.env.DB_FILE ||
  process.env.SQLITE_PATH ||
  path.resolve("./backend/data.sqlite");

// === модули безопасности и логов ===
app.use(helmet());
app.use(compression());
app.use(morgan("tiny"));
app.use(express.json({ limit: "1mb" }));
app.use(
  cors({
    origin: (_o, cb) => cb(null, true),
  })
);

// === подключение БД ===
const db = new Database(DB_FILE);
db.pragma("journal_mode = WAL");

// === миграция схемы (упрощённо) ===
function migrate() {
  const schemaFile = path.resolve(__dirname, "../sql/schema.sql");
  if (fs.existsSync(schemaFile)) {
    const schema = fs.readFileSync(schemaFile, "utf8");
    db.exec(schema);
  }
}
migrate();

// === определяем, какая колонка user_id или created_by ===
function ensureSchema() {
  const cols = db
    .prepare("PRAGMA table_info(requisitions)")
    .all()
    .map((r) => r.name);
  if (cols.includes("created_by")) return "created_by";
  if (cols.includes("user_id")) return "user_id";
  try {
    db.exec("ALTER TABLE requisitions ADD COLUMN user_id INTEGER");
  } catch (_) {}
  return "user_id";
}
const REQ_USER_COL = ensureSchema();

// === импорт/экспорт каталога при старте ===
try {
  const result = importCatalogFromJsonIfEmpty(db);
  console.log("[catalog] import:", result.imported ? "done" : `skipped (${result.reason})`);
  exportCatalogToJson(db);
  console.log("[catalog] export: done");
} catch (e) {
  console.warn("[catalog] bootstrap failed:", e?.message || e);
}

// === Telegram auth ===
function verifyTelegramInitData(initData) {
  if (DEV_ALLOW_UNSAFE) return true;
  if (!BOT_TOKEN) return false;
  const urlSearchParams = new URLSearchParams(initData);
  const hash = urlSearchParams.get("hash");
  urlSearchParams.delete("hash");
  const dataCheckString = Array.from(urlSearchParams.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const crypto = require("crypto");
  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(BOT_TOKEN)
    .digest();
  const calcHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");
  return calcHash === hash;
}

function authMiddleware(req, res, next) {
  try {
    let initData =
      req.headers["x-tg-init-data"] ||
      req.query.initData ||
      req.body?.initData;

    // ✅ DEV-фолбэк: теперь роль по умолчанию — staff (безопаснее)
    if (!initData && DEV_ALLOW_UNSAFE) {
      req.user = { id: 1, name: "Dev", role: "staff" };
      return next();
    }

    if (!initData) return res.status(401).json({ error: "missing initData" });
    if (!verifyTelegramInitData(initData))
      return res.status(403).json({ error: "invalid initData" });

    const params = new URLSearchParams(initData);
    const userRaw = params.get("user");
    const user = JSON.parse(userRaw);
    const role = ADMIN_TG_IDS.includes(String(user.id)) ? "admin" : "staff";

    db.prepare(
      "INSERT INTO users (tg_user_id,name,role) VALUES (?,?,?) ON CONFLICT(tg_user_id) DO UPDATE SET name=excluded.name,role=excluded.role"
    ).run(user.id, user.first_name || "?", role);

    req.user = { id: String(user.id), name: user.first_name, role };
    next();
  } catch (e) {
    console.error("auth err:", e);
    res.status(500).json({ error: "auth failed" });
  }
}

function adminOnly(req, res, next) {
  if (req.user?.role !== "admin")
    return res.status(403).json({ error: "admin only" });
  next();
}

// === Telegram уведомления ===
async function sendTelegram(text) {
  if (!BOT_TOKEN || !ADMIN_TG_IDS.length) return;
  for (const id of ADMIN_TG_IDS) {
    try {
      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: id, text }),
      });
    } catch (e) {
      console.warn("TG send error:", e.message);
    }
  }
}

// === маршруты ===
app.options("*", (_, res) => res.sendStatus(200));
app.get("/healthz", (_, res) => res.json({ ok: true }));
app.use("/api", authMiddleware);

app.get("/api/me", (req, res) => {
  res.json({ id: req.user.id, name: req.user.name, role: req.user.role });
});

// === продукты для сотрудников ===
app.get("/api/products", (req, res) => {
  const rows = db
    .prepare(
      `SELECT id, name, unit, category
       FROM products WHERE IFNULL(active,1)=1 ORDER BY category,name`
    )
    .all();
  res.json(rows);
});

// === создание заявки ===
app.post("/api/requisitions", (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (!items.length) return res.status(400).json({ error: "empty" });

  const tx = db.transaction(() => {
    const insReq = db.prepare(
      `INSERT INTO requisitions (created_at, ${REQ_USER_COL}) VALUES (?,?)`
    );
    const reqId = insReq.run(new Date().toISOString(), req.user.id).lastInsertRowid;

    const insItem = db.prepare(
      "INSERT INTO requisition_items (requisition_id,product_id,qty_requested) VALUES (?,?,?)"
    );
    const insOrder = db.prepare(
      "INSERT INTO orders (requisition_id,supplier_id,status) VALUES (?,?,?)"
    );
    const insOrderItem = db.prepare(
      "INSERT INTO order_items (order_id,product_id,qty_requested,qty_final) VALUES (?,?,?,?)"
    );

    const bySupp = new Map();
    const getSupp = db.prepare("SELECT supplier_id FROM products WHERE id=?");

    for (const { product_id, qty } of items) {
      if (!product_id || qty <= 0) continue;
      insItem.run(reqId, product_id, qty);
      const s = getSupp.get(product_id);
      const sid = s ? s.supplier_id : null;
      if (!sid) continue;
      if (!bySupp.has(sid)) bySupp.set(sid, []);
      bySupp.get(sid).push({ product_id, qty });
    }

    for (const [sid, list] of bySupp.entries()) {
      const orderId = insOrder.run(reqId, sid, "draft").lastInsertRowid;
      for (const { product_id, qty } of list) {
        insOrderItem.run(orderId, product_id, qty, qty);
      }
    }
    return reqId;
  });

  const reqId = tx();
  sendTelegram(`📦 Новая заявка #${reqId} от ${req.user.name}`);
  res.json({ ok: true, requisition_id: reqId });
});

// === админ: поставщики ===
app.get("/api/admin/suppliers", adminOnly, (req, res) => {
  const rows = db
    .prepare("SELECT * FROM suppliers ORDER BY active DESC, name")
    .all();
  res.json(rows);
});

app.post("/api/admin/suppliers", adminOnly, (req, res) => {
  const { name, contact_note } = req.body || {};
  if (!name) return res.status(400).json({ error: "missing name" });
  const id = db
    .prepare("INSERT INTO suppliers (name, contact_note, active) VALUES (?,?,1)")
    .run(name, contact_note || "")
    .lastInsertRowid;
  try { exportCatalogToJson(db); } catch (_) {}
  res.json({ ok: true, id });
});

app.delete("/api/admin/suppliers/:id", adminOnly, (req, res) => {
  const id = Number(req.params.id);
  const tx = db.transaction((id) => {
    const prodIds = db
      .prepare("SELECT id FROM products WHERE supplier_id=?")
      .all(id)
      .map((r) => r.id);
    if (prodIds.length) {
      const ids = prodIds.join(",");
      db.exec(
        `DELETE FROM order_items WHERE product_id IN (${ids});
         DELETE FROM requisition_items WHERE product_id IN (${ids});`
      );
    }
    db.prepare("DELETE FROM products WHERE supplier_id=?").run(id);
    db.prepare("DELETE FROM orders WHERE supplier_id=?").run(id);
    db.prepare("DELETE FROM suppliers WHERE id=?").run(id);
  });
  tx(id);
  try { exportCatalogToJson(db); } catch (_) {}
  res.json({ ok: true });
});

// === админ: товары ===
app.get("/api/admin/products", adminOnly, (req, res) => {
  const rows = db
    .prepare(
      `SELECT p.*, s.name AS supplier_name
       FROM products p
       LEFT JOIN suppliers s ON p.supplier_id=s.id
       ORDER BY p.active DESC, p.name`
    )
    .all();
  res.json(rows);
});

app.post("/api/admin/products", adminOnly, (req, res) => {
  const { name, unit, category, supplier_id } = req.body || {};
  if (!name || !supplier_id)
    return res.status(400).json({ error: "missing fields" });
  const exists = db
    .prepare("SELECT id FROM suppliers WHERE id=? AND IFNULL(active,1)=1")
    .get(supplier_id);
  if (!exists) return res.status(400).json({ error: "bad supplier" });
  const id = db
    .prepare(
      "INSERT INTO products (name, unit, category, supplier_id, active) VALUES (?,?,?,?,1)"
    )
    .run(name, unit || "", category || "Общее", supplier_id)
    .lastInsertRowid;
  try { exportCatalogToJson(db); } catch (_) {}
  res.json({ ok: true, id });
});

app.delete("/api/admin/products/:id", adminOnly, (req, res) => {
  const id = Number(req.params.id);
  const tx = db.transaction((id) => {
    db.prepare("DELETE FROM order_items WHERE product_id=?").run(id);
    db.prepare("DELETE FROM requisition_items WHERE product_id=?").run(id);
    db.prepare("DELETE FROM products WHERE id=?").run(id);
  });
  tx(id);
  try { exportCatalogToJson(db); } catch (_) {}
  res.json({ ok: true });
});

// === админ: заявки ===
app.get("/api/admin/requisitions", adminOnly, (req, res) => {
  const rows = db
    .prepare(
      `SELECT r.id, r.created_at, u.name AS user_name
       FROM requisitions r
       LEFT JOIN users u ON u.tg_user_id = r.${REQ_USER_COL}
       ORDER BY r.id DESC LIMIT 200`
    )
    .all();
  res.json(rows);
});

app.get("/api/admin/requisitions/:id", adminOnly, (req, res) => {
  const id = Number(req.params.id);
  const rows = db
    .prepare(
      `SELECT s.name AS supplier, p.name AS product, p.unit,
              ri.qty_requested, oi.qty_final, oi.note
       FROM requisition_items ri
       LEFT JOIN products p ON ri.product_id=p.id
       LEFT JOIN suppliers s ON p.supplier_id=s.id
       LEFT JOIN orders o ON o.requisition_id=ri.requisition_id AND o.supplier_id=s.id
       LEFT JOIN order_items oi ON oi.order_id=o.id AND oi.product_id=p.id
       WHERE ri.requisition_id=?
       ORDER BY s.name,p.name`
    )
    .all(id);
  res.json(rows);
});

// === статика ===
const pubDir = path.resolve(__dirname, "../public");
app.use(express.static(pubDir));

app.get(["/", "/index.html"], (_, res) =>
  res.sendFile(path.join(pubDir, "index.html"))
);
app.get(["/staff", "/staff.html"], (_, res) =>
  res.sendFile(path.join(pubDir, "staff.html"))
);
app.get(["/admin", "/admin.html"], (_, res) =>
  res.sendFile(path.join(pubDir, "admin.html"))
);
app.get("/favicon.ico", (_, res) => res.sendStatus(204));

// === запуск ===
app.listen(PORT, () => {
  console.log(`Server started on :${PORT}`);
  console.log("DB:", DB_FILE);
});
