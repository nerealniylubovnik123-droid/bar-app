/**
 * server.cjs — упрощённая аутентификация без initData/hash.
 * Роли:
 *  - ADMIN_TG_IDS (CSV) или [504348666] по умолчанию → admin
 *  - все остальные → staff
 *
 * Источники tg_user_id:
 *  - header: X-TG-USER-ID
 *  - query/body: tg_user_id
 *  - иначе: 0 (гость staff)
 */

require('dotenv').config();

const path = require('path');
const fs = require('fs');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const cors = require('cors');
const BetterSqlite3 = require('better-sqlite3');
const fetch = require('node-fetch');

const app = express();

// ---------- ENV ----------
const PORT = Number(process.env.PORT || 8080);
const DB_FILE = process.env.DB_FILE || process.env.SQLITE_PATH || path.resolve(__dirname, '../data.sqlite');
const ADMIN_TG_IDS = (process.env.ADMIN_TG_IDS || '504348666')
  .split(',')
  .map((s) => Number(String(s).trim()))
  .filter((n) => Number.isFinite(n));
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const DEV_ALLOW_UNSAFE = true; // всегда пропускаем без подписи и без initData

// ---------- DB ----------
fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
const db = new BetterSqlite3(DB_FILE);
db.pragma('journal_mode = WAL');

// Базовая схема (минимум для работы). Если у тебя уже есть своя схема — эти CREATE IF NOT EXISTS не помешают.
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  tg_user_id INTEGER PRIMARY KEY,
  name TEXT,
  role TEXT CHECK(role IN ('admin','staff')) NOT NULL DEFAULT 'staff'
);

CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  contact_note TEXT,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  unit TEXT,
  category TEXT,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS requisitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by INTEGER, -- для обратной совместимости
  user_id INTEGER,    -- альтернативное имя
  FOREIGN KEY (user_id) REFERENCES users(tg_user_id),
  FOREIGN KEY (created_by) REFERENCES users(tg_user_id)
);

