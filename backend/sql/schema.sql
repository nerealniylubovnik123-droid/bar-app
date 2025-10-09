-- Suppliers
CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  contact_note TEXT DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1
);

-- Products (each product has exactly one supplier)
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  unit TEXT NOT NULL,
  category TEXT DEFAULT 'Общее',
  supplier_id INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
);

-- Users (Telegram-authenticated)
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_user_id TEXT NOT NULL UNIQUE,
  name TEXT DEFAULT '',
  role TEXT NOT NULL CHECK (role IN ('admin','staff')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Requisitions
CREATE TABLE IF NOT EXISTS requisitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_by TEXT NOT NULL,  -- tg_user_id
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created','processed'))
);

-- Requisition items
CREATE TABLE IF NOT EXISTS requisition_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  requisition_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  qty_requested REAL NOT NULL,
  FOREIGN KEY (requisition_id) REFERENCES requisitions(id),
  FOREIGN KEY (product_id) REFERENCES products(id)
);

-- Orders per supplier
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  requisition_id INTEGER NOT NULL,
  supplier_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','ordered','received')),
  note TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (requisition_id) REFERENCES requisitions(id),
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
);

-- Items per order
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  qty_requested REAL NOT NULL,
  qty_final REAL NOT NULL,
  note TEXT DEFAULT '',
  FOREIGN KEY (order_id) REFERENCES orders(id),
  FOREIGN KEY (product_id) REFERENCES products(id)
);

-- Audit log
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  user_id TEXT DEFAULT '',
  payload_json TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
