// ===== robust server.cjs (CommonJS) =====
const express = require("express");
const sqlite3 = require("sqlite3");
const path = require("path");
const fs = require("fs");
const bodyParser = require("body-parser");
const cors = require("cors");
const dotenv = require("dotenv");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.SQLITE_PATH || path.join(process.cwd(), "app.sqlite");
const CATALOG_PATH = process.env.CATALOG_PATH || "/mnt/data/catalog.json";
const DEV_ALLOW_UNSAFE = String(process.env.DEV_ALLOW_UNSAFE || "").toLowerCase() === "true";
const ADMIN_SHARED_TOKEN = process.env.ADMIN_TOKEN || ""; // опционально

/* -------------------- STATIC: robust discovery -------------------- */
const candidatePublicDirs = [
  path.join(__dirname, "../backend/public"),
  path.join(__dirname, "../public"),
  path.join(__dirname, "../../backend/public"),
  path.join(__dirname, "../../public"),
  path.join(process.cwd(), "backend/public"),
  path.join(process.cwd(), "public"),
];
function resolvePublicDir() {
  for (const p of candidatePublicDirs) if (fs.existsSync(p)) return p;
  return null;
}
const PUB_DIR = resolvePublicDir();
if (PUB_DIR) {
  app.use(express.static(PUB_DIR));
  console.log("[static] Serving from:", PUB_DIR);
} else {
  console.warn("[static] Public directory not found. Pages will show helper.");
}

/* -------------------- DB helpers -------------------- */
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) console.error("SQLite open error:", err);
  else console.log("SQLite opened at:", DB_PATH);
});
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

/* -------------------- Catalog auto-discovery -------------------- */
async function listTables() {
  const rows = await dbAll(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
  );
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

/* -------------------- Middleware -------------------- */
app.use(cors());
app.use(bodyParser.json());

/* -------------------- helper page (если html не найден) -------------------- */
function listHtmlFiles(rootDir, maxDepth = 3) {
  const results = [];
  function walk(dir, depth) {
    if (depth > maxDepth) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else if (e.isFile() && e.name.endsWith(".html")) results.push(full);
    }
  }
  walk(rootDir, 0);
  return results;
}
function trySendHtml(res, filenames) {
  for (const base of (PUB_DIR ? [PUB_DIR] : [])) {
    for (const name of filenames) {
      const p = path.join(base, name);
      if (fs.existsSync(p)) return res.sendFile(p);
    }
  }
  const found = listHtmlFiles(process.cwd());
  const list = found.map((f) => path.relative(process.cwd(), f)).sort()
    .map((r) => `<li><code>/${r.replace(/\\/g, "/")}</code></li>`).join("");
  return res.status(200).send(
    `<html><body style="font-family:system-ui;padding:20px">
      <h3>Файл не найден</h3>
      <p>Ожидались: ${filenames.map(f=>`<code>${f}</code>`).join(", ")}</p>
      <p>Статика: <code>${PUB_DIR || "(не найдена)"}</code></p>
      <ul>${list || "<li><i>ничего не найдено</i></li>"}</ul>
      <p><a href="/catalog.json">catalog.json</a></p>
    </body></html>`
  );
}

/* -------------------- Pages -------------------- */
app.get("/", (req, res) => res.redirect("/admin"));
app.get("/admin", (req, res) => {
  if (PUB_DIR) {
    const f = ["admin.html", "index.html"].map(n => path.join(PUB_DIR, n)).find(p => fs.existsSync(p));
    if (f) return res.sendFile(f);
  }
  return trySendHtml(res, ["admin.html", "index.html"]);
});
app.get("/staff", (req, res) => {
  if (PUB_DIR) {
    const p = path.join(PUB_DIR, "staff.html");
    if (fs.existsSync(p)) return res.sendFile(p);
  }
  return trySendHtml(res, ["staff.html"]);
});

/* -------------------- Catalog -------------------- */
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

/* -------------------- Auth helpers for /api -------------------- */
function hasInitData(req) {
  return Boolean(
    req.headers["x-telegram-init-data"] ||
    (req.body && req.body.initData) ||
    (req.query && req.query.initData)
  );
}
function hasAdminAuth(req) {
  const hAuth = req.headers["authorization"] || "";
  const hAdm  = req.headers["x-admin-token"] || "";
  // 1) Любой ненулевой токен от фронта админки (она его шлёт из localStorage)
  if (hAuth || hAdm) return true;
  // 2) Общий токен из переменных окружения (опционально)
  const bearer = hAuth.startsWith("Bearer ") ? hAuth.slice(7) : hAuth;
  if (ADMIN_SHARED_TOKEN && (bearer === ADMIN_SHARED_TOKEN || hAdm === ADMIN_SHARED_TOKEN)) return true;
  return false;
}
function isAllowedWithoutInit(req) {
  return DEV_ALLOW_UNSAFE || hasAdminAuth(req);
}

/* -------------------- /api/products (совместимость) -------------------- */
// POST — для Телеграма, но разрешаем админке без initData, если есть токен/DEV
app.post("/api/products", async (req, res) => {
  try {
    if (!hasInitData(req) && !isAllowedWithoutInit(req)) {
      return res.status(401).json({
        ok: false,
        error: "INITDATA_REQUIRED",
        hint: "Откройте через кнопку WebApp в боте или установите DEV_ALLOW_UNSAFE=true",
      });
    }
    if (!fs.existsSync(CATALOG_PATH)) await rebuildCatalogJSON();
    const json = JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8"));
    return res.json({ ok: true, products: json.products || [] });
  } catch (e) {
    console.error("POST /api/products error:", e);
    res.status(500).json({ ok: false, error: "PRODUCTS_FETCH_FAILED" });
  }
});

// GET — аналогично
app.get("/api/products", async (req, res) => {
  try {
    if (!hasInitData(req) && !isAllowedWithoutInit(req)) {
      return res.status(401).json({
        ok: false,
        error: "INITDATA_REQUIRED",
        hint: "Откройте через кнопку WebApp в боте или установите DEV_ALLOW_UNSAFE=true",
      });
    }
    if (!fs.existsSync(CATALOG_PATH)) await rebuildCatalogJSON();
    const json = JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8"));
    return res.json({ ok: true, products: json.products || [] });
  } catch (e) {
    console.error("GET /api/products error:", e);
    res.status(500).json({ ok: false, error: "PRODUCTS_FETCH_FAILED" });
  }
});

/* -------------------- Admin: manual rebuild -------------------- */
app.post("/admin/rebuild-catalog", async (req, res) => {
  try {
    const p = await rebuildCatalogJSON();
    res.json({ ok: true, counts: { products: p.products.length, suppliers: p.suppliers.length } });
  } catch (e) {
    res.status(500).json({ ok: false, error: "REBUILD_FAILED" });
  }
});

/* -------------------- Health -------------------- */
app.get("/health", (req, res) =>
  res.json({
    ok: true,
    db: !!db,
    catalog_exists: fs.existsSync(CATALOG_PATH),
    db_path: DB_PATH,
    static_dir: PUB_DIR || null,
    dev_allow_unsafe: DEV_ALLOW_UNSAFE,
  })
);

/* -------------------- Init -------------------- */
rebuildCatalogJSON().catch((err) => console.warn("Initial catalog build failed:", err));
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
