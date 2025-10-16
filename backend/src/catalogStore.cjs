// catalogStore.cjs — экспорт/импорт каталога (поставщики/товары) в JSON
// ENV: CATALOG_JSON (путь к файлу), по умолчанию: /mnt/data/catalog.json

const fs = require("fs");
const path = require("path");

function getCatalogPath() {
  return process.env.CATALOG_JSON || "/mnt/data/catalog.json";
}

function safeMkdirFor(filePath) {
  const dir = path.dirname(filePath);
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
}

function readJSON(file) {
  try {
    const raw = fs.readFileSync(file, "utf8");
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function writeJSON(file, data) {
  safeMkdirFor(file);
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

function exportCatalogToJson(db, file = getCatalogPath()) {
  const suppliers = db.prepare(`
    SELECT id, name, IFNULL(contact_note,'') AS contact_note, IFNULL(active,1) AS active
    FROM suppliers ORDER BY name
  `).all();

  const products = db.prepare(`
    SELECT id, name, IFNULL(unit,'') AS unit, IFNULL(category,'') AS category,
           supplier_id, IFNULL(active,1) AS active
    FROM products ORDER BY name
  `).all();

  const payload = { suppliers, products, ts: new Date().toISOString() };
  writeJSON(file, payload);
  return file;
}

function importCatalogFromJsonIfEmpty(db, file = getCatalogPath()) {
  const suppliersCount = db.prepare("SELECT COUNT(*) AS c FROM suppliers").get().c | 0;
  const productsCount  = db.prepare("SELECT COUNT(*) AS c FROM products").get().c | 0;
  if (suppliersCount > 0 || productsCount > 0) {
    // Если БД уже не пустая — просто убедимся, что есть первичный бэкап
    const exists = fs.existsSync(file);
    if (!exists) exportCatalogToJson(db, file);
    return { imported: false, reason: "db_not_empty" };
  }

  if (!fs.existsSync(file)) {
    return { imported: false, reason: "file_not_found" };
  }
  const data = readJSON(file);
  if (!data || !Array.isArray(data.suppliers) || !Array.isArray(data.products)) {
    return { imported: false, reason: "bad_file" };
  }

  const insSup = db.prepare(`
    INSERT INTO suppliers (id, name, contact_note, active)
    VALUES (@id, @name, @contact_note, COALESCE(@active,1))
    ON CONFLICT(id) DO NOTHING
  `);
  const insProd = db.prepare(`
    INSERT INTO products (id, name, unit, category, supplier_id, active)
    VALUES (@id, @name, @unit, @category, @supplier_id, COALESCE(@active,1))
    ON CONFLICT(id) DO NOTHING
  `);

  const tx = db.transaction((payload) => {
    for (const s of payload.suppliers) insSup.run(s);
    for (const p of payload.products) insProd.run(p);
  });
  tx(data);

  return { imported: true, counts: {
    suppliers: db.prepare("SELECT COUNT(*) AS c FROM suppliers").get().c | 0,
    products:  db.prepare("SELECT COUNT(*) AS c FROM products").get().c | 0,
  }};
}

module.exports = {
  exportCatalogToJson,
  importCatalogFromJsonIfEmpty,
  getCatalogPath,
};
