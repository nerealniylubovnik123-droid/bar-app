// backend/src/server.js
import dns from 'dns';
import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import cors from 'cors';
import dotenv from 'dotenv';
import { db, migrate } from './db.js';

// Сначала IPv4 — часто лечит таймауты на Windows
dns.setDefaultResultOrder('ipv4first');
// Читаем .env и ПЕРЕЗАПИСЫВАЕМ переменные окружения, если уже были
dotenv.config({ override: true });

const app = express();

// --- Базовые middlewares ---
app.use(helmet());
app.use(compression());
app.use(express.json());
app.use(morgan('dev'));

// --- CORS (dev-friendly) ---
const corsOptions = {
  origin: (_origin, cb) => cb(null, true), // пускаем любой origin в dev
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-TG-INIT-DATA'],
  maxAge: 86400,
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// --- Миграции БД ---
migrate();

// ==================== Auth helpers ====================
const DEV_ALLOW_UNSAFE = String(process.env.DEV_ALLOW_UNSAFE || '').toLowerCase() === 'true';

function rowToUser(row) {
  return row ? { id: row.tg_user_id, name: row.name, role: row.role } : null;
}

function ensureUser(tgId, name, roleGuess = 'staff') {
  const get = db.prepare('SELECT * FROM users WHERE tg_user_id = ?');
  let u = get.get(tgId);
  if (!u) {
    db.prepare('INSERT INTO users (tg_user_id, name, role) VALUES (?,?,?)')
      .run(tgId, name || '', roleGuess);
    u = get.get(tgId);
  }
  return rowToUser(u);
}

// В проде сюда добавь реальную проверку подписи Telegram WebApp.
// В dev допускаем пустой initData (если DEV_ALLOW_UNSAFE=true).
function verifyInitData(initData) {
  if (DEV_ALLOW_UNSAFE) return { ok: true, user: { id: 'dev', name: 'Dev Admin' } };
  if (!initData) return { ok: false, error: 'Missing initData' };
  return { ok: false, error: 'Telegram verification not implemented' };
}

function authMiddleware(req, res, next) {
  const initData = req.header('X-TG-INIT-DATA') || req.query.initData;
  const v = verifyInitData(initData);
  if (!v.ok) return res.status(401).json({ ok: false, error: v.error });
  const user = ensureUser(v.user.id, v.user.name);
  req.user = user;
  next();
}

function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ ok: false, error: 'admin only' });
  next();
}

// ==================== Telegram ====================
async function sendTelegram(text) {
  const token = process.env.BOT_TOKEN;
  const idsStr = process.env.ADMIN_TG_IDS;
  if (!token || !idsStr) return;

  const ids = idsStr.split(',').map(s => s.trim()).filter(Boolean);

  async function postJSON(url, payload, { timeoutMs = 20000, retries = 3 } = {}) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        clearTimeout(timer);
        const json = await res.json().catch(() => ({}));
        if (!res.ok || json?.ok === false) {
          throw new Error(`HTTP ${res.status} ${res.statusText} ${JSON.stringify(json)}`);
        }
        return json;
      } catch (e) {
        clearTimeout(timer);
        const msg = String(e?.message || e);
        const isRetryable =
          msg.includes('AbortError') ||
          msg.toLowerCase().includes('timeout') ||
          msg.includes('UND_ERR_CONNECT_TIMEOUT') ||
          msg.includes('fetch failed');
        console.warn(`[Telegram] попытка ${attempt} не удалась:`, msg);
        if (!isRetryable || attempt === retries) throw e;
        await new Promise(r => setTimeout(r, 1000 * attempt));
      }
    }
  }

  for (const chatId of ids) {
    try {
      const url = `https://api.telegram.org/bot${token}/sendMessage`;
      const payload = { chat_id: chatId, text };
      const result = await postJSON(url, payload, { timeoutMs: 20000, retries: 3 });
      console.log('[Telegram]', chatId, result.ok ? 'ok' : result);
    } catch (e) {
      console.error('[Telegram error]', chatId, e);
    }
  }
}

