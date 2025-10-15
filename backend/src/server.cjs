const express = require("express");
const sqlite3 = require("sqlite3");
const path = require("path");
const fs = require("fs");
const TelegramBot = require("node-telegram-bot-api");
const bodyParser = require("body-parser");
const cors = require("cors");
const dotenv = require("dotenv");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.SQLITE_PATH || path.join(process.cwd(), "app.sqlite");
const CATALOG_PATH = process.env.CATALOG_PATH || "/mnt/data/catalog.json";

// 📍 Ключевая правка:
// __dirname — реальная папка, где лежит server.cjs (src/)
// значит public лежит на уровень выше
const PUB_DIR = path.join(__dirname, "../backend/public");

const bot = new TelegramBot(process.env.BOT_TOKEN || "", { polling: false });

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(PUB_DIR));

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) console.error("SQLite open error:", err);
  else console.log("SQLite opened at:", DB_PATH);
});

/* ========= вспомогательные функции ========= */
function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}
function writeJsonAtomic(filePath, dataObj) {
  return new Promise((resolve, reject) => {
    const dir = path.dirname(filePath);
    const tmp = path.join(dir, `.tmp_${Date.now()}_${Math.random().toString(16).slice(2)}.json`);
    const json = JSON.stringify(dataObj, null, 2);
    fs.mkdir(dir, { recursive: true }, (mkErr) => {
      if (mkErr) return reject(mkErr);
      fs.writeFile(tmp, json, "utf8", (wErr) => {
        if (wErr) return reject(wErr);
        fs.rename(tmp, filePath, (rErr) => (rErr ? reject(rErr) : resolve()));
      });
    });
  });
}

/* ========= auto discovery для каталога ========= */
async function listTables() {
  const rows = await dbAll(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`);
  return rows.map((r) => r.name);
}
async function tableInfo(table) {
  return await dbAll(`PRAGMA table_info(${table})`);
}
function buildProductsSelect(table, columns) {
  const syn = {
    id: ["id", "product_id", "_id"],
    name: ["name", "title", "product_name", "label"],
    unit: ["unit", "uom", "measure", "units"],
    category: ["category", "group", "section", "cat"],
    active: ["is_active", "active", "enabled"],
  };
  const have = (aliases) => aliases.find((a) => columns.some((c) => c.name.toLowerCase() === a.toLowerCase()));
  const idCol = have(syn.id);
  const nameCol = have(syn.name);
  if (!idCol || !nameCol) return null;
  const unitCol = have(syn.unit);
  const catCol = have(syn.category);
  const actCol = have(syn.active);
  const selects = [
    `${table}.${idCol} AS id`,
    `${table}.${nameCol} AS name`,
    unitCol ? `${table}.${unitCol} AS unit` : `' ' AS unit`,
    catCol ? `${table}.${catCol} AS category` : `'Без категории' AS category`,
  ];
  const where = [];
  if (actCol) where.push(`COALESCE(${table}.${actCol},1)=1`);
  return `SELECT ${selects.join(", ")} FROM ${table} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY COALESCE(${catCol || `'Без категории'`}, 'Без категории'), ${nameCol}`;
}
function buildSuppliersSelect(table, columns) {
  const syn = {
    id: ["id", "supplier_id", "_id"],
    name: ["name", "title", "supplier_name"],
    phone: ["phone", "tel", "phone_number"],
    comment: ["comment", "notes", "description"],
    active: ["is_active", "active", "enabled"],
  };
  const have = (aliases) => aliases.find((a) => columns.some((c) => c.name.toLowerCase() === a.toLowerCase()));
  const idCol = have(syn.id);
  const nameCol = have(syn.name);
  if (!idCol || !nameCol) return null;
  const phoneCol = have(syn.phone);
  const commentCol = have(syn.comment);
  const actCol = have(syn.active);
  const selects = [
    `${table}.${idCol} AS id`,
    `${table}.${nameCol} AS name`,
    phoneCol ? `${table}.${phoneCol} AS phone` : `NULL AS phone`,
    commentCol ? `${table}.${commentCol} AS comment` : `NULL AS comment`,
  ];
  const where = [];
  if (actCol) where.push(`COALESCE(${table}.${actCol},1)=1`);
  return `SELECT ${selects.join(", ")} FROM ${table} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY ${nameCol}`;
}

async function rebuildCatalogJSON() {
  try {
    const tables = await listTables();
    const preferredProducts = ["products", "goods", "items", "menu", "positions", "catalog"];
    const preferredSuppliers = ["suppliers", "vendors", "providers"];
    let productsSql = null;
    let suppliersSql = null;
    for (const name of [...preferredProducts, ...tables.filter((t) => !preferredProducts.includes(t))]) {
      if (!tables.includes(name)) continue;
      const cols = await tableInfo(name);
      const sql = buildProductsSelect(name, cols);
      if (sql) { productsSql = sql; break; }
    }
    for (const name of [...preferredSuppliers, ...tables.filter((t) => !preferredSuppliers.includes(t))]) {
      if (!tables.includes(name)) continue;
      const cols = await tableInfo(name);
      const sql = buildSuppliersSelect(name, cols);
      if (sql) { suppliersSql = sql; break; }
    }
    const products = productsSql ? await dbAll(productsSql) : [];
    const suppliers = suppliersSql ? await dbAll(suppliersSql) : [];
    const payload = {
      updated_at: new Date().toISOString(),
      products,
      suppliers,
      _meta: { db_path: DB_PATH, tables_count: tables.length },
    };
    await writeJsonAtomic(CATALOG_PATH, payload);
    console.log(`catalog.json обновлён (${products.length} товаров, ${suppliers.length} поставщиков)`);
    return payload;
  } catch (err) {
    console.error("Ошибка при rebuildCatalogJSON:", err);
    throw err;
  }
}

/* ========= маршруты ========= */

// теперь Express будет искать index, admin и staff в правильной папке
app.get("/", (req, res) => res.redirect("/admin"));
app.get("/admin", (req, res) => res.sendFile(path.join(PUB_DIR, "admin.html")));
app.get("/staff", (req, res) => res.sendFile(path.join(PUB_DIR, "staff.html")));

app.get("/catalog.json", async (req, res) => {
  try {
    if (!fs.existsSync(CATALOG_PATH)) await rebuildCatalogJSON();
    res.set("Content-Type", "application/json; charset=utf-8");
    fs.createReadStream(CATALOG_PATH).pipe(res);
  } catch (err) {
    console.error("GET /catalog.json error:", err);
    res.status(500).json({ ok: false, error: "CATALOG_BUILD_FAILED" });
  }
});

app.post("/admin/rebuild-catalog", async (req, res) => {
  try {
    const p = await rebuildCatalogJSON();
    res.json({ ok: true, counts: { products: p.products.length, suppliers: p.suppliers.length } });
  } catch (e) {
    res.status(500).json({ ok: false, error: "REBUILD_FAILED" });
  }
});

app.get("/health", (req, res) => res.json({
  ok: true,
  db: !!db,
  catalog_exists: fs.existsSync(CATALOG_PATH),
  db_path: DB_PATH
}));

rebuildCatalogJSON().catch(err => console.warn("Initial catalog build failed:", err));
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