CREATE TABLE IF NOT EXISTS requisition_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  requisition_id INTEGER NOT NULL REFERENCES requisitions(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty_requested REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  requisition_id INTEGER NOT NULL REFERENCES requisitions(id) ON DELETE CASCADE,
  supplier_id INTEGER REFERENCES suppliers(id),
  status TEXT NOT NULL DEFAULT 'draft'
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty_requested REAL NOT NULL,
  qty_final REAL NOT NULL,
  note TEXT
);
`);

function detectReqUserCol() {
  const cols = db.prepare(`PRAGMA table_info('requisitions')`).all().map((c) => c.name);
  if (cols.includes('created_by')) return 'created_by';
  return 'user_id';
}
const REQ_USER_COL = detectReqUserCol();

// ---------- APP & MIDDLEWARE ----------
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(morgan('tiny'));
app.use(cors({ origin: (_o, cb) => cb(null, true), credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Статика
const publicDir = path.resolve(__dirname, '../public');
app.use(express.static(publicDir));

// ---------- UTIL ----------
async function sendTelegram(text) {
  if (!BOT_TOKEN || ADMIN_TG_IDS.length === 0) return;
  const base = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  await Promise.allSettled(
    ADMIN_TG_IDS.map((chatId) =>
      fetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text }),
      })
    )
  );
}

function getTgUserId(req) {
  const h = req.header('X-TG-USER-ID');
  if (h && Number(h)) return Number(h);
  const fromQuery = req.query?.tg_user_id;
  if (fromQuery && Number(fromQuery)) return Number(fromQuery);
  const fromBody = req.body?.tg_user_id;
  if (fromBody && Number(fromBody)) return Number(fromBody);
  return 0; // гость
}

function getName(req) {
  return (req.query?.name || req.body?.name || 'Сотрудник').toString().slice(0, 100);
}

function roleById(tgId) {
  return ADMIN_TG_IDS.includes(Number(tgId)) ? 'admin' : 'staff';
}

// ---------- AUTH (без initData) ----------
function authMiddleware(req, _res, next) {
  const tgId = getTgUserId(req);
  const name = getName(req);
  const role = roleById(tgId);

  // создаём пользователя при первом попадании
  const upsert = db.prepare(
    `INSERT INTO users (tg_user_id, name, role)
     VALUES (@tg_user_id, @name, @role)
     ON CONFLICT(tg_user_id) DO UPDATE SET
       name = COALESCE(excluded.name, users.name),
       role = CASE WHEN users.role = 'admin' THEN 'admin' ELSE excluded.role END`
  );
  upsert.run({ tg_user_id: tgId, name, role });

  req.user = { tg_user_id: tgId, name, role };
  next();
}

function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ ok: false, error: 'forbidden' });
  next();
}

// ---------- ROUTES: health ----------
app.get('/healthz', (_req, res) => res.json({ ok: true }));

// ---------- ROUTES: auth/me ----------
app.get('/api/me', authMiddleware, (req, res) => {
  const { tg_user_id, name, role } = req.user;
  res.json({ id: tg_user_id, name, role, devUnsafe: DEV_ALLOW_UNSAFE });
});

// ---------- ROUTES: products ----------
app.get('/api/products', authMiddleware, (_req, res) => {
  const rows = db
    .prepare(
      `
      SELECT p.id, p.name, p.unit, p.category, p.supplier_id,
             s.name AS supplier_name, p.active
      FROM products p
      LEFT JOIN suppliers s ON s.id = p.supplier_id
      WHERE p.active != 0
      ORDER BY COALESCE(p.category,''), p.name
    `
    )
    .all();
  res.json(rows);
});

// ---------- ROUTES: requisitions ----------
app.post('/api/requisitions', authMiddleware, (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (items.length === 0) return res.status(400).json({ ok: false, error: 'items_empty' });

  // валидация
  for (const it of items) {
    if (!Number(it.product_id) || !(Number(it.qty) > 0)) {
      return res.status(400).json({ ok: false, error: 'bad_item' });
    }
  }

  const tgId = req.user.tg_user_id;

  const tx = db.transaction(() => {
    const insReq = db.prepare(
      `INSERT INTO requisitions (${REQ_USER_COL}) VALUES (?)`
    );
    const result = insReq.run(tgId);
    const reqId = result.lastInsertRowid;

    const insReqItem = db.prepare(
      `INSERT INTO requisition_items (requisition_id, product_id, qty_requested)
       VALUES (?,?,?)`
    );

    // группировка по поставщику для автосоздания заказов
    const getProduct = db.prepare(`SELECT id, supplier_id, name, unit, category FROM products WHERE id = ?`);
    const bySupplier = new Map();

    for (const it of items) {
      insReqItem.run(reqId, Number(it.product_id), Number(it.qty));
      const p = getProduct.get(Number(it.product_id));
      const sid = p?.supplier_id || null;
      if (!bySupplier.has(sid)) bySupplier.set(sid, []);
      bySupplier.get(sid).push({ product_id: p.id, name: p.name, unit: p.unit, qty: Number(it.qty) });
    }

    const insOrder = db.prepare(
      `INSERT INTO orders (requisition_id, supplier_id, status) VALUES (?,?, 'draft')`
    );
    const insOrderItem = db.prepare(
      `INSERT INTO order_items (order_id, product_id, qty_requested, qty_final, note) VALUES (?,?,?,?,NULL)`
    );

    for (const [sid, list] of bySupplier.entries()) {
      const o = insOrder.run(reqId, sid);
      const orderId = o.lastInsertRowid;
      for (const row of list) {
        insOrderItem.run(orderId, row.product_id, row.qty, row.qty);
      }
    }

    return reqId;
  });

  const requisitionId = tx();

  // Уведомление TG (опционально)
  try {
    const user = req.user;
    const lines = [
      `🧾 Новая заявка #${requisitionId}`,
      `От: ${user?.name || user?.tg_user_id} (${user?.tg_user_id})`,
      `Дата: ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`,
    ];
    sendTelegram(lines.join('\n')).catch(() => {});
  } catch (_) {}

  res.json({ ok: true, requisition_id: requisitionId });
});

// ---------- ROUTES: admin — suppliers ----------
app.get('/api/admin/suppliers', authMiddleware, adminOnly, (_req, res) => {
  const rows = db.prepare(`SELECT * FROM suppliers ORDER BY active DESC, name`).all();
  res.json(rows);
});

app.post('/api/admin/suppliers', authMiddleware, adminOnly, (req, res) => {
  const name = String(req.body?.name || '').trim();
  const contact = String(req.body?.contact_note || '').trim() || null;
  if (!name) return res.status(400).json({ ok: false, error: 'name_required' });
  try {
    const r = db.prepare(`INSERT INTO suppliers (name, contact_note, active) VALUES (?,?,1)`).run(name, contact);
    res.json({ ok: true, id: r.lastInsertRowid });
  } catch (e) {
    if (String(e.message || '').includes('UNIQUE')) return res.status(409).json({ ok: false, error: 'duplicate' });
    res.status(500).json({ ok: false, error: 'db_error' });
  }
});

