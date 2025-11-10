'use strict';

/* ================== Imports & setup ================== */
const dns = require('dns');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const crypto = require('crypto');

const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const cors = require('cors');
const dotenv = require('dotenv');

dns.setDefaultResultOrder?.('ipv4first');
dotenv.config({ override: true });

const app = express();
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));
app.use(compression());
app.use(express.json());
app.use(morgan('dev'));
app.use(cors({
  origin: (_o, cb) => cb(null, true),
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-TG-INIT-DATA'],
  maxAge: 86400
}));
app.options('*', cors());

// === Отдача статических файлов Mini App ===
const publicDir = path.join(__dirname, '../public'); // если public лежит в корне рядом с backend
app.use(express.static(publicDir));

// Если путь не найден среди API — отдать index.html
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next(); // API не трогаем
  res.sendFile(path.join(publicDir, 'index.html'));
});

/* ================== DB bootstrap ================== */
let db;
let migrate = () => {};

async function loadDb() {
  try { ({ db, migrate } = require('./db')); return; }
  catch (e1) {
    try {
      const mod = await import(pathToFileURL(path.resolve(__dirname, './db.js')).href);
      db = mod.db || (mod.default && mod.default.db);
      migrate = mod.migrate || (mod.default && mod.default.migrate) || (() => {});
      if (db) return;
    } catch (e2) {}
  }
  const Database = require('better-sqlite3');
  const file = process.env.SQLITE_PATH || path.resolve(__dirname, '../data.sqlite');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new Database(file);
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      tg_user_id TEXT PRIMARY KEY,
      name TEXT,
      role TEXT NOT NULL DEFAULT 'staff'
    );

    CREATE TABLE IF NOT EXISTS suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      contact_note TEXT,
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      unit TEXT NOT NULL,
      category TEXT,
      supplier_id INTEGER NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
    );

    CREATE TABLE IF NOT EXISTS requisitions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,                    -- в старых БД может быть created_by
      status TEXT NOT NULL DEFAULT 'created',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS requisition_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      requisition_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      qty_requested REAL NOT NULL,
      FOREIGN KEY (requisition_id) REFERENCES requisitions(id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      requisition_id INTEGER NOT NULL,
      supplier_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (requisition_id) REFERENCES requisitions(id),
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      qty_requested REAL NOT NULL,
      qty_final REAL NOT NULL,
      note TEXT,
      FOREIGN KEY (order_id) REFERENCES orders(id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity TEXT,
      entity_id INTEGER,
      action TEXT,
      user_id TEXT,
      payload_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

/* ===== schema guard: user_id vs created_by ===== */
let REQ_USER_COL = 'user_id';
function ensureSchema() {
  const cols = db.prepare(`PRAGMA table_info('requisitions')`).all();
  const hasUserId = cols.some(c => c.name === 'user_id');
  const hasCreatedBy = cols.some(c => c.name === 'created_by');
  if (!hasUserId && !hasCreatedBy) {
    db.exec(`ALTER TABLE requisitions ADD COLUMN user_id TEXT;`);
    REQ_USER_COL = 'user_id';
    console.log('[migrate] added requisitions.user_id');
  } else if (hasCreatedBy) {
    REQ_USER_COL = 'created_by';
    console.log('[schema] using requisitions.created_by as author column');
  } else {
    REQ_USER_COL = 'user_id';
    console.log('[schema] using requisitions.user_id as author column');
  }
}

/* ================== Telegram notify ================== */
async function sendTelegram(text) {
  const token = process.env.BOT_TOKEN;
  const idsStr = process.env.ADMIN_TG_IDS;
  if (!token || !idsStr) return;

  const ids = idsStr.split(',').map(s => s.trim()).filter(Boolean);
  for (const chatId of ids) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true })
      });
      await res.json().catch(() => ({}));
    } catch (e) { console.warn('[Telegram] fail for', chatId, String(e?.message || e)); }
  }
}

/** Собираем текст уведомления БЕЗ статусов */
function buildRequisitionMessage(reqId, userName) {
  const head = db.prepare(`SELECT r.id, r.created_at FROM requisitions r WHERE r.id = ?`).get(reqId);
  const orders = db.prepare(`
    SELECT o.id AS order_id, s.name AS supplier_name
    FROM orders o JOIN suppliers s ON s.id = o.supplier_id
    WHERE o.requisition_id = ? ORDER BY s.name
  `).all(reqId);
  const itemsStmt = db.prepare(`
    SELECT p.name AS product_name, p.unit, oi.qty_requested
    FROM order_items oi JOIN products p ON p.id = oi.product_id
    WHERE oi.order_id = ? ORDER BY p.name
  `);

  let text = `🧾 <b>Заявка #${reqId}</b> от ${userName || 'сотрудника'}\n` +
             `Дата: ${head?.created_at || ''}\n\n`;
  for (const o of orders) {
    text += `🛒 <b>${o.supplier_name}</b>\n`;
    const items = itemsStmt.all(o.order_id);
    for (const it of items) text += ` • ${it.product_name} — ${it.qty_requested} ${it.unit || ''}\n`;
    text += '\n';
  }
  return text.trim();
}

