// server.cjs — CommonJS-версия, без ошибок импорта

const express = require("express");
const path = require("path");
const fs = require("fs");
const bodyParser = require("body-parser");
const dotenv = require("dotenv");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");

dotenv.config();

const app = express();
const __dirname = __dirname; // в CJS уже доступно

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// === 1. Корректный поиск папки public ===
const candidatePublicDirs = [
  path.join(__dirname, "../public"),
  path.join(process.cwd(), "public"),
  path.join(process.cwd(), "backend/public"),
  path.join(__dirname, "../../public"),
];
const PUB_DIR = candidatePublicDirs.find((p) => fs.existsSync(p));

if (!PUB_DIR) {
  console.error("❌ Не найдена папка public — проверь структуру проекта");
  process.exit(1);
}
console.log("📂 Используется public:", PUB_DIR);

// === 2. Отключаем кэш только для HTML, чтобы обновления применялись сразу ===
app.use((req, res, next) => {
  if (req.path.endsWith(".html")) {
    res.set("Cache-Control", "no-store");
  }
  next();
});

// === 3. Раздача статики ===
app.use(express.static(PUB_DIR));

// === 4. Подключение SQLite ===
let db;
async function initDB() {
  db = await open({
    filename: process.env.SQLITE_PATH || path.join(process.cwd(), "app.sqlite"),
    driver: sqlite3.Database,
  });
  console.log("✅ База данных подключена");
}
initDB();

// === 5. Middleware: проверка Telegram initData или admin токена ===
function checkAdmin(req, res, next) {
  const allowUnsafe = process.env.DEV_ALLOW_UNSAFE === "true";
  const initData =
    req.headers["x-telegram-init-data"] ||
    (req.body && req.body.initData) ||
    (req.query && req.query.initData);
  const adminToken = req.headers["x-admin-token"];

  if (allowUnsafe || initData || adminToken) return next();
  res.status(401).json({ error: "Unauthorized" });
}

// === 6. Пример API (оставь свои реальные роуты) ===
app.get("/api/products", checkAdmin, async (req, res) => {
  try {
    const rows = await db.all("SELECT * FROM products");
    res.json(rows);
  } catch (err) {
    console.error("DB error:", err);
    res.status(500).json({ error: "DB error" });
  }
});

// === 7. Роуты страниц ===
app.get("/", (req, res) => {
  const adminPath = path.join(PUB_DIR, "admin.html");
  if (fs.existsSync(adminPath)) return res.sendFile(adminPath);
  const indexPath = path.join(PUB_DIR, "index.html");
  if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
  res.status(404).send("admin.html не найден");
});

app.get("/admin", (req, res) => {
  const adminPath = path.join(PUB_DIR, "admin.html");
  if (fs.existsSync(adminPath)) return res.sendFile(adminPath);
  res.status(404).send("admin.html не найден");
});

app.get("/staff", (req, res) => {
  const staffPath = path.join(PUB_DIR, "staff.html");
  if (fs.existsSync(staffPath)) return res.sendFile(staffPath);
  res.status(404).send("staff.html не найден");
});

// === 8. Запуск сервера ===
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