app.delete('/api/admin/suppliers/:id', authMiddleware, adminOnly, (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ ok: false, error: 'bad_id' });

  const tx = db.transaction(() => {
    // удаляем каскадно связанные сущности (жёстко)
    db.prepare(`DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE supplier_id = ?)`).run(id);
    db.prepare(`DELETE FROM orders WHERE supplier_id = ?`).run(id);

    // удаляем ссылки на продукты
    const prodIds = db.prepare(`SELECT id FROM products WHERE supplier_id = ?`).all(id).map(r => r.id);
    if (prodIds.length) {
      const inList = prodIds.map(() => '?').join(',');
      db.prepare(`DELETE FROM requisition_items WHERE product_id IN (${inList})`).run(...prodIds);
      db.prepare(`DELETE FROM order_items WHERE product_id IN (${inList})`).run(...prodIds);
    }
    db.prepare(`DELETE FROM products WHERE supplier_id = ?`).run(id);

    db.prepare(`DELETE FROM suppliers WHERE id = ?`).run(id);
  });
  tx();

  res.json({ ok: true });
});

// ---------- ROUTES: admin — products ----------
app.get('/api/admin/products', authMiddleware, adminOnly, (_req, res) => {
  const rows = db
    .prepare(
      `SELECT p.*, s.name AS supplier_name
       FROM products p LEFT JOIN suppliers s ON s.id = p.supplier_id
       ORDER BY p.active DESC, COALESCE(p.category,''), p.name`
    )
    .all();
  res.json(rows);
});

app.post('/api/admin/products', authMiddleware, adminOnly, (req, res) => {
  const name = String(req.body?.name || '').trim();
  const unit = String(req.body?.unit || '').trim() || null;
  const category = String(req.body?.category || 'Общее').trim();
  const supplier_id = req.body?.supplier_id ? Number(req.body.supplier_id) : null;

  if (!name) return res.status(400).json({ ok: false, error: 'name_required' });
  if (supplier_id) {
    const sup = db.prepare(`SELECT id,active FROM suppliers WHERE id = ?`).get(supplier_id);
    if (!sup || !sup.active) return res.status(400).json({ ok: false, error: 'supplier_inactive_or_not_found' });
  }
  const r = db
    .prepare(
      `INSERT INTO products (name, unit, category, supplier_id, active)
       VALUES (?,?,?,?,1)`
    )
    .run(name, unit, category, supplier_id);
  res.json({ ok: true, id: r.lastInsertRowid });
});

app.delete('/api/admin/products/:id', authMiddleware, adminOnly, (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ ok: false, error: 'bad_id' });

  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM order_items WHERE product_id = ?`).run(id);
    db.prepare(`DELETE FROM requisition_items WHERE product_id = ?`).run(id);
    db.prepare(`DELETE FROM products WHERE id = ?`).run(id);
  });
  tx();
  res.json({ ok: true });
});

// ---------- ROUTES: admin — requisitions ----------
app.get('/api/admin/requisitions', authMiddleware, adminOnly, (_req, res) => {
  const rows = db
    .prepare(
      `SELECT r.id, r.created_at,
              COALESCE(u.name, r.${REQ_USER_COL}) AS user_name
       FROM requisitions r
       LEFT JOIN users u
         ON u.tg_user_id = r.${REQ_USER_COL}
       ORDER BY r.id DESC
       LIMIT 200`
    )
    .all();
  res.json(rows);
});

app.get('/api/admin/requisitions/:id', authMiddleware, adminOnly, (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ ok: false, error: 'bad_id' });

  // Позиции по заявке, сгруппированы по поставщику
  const items = db
    .prepare(
      `SELECT ri.id, ri.product_id, ri.qty_requested,
              p.name AS product_name, p.unit, p.category,
              p.supplier_id, s.name AS supplier_name
       FROM requisition_items ri
       JOIN products p ON p.id = ri.product_id
       LEFT JOIN suppliers s ON s.id = p.supplier_id
       WHERE ri.requisition_id = ?
       ORDER BY COALESCE(p.supplier_id, 0), p.name`
    )
    .all(id);

  const bySupplier = {};
  for (const it of items) {
    const key = it.supplier_id || 0;
    if (!bySupplier[key]) bySupplier[key] = { supplier_id: key, supplier_name: it.supplier_name || 'Без поставщика', items: [] };
    bySupplier[key].items.push(it);
  }
  res.json({ id, groups: Object.values(bySupplier) });
});

// ---------- STATIC ROUTES ----------
app.get(['/admin', '/admin.html'], (_req, res) => res.sendFile(path.join(publicDir, 'admin.html')));
app.get(['/staff', '/staff.html'], (_req, res) => res.sendFile(path.join(publicDir, 'staff.html')));
app.get('/', (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));
app.get('/favicon.ico', (_req, res) => res.status(204).end());

// ---------- START ----------
app.listen(PORT, () => {
  /* eslint-disable no-console */
  console.log(`[server] listening on :${PORT}`);
  console.log(`[server] DB_FILE = ${DB_FILE}`);
  console.log(`[server] ADMIN_TG_IDS = ${ADMIN_TG_IDS.join(',')}`);
  console.log(`[server] DEV_ALLOW_UNSAFE = ${DEV_ALLOW_UNSAFE}`);
});