/* ================== Auth (Telegram WebApp) ================== */
const DEV_ALLOW_UNSAFE = String(process.env.DEV_ALLOW_UNSAFE || '').toLowerCase() === 'true';
const BOT_TOKEN = process.env.BOT_TOKEN || '';

function ensureUser(tgId, name, roleGuess = 'staff') {
  const get = db.prepare('SELECT tg_user_id, name, role FROM users WHERE tg_user_id = ?');
  let u = get.get(tgId);
  if (!u) {
    db.prepare('INSERT INTO users (tg_user_id, name, role) VALUES (?,?,?)')
      .run(tgId, name || '', roleGuess);
    u = get.get(tgId);
  }
  return u;
}

function verifyTelegramInitData(initData, botToken) {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return { ok: false, error: 'No hash' };

    const pairs = [];
    params.forEach((v, k) => { if (k !== 'hash') pairs.push(`${k}=${v}`); });
    pairs.sort();
    const dataCheckString = pairs.join('\n');

    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const calcHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

    if (calcHash !== hash) return { ok: false, error: 'Bad hash' };

    const userStr = params.get('user');
    const user = userStr ? JSON.parse(userStr) : null;
    return { ok: true, user };
  } catch {
    return { ok: false, error: 'Invalid initData' };
  }
}

function pickInitData(req) {
  let initData =
    req.header('X-TG-INIT-DATA') ||
    (typeof req.body?.initData === 'string' ? req.body.initData : '') ||
    (typeof req.query?.__tg === 'string' ? req.query.__tg : '') ||
    (typeof req.query?.initData === 'string' ? req.query.initData : '');

  if (!initData) return '';
  try {
    const maybe = decodeURIComponent(initData);
    if (maybe.includes('=') && maybe.includes('hash=')) initData = maybe;
  } catch {}
  return initData;
}

function verifyInitData(req) {
  if (DEV_ALLOW_UNSAFE) return { ok: true, user: { id: 'dev', name: 'Dev User' } };
  if (!BOT_TOKEN) return { ok: false, error: 'Missing BOT_TOKEN' };

  const initData = pickInitData(req);
  if (!initData) return { ok: false, error: 'Missing initData' };

  const v = verifyTelegramInitData(initData, BOT_TOKEN);
  if (!v.ok) return v;

  const userId = String(v.user?.id || '');
  const fullName = [v.user?.first_name, v.user?.last_name].filter(Boolean).join(' ') || v.user?.username || '';
  return { ok: true, user: { id: userId, name: fullName } };
}

function authMiddleware(req, res, next) {
  const v = verifyInitData(req);
  if (!v.ok) return res.status(401).json({ ok: false, error: v.error });

  const admins = String(process.env.ADMIN_TG_IDS || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  const role = admins.includes(v.user.id) ? 'admin' : 'staff';

  req.user = ensureUser(v.user.id, v.user.name, role);
  next();
}
function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ ok: false, error: 'admin only' });
  next();
}