// ==================== Staff API ====================

// Список активных товаров (без поставщиков — сотруднику не показываем)
app.get('/api/products', authMiddleware, (_req, res) => {
  const products = db
    .prepare('SELECT id, name, unit, category FROM products WHERE active = 1 ORDER BY name')
    .all();
  res.json({ ok: true, products });
});

// Создание заявки + автосплит по поставщикам + уведомление в TG
app.post('/api/requisitions', authMiddleware, (req, res) => {
  const { items } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ ok: false, error: 'Empty items' });
  }
  for (const it of items) {
    if (!it || typeof it.product_id !== 'number' || typeof it.qty !== 'number' || it.qty <= 0) {
      return res.status(400).json({ ok: false, error: 'Invalid item' });
    }
  }

  const trx = db.transaction(() => {
    // 1) создаём заявку
    const insReq = db.prepare("INSERT INTO requisitions (created_by, status) VALUES (?, 'created')");
    const { lastInsertRowid: reqId } = insReq.run(req.user.id);

    // 2) подготовим стейтменты
    const insReqItem = db.prepare(
      'INSERT INTO requisition_items (requisition_id, product_id, qty_requested) VALUES (?,?,?)'
    );
    const getProd = db.prepare('SELECT id, supplier_id FROM products WHERE id=? AND active=1');

    // 3) заказы по поставщикам
    const ordersMap = new Map(); // supplier_id -> order_id
    const insOrder = db.prepare(
      "INSERT INTO orders (requisition_id, supplier_id, status) VALUES (?, ?, 'draft')"
    );
    const insOrderItem = db.prepare(
      'INSERT INTO order_items (order_id, product_id, qty_requested, qty_final) VALUES (?,?,?,?)'
    );

    for (const it of items) {
      const prod = getProd.get(it.product_id);
      if (!prod) throw new Error(`Product ${it.product_id} not found or inactive`);

      insReqItem.run(reqId, prod.id, it.qty);

      let orderId = ordersMap.get(prod.supplier_id);
      if (!orderId) {
        const r = insOrder.run(reqId, prod.supplier_id);
        orderId = Number(r.lastInsertRowid);
        ordersMap.set(prod.supplier_id, orderId);
      }
      // qty_final = qty_requested по умолчанию
      insOrderItem.run(orderId, prod.id, it.qty, it.qty);
    }

    // 4) помечаем заявку обработанной (раскидана)
    db.prepare("UPDATE requisitions SET status = 'processed' WHERE id=?").run(reqId);

    return reqId;
  });

  let reqId;
  try {
    reqId = trx();
  } catch (e) {
    console.error('requisition error', e);
    return res.status(400).json({ ok: false, error: e.message });
  }

  // --- Telegram уведомление с позициями (сгруппировано по поставщикам)
  (async () => {
    try {
      const rows = db.prepare(`
        SELECT s.name AS supplier, p.name AS product, p.unit, ri.qty_requested AS qty
        FROM requisition_items ri
        JOIN products  p ON p.id = ri.product_id
        JOIN suppliers s ON s.id = p.supplier_id
        WHERE ri.requisition_id = ?
        ORDER BY s.name, p.name
      `).all(reqId);

      const bySupplier = new Map();
      for (const r of rows) {
        if (!bySupplier.has(r.supplier)) bySupplier.set(r.supplier, []);
        bySupplier.get(r.supplier).push(`• ${r.product} — ${r.qty} ${r.unit}`);
      }

      const header = [
        `🆕 Новая заявка #${reqId}`,
        `Автор: ${req.user.name || req.user.id}`,
        `Позиции: ${rows.length}`,
      ].join('\n');

      const parts = [header];
      for (const [supplier, lines] of bySupplier) {
        parts.push(`\n— ${supplier} —`);
        for (const line of lines) parts.push(line);
      }

      let text = parts.join('\n');
      if (text.length > 4096) {
        const limit = 4096 - 20;
        text = text.slice(0, limit) + '\n…и ещё позиции';
      }

      await sendTelegram(text);
    } catch (e) {
      console.error('notify build error', e);
    }
  })();

  res.json({ ok: true, requisition_id: reqId });
});

