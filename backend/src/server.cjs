// ===== server.cjs =====
import express from "express";
import sqlite3 from "sqlite3";
import path from "path";
import fs from "fs";
import TelegramBot from "node-telegram-bot-api";
import bodyParser from "body-parser";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.SQLITE_PATH || path.join(process.cwd(), "app.sqlite");
const CATALOG_PATH = process.env.CATALOG_PATH || "/mnt/data/catalog.json";

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: false });

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(process.cwd(), "backend/public")));

const db = new sqlite3.Database(DB_PATH);

// ============ Вспомогательные функции ============
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

// ============ Генерация каталога ============
async function rebuildCatalogJSON() {
  try {
    const products = await dbAll(
      `SELECT id, name, unit, category FROM products ORDER BY COALESCE(category,'Без категории'), name`
    ).catch(() => []);

    const suppliers = await dbAll(
      `SELECT id, name, phone, comment FROM suppliers ORDER BY name`
    ).catch(() => []);

    const payload = {
      updated_at: new Date().toISOString(),
      products,
      suppliers,
    };

    await writeJsonAtomic(CATALOG_PATH, payload);
    console.log("catalog.json обновлён:", CATALOG_PATH);
    return payload;
  } catch (err) {
    console.error("Ошибка при rebuildCatalogJSON:", err);
    throw err;
  }
}

// ============ Эндпоинт каталога ============
app.get("/catalog.json", async (req, res) => {
  try {
    if (!fs.existsSync(CATALOG_PATH)) {
      await rebuildCatalogJSON();
    }
    res.set("Content-Type", "application/json; charset=utf-8");
    fs.createReadStream(CATALOG_PATH).pipe(res);
  } catch (err) {
    console.error("GET /catalog.json error:", err);
    res.status(500).json({ ok: false, error: "CATALOG_BUILD_FAILED" });
  }
});

// ============ Пример проверки работы ============
app.get("/health", (req, res) => {
  res.json({ ok: true, db: !!db, catalog: fs.existsSync(CATALOG_PATH) });
});

// ============ Инициализация ============
rebuildCatalogJSON().catch((err) =>
  console.warn("Initial catalog build failed:", err)
);

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