/* ================== Catalog & CRUD ================== */
function registerCatalogRoutes(app) {
  // Suppliers
  app.get('/api/admin/suppliers', authMiddleware, adminOnly, (_req, res) => {
    try {
      const rows = db.prepare('SELECT * FROM suppliers ORDER BY active DESC, name').all();
      res.json({ ok: true, suppliers: rows });
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });

  app.post('/api/admin/suppliers', authMiddleware, adminOnly, (req, res) => {
    try {
      const { name, contact_note = '' } = req.body || {};
      if (!name || String(name).trim().length < 2) throw new Error('Название поставщика слишком короткое');
      const r = db.prepare('INSERT INTO suppliers (name, contact_note, active) VALUES (?,?,1)')
        .run(String(name).trim(), String(contact_note || ''));
      const row = db.prepare('SELECT * FROM suppliers WHERE id=?').get(r.lastInsertRowid);
      res.json({ ok: true, supplier: row });
    } catch (e) {
      const msg = String(e?.message || e);
      res.status(/UNIQUE/i.test(msg) ? 409 : 400).json({ ok: false, error: msg });
    }
  });

  // ЖЁСТКОЕ удаление поставщика со всей историей
  app.delete('/api/admin/suppliers/:id', authMiddleware, adminOnly, (req, res) => {
    try {
      const sid = Number(req.params.id);
      if (!Number.isFinite(sid)) return res.status(400).json({ ok: false, error: 'bad id' });

      const trx = db.transaction((supplierId) => {
        const orderIds = db.prepare('SELECT id FROM orders WHERE supplier_id = ?').all(supplierId).map(r => r.id);
        if (orderIds.length) {
          const qm = orderIds.map(()=>'?').join(',');
          db.prepare(`DELETE FROM order_items WHERE order_id IN (${qm})`).run(...orderIds);
          db.prepare(`DELETE FROM orders WHERE id IN (${qm})`).run(...orderIds);
        }

        const prodIds = db.prepare('SELECT id FROM products WHERE supplier_id = ?').all(supplierId).map(r => r.id);
        if (prodIds.length) {
          const qm = prodIds.map(()=>'?').join(',');
          db.prepare(`DELETE FROM requisition_items WHERE product_id IN (${qm})`).run(...prodIds);
          db.prepare(`DELETE FROM order_items WHERE product_id IN (${qm})`).run(...prodIds);
          db.prepare(`DELETE FROM products WHERE id IN (${qm})`).run(...prodIds);
        }

        const r = db.prepare('DELETE FROM suppliers WHERE id=?').run(supplierId);
        if (r.changes === 0) throw new Error('not found');
      });

      trx(sid);
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ ok: false, error: String(e.message || e) }); }
  });

  // Products
  app.get('/api/admin/products', authMiddleware, adminOnly, (_req, res) => {
    try {
      const rows = db.prepare(`
        SELECT p.*, s.name AS supplier_name
        FROM products p JOIN suppliers s ON s.id = p.supplier_id
        ORDER BY p.active DESC, p.name
      `).all();
      res.json({ ok: true, products: rows });
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });

  app.post('/api/admin/products', authMiddleware, adminOnly, (req, res) => {
    try {
      const { name, unit, supplier_id, category = 'Общее' } = req.body || {};
      if (!name || String(name).trim().length < 2) throw new Error('Название товара слишком короткое');
      if (!unit) throw new Error('Ед. изм. обязательна');
      const sid = Number(supplier_id);
      if (!Number.isFinite(sid)) throw new Error('Некорректный supplier_id');

      const sup = db.prepare('SELECT id, active FROM suppliers WHERE id=?').get(sid);
      if (!sup) throw new Error('Поставщик не найден');
      if (sup.active === 0) throw new Error('Поставщик деактивирован');

      const r = db.prepare('INSERT INTO products (name, unit, category, supplier_id, active) VALUES (?,?,?,?,1)')
        .run(String(name).trim(), String(unit).trim(), String(category).trim(), sid);
      const row = db.prepare('SELECT * FROM products WHERE id=?').get(r.lastInsertRowid);
      res.json({ ok: true, product: row });
    } catch (e) {
      const msg = String(e?.message || e);
      res.status(/UNIQUE/i.test(msg) ? 409 : 400).json({ ok: false, error: msg });
    }
  });

  // ЖЁСТКОЕ удаление товара со всей историей
  app.delete('/api/admin/products/:id', authMiddleware, adminOnly, (req, res) => {
    try {
      const pid = Number(req.params.id);
      if (!Number.isFinite(pid)) return res.status(400).json({ ok: false, error: 'bad id' });

      const trx = db.transaction((productId) => {
        db.prepare('DELETE FROM order_items WHERE product_id = ?').run(productId);
        db.prepare('DELETE FROM requisition_items WHERE product_id = ?').run(productId);
        const r = db.prepare('DELETE FROM products WHERE id = ?').run(productId);
        if (r.changes === 0) throw new Error('not found');
      });

      trx(pid);
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ ok: false, error: String(e.message || e) }); }
  });

  // Публичный список для формы сотрудника (добавили supplier_id и supplier_name)
  app.get('/api/products', authMiddleware, (_req, res) => {
    try {
      const rows = db.prepare(`
        SELECT p.id, p.name, p.unit, p.category, p.supplier_id, s.name AS supplier_name
        FROM products p JOIN suppliers s ON s.id = p.supplier_id
        WHERE p.active = 1
        ORDER BY p.name
      `).all();
      res.json({ ok: true, products: rows });
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });
}