// ==================== Admin API ====================

app.get('/api/admin/requisitions', authMiddleware, adminOnly, (_req, res) => {
  const rows = db.prepare(`
    SELECT r.id, r.created_at, r.status, u.name AS author_name, r.created_by
    FROM requisitions r
    LEFT JOIN users u ON u.tg_user_id = r.created_by
    ORDER BY r.id DESC
  `).all();

  const countStmt = db.prepare('SELECT COUNT(*) AS cnt FROM requisition_items WHERE requisition_id = ?');

  const data = rows.map(r => ({
    id: r.id,
    created_at: r.created_at,
    status: r.status,
    author: r.author_name || r.created_by,
    positions: countStmt.get(r.id).cnt,
  }));

  res.json({ ok: true, requisitions: data });
});

app.get('/api/admin/requisitions/:id', authMiddleware, adminOnly, (req, res) => {
  const id = Number(req.params.id);

  const orders = db.prepare(`
    SELECT o.id as order_id, o.status, o.supplier_id, s.name as supplier_name
    FROM orders o
    JOIN suppliers s ON s.id = o.supplier_id
    WHERE o.requisition_id = ?
    ORDER BY s.name
  `).all(id);

  const itemsStmt = db.prepare(`
    SELECT oi.id as item_id, p.name as product_name, p.unit, oi.qty_requested, oi.qty_final, oi.note
    FROM order_items oi
    JOIN products p ON p.id = oi.product_id
    WHERE oi.order_id = ?
    ORDER BY p.name
  `);

  const result = orders.map(o => ({
    order_id: o.order_id,
    supplier: { id: o.supplier_id, name: o.supplier_name },
    status: o.status,
    items: itemsStmt.all(o.order_id),
  }));

  res.json({ ok: true, orders: result });
});

app.post('/api/admin/orders/:id/status', authMiddleware, adminOnly, (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body || {};
  const allowed = new Set(['draft', 'approved', 'ordered', 'received']);
  if (!allowed.has(status)) return res.status(400).json({ ok: false, error: 'Bad status' });
  db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, id);
  res.json({ ok: true });
});

app.post('/api/admin/orders/:orderId/items/:itemId', authMiddleware, adminOnly, (req, res) => {
  const { orderId, itemId } = req.params;
  const { qty_final, note } = req.body || {};
  if (qty_final !== undefined) {
    const q = Number(qty_final);
    if (!(q >= 0)) return res.status(400).json({ ok: false, error: 'Bad qty_final' });
    db.prepare('UPDATE order_items SET qty_final = ? WHERE id = ? AND order_id = ?')
      .run(q, itemId, orderId);
  }
  if (note !== undefined) {
    db.prepare('UPDATE order_items SET note = ? WHERE id = ? AND order_id = ?')
      .run(String(note), itemId, orderId);
  }
  res.json({ ok: true });
});

// ==================== Service ====================
app.get('/healthz', (_req, res) => res.status(200).json({ ok: true }));

// Временный ручной тест Telegram (можно удалить)
app.get('/debug/telegram', async (_req, res) => {
  try {
    await sendTelegram('Тест уведомления из backend');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// ==================== Start ====================
const port = Number(process.env.PORT || 8080);
console.log('[Config] BOT_TOKEN len:', (process.env.BOT_TOKEN || '').length,
            'prefix:', (process.env.BOT_TOKEN || '').slice(0, 12),
            'suffix:', (process.env.BOT_TOKEN || '').slice(-6));
console.log('[Config] ADMIN_TG_IDS:', process.env.ADMIN_TG_IDS);
console.log('[Config] DEV_ALLOW_UNSAFE:', DEV_ALLOW_UNSAFE);

app.listen(port, () => console.log('API listening on', port));