/* ================== Requisitions ================== */
function registerRequisitionRoutes(app) {
  app.post('/api/requisitions', authMiddleware, async (req, res) => {
    const { items } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ ok: false, error: 'items required' });
    }

    const trx = db.transaction(() => {
      const col = REQ_USER_COL;
      const rReq = db.prepare(`INSERT INTO requisitions (${col}, status) VALUES (?, 'created')`)
        .run(req.user.tg_user_id);
      const reqId = Number(rReq.lastInsertRowid);

      const insReqItem   = db.prepare('INSERT INTO requisition_items (requisition_id, product_id, qty_requested) VALUES (?,?,?)');
      const getProd      = db.prepare('SELECT id, supplier_id FROM products WHERE id = ? AND active = 1');
      const insOrder     = db.prepare("INSERT INTO orders (requisition_id, supplier_id, status) VALUES (?, ?, 'draft')");
      const insOrderItem = db.prepare('INSERT INTO order_items (order_id, product_id, qty_requested, qty_final) VALUES (?,?,?,?)');

      const ordersMap = new Map();

      for (const it of items) {
        const pid = Number(it.product_id);
        const q = Number(it.qty);
        if (!Number.isFinite(pid) || !(q > 0)) throw new Error('Bad item');

        const prod = getProd.get(pid);
        if (!prod) throw new Error(`Product ${pid} not found or inactive`);

        insReqItem.run(reqId, prod.id, q);

        let orderId = ordersMap.get(prod.supplier_id);
        if (!orderId) {
          const rOrd = insOrder.run(reqId, prod.supplier_id);
          orderId = Number(rOrd.lastInsertRowid);
          ordersMap.set(prod.supplier_id, orderId);
        }
        insOrderItem.run(orderId, prod.id, q, q);
      }

      // статус в БД оставляем, но больше нигде не показываем
      db.prepare("UPDATE requisitions SET status = 'processed' WHERE id=?").run(reqId);
      return reqId;
    });

    try {
      const reqId = trx();
      try {
        const msg = buildRequisitionMessage(reqId, req.user.name || req.user.tg_user_id);
        await sendTelegram(msg);
      } catch (e) { console.warn('[telegram notify error]', e?.message || e); }
      res.json({ ok: true, requisition_id: reqId });
    } catch (e) {
      res.status(400).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // Список заявок для админа (без отображения статусов)
  app.get('/api/admin/requisitions', authMiddleware, adminOnly, (_req, res) => {
    try {
      const col = REQ_USER_COL;
      const rows = db.prepare(`
        SELECT r.id, r.created_at, u.name AS user_name
        FROM requisitions r
        LEFT JOIN users u ON u.tg_user_id = r.${col}
        ORDER BY r.id DESC
        LIMIT 200
      `).all();
      res.json({ ok: true, requisitions: rows });
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });

  // Детали заявки (возвращаем состав без статусов)
  app.get('/api/admin/requisitions/:id', authMiddleware, adminOnly, (req, res) => {
    try {
      const id = Number(req.params.id);
      const orders = db.prepare(`
        SELECT o.id AS order_id, s.id AS supplier_id, s.name AS supplier_name
        FROM orders o JOIN suppliers s ON s.id = o.supplier_id
        WHERE o.requisition_id = ? ORDER BY s.name
      `).all(id);

      const itemsStmt = db.prepare(`
        SELECT oi.id AS item_id, p.name AS product_name, p.unit, oi.qty_requested, oi.qty_final, oi.note
        FROM order_items oi JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = ? ORDER BY p.name
      `);

      const result = orders.map(o => ({
        order_id: o.order_id,
        supplier: { id: o.supplier_id, name: o.supplier_name },
        items: itemsStmt.all(o.order_id),
      }));

      res.json({ ok: true, orders: result });
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });
}

/* ================== Misc & static ================== */
app.get('/api/me', (req, res, next) => authMiddleware(req, res, () => {
  res.json({ ok: true, user: { id: req.user.tg_user_id, name: req.user.name, role: req.user.role } });
}));

app.get('/healthz', (_req, res) => res.json({ ok: true }));

const pathFrontend = path.resolve(__dirname, '../public');
app.use(express.static(path.join(__dirname, "../public")));
app.get(['/admin', '/admin.html'], (_req, res) => res.sendFile(path.join(pathFrontend, 'admin.html')));
app.get(['/staff', '/staff.html'], (_req, res) => res.sendFile(path.join(pathFrontend, 'staff.html')));
app.get('/', (_req, res) => res.sendFile(path.join(pathFrontend, 'index.html')));
app.get('/favicon.ico', (_req, res) => res.status(204).end());

/* ================== Start ================== */
(async function start() {
  try {
    await loadDb();
    if (typeof migrate === 'function') { try { migrate(); } catch (e) { console.warn('[migrate ext]', e?.message || e); } }
    ensureSchema();
    registerCatalogRoutes(app);
    registerRequisitionRoutes(app);

    console.log('[Config] DEV_ALLOW_UNSAFE:', DEV_ALLOW_UNSAFE);
    console.log('[Config] ADMIN_TG_IDS:', process.env.ADMIN_TG_IDS || '(none)');
    console.log('[schema] requisitions author column =', REQ_USER_COL);

    const port = Number(process.env.PORT || 8080);
    app.listen(port, () => console.log('API listening on', port));
  } catch (err) {
    console.error('Fatal start error:', err);
    process.exit(1);
  }
})();
