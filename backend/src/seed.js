import { db, migrate } from './db.js';

migrate();

// Suppliers
const suppliers = ['Drinks Company', 'Fresh Fruits', 'HoReCa Supplies'];
for (const name of suppliers) {
  db.prepare('INSERT OR IGNORE INTO suppliers (name, contact_note, active) VALUES (?, ?, 1)').run(name, '');
}

// Fetch supplier ids
const s = Object.fromEntries(db.prepare('SELECT id, name FROM suppliers').all().map(r => [r.name, r.id]));

// Products (each with a single supplier)
const products = [
  { name: 'Кока-Кола 0.33 л', unit: 'шт', category: 'Бар', supplier: 'Drinks Company' },
  { name: 'Red Bull 0.25 л', unit: 'шт', category: 'Бар', supplier: 'Drinks Company' },
  { name: 'Тоник Schweppes', unit: 'шт', category: 'Бар', supplier: 'Drinks Company' },
  { name: 'Апельсины свежие', unit: 'кг', category: 'Фрукты', supplier: 'Fresh Fruits' },
  { name: 'Лимоны свежие', unit: 'кг', category: 'Фрукты', supplier: 'Fresh Fruits' },
  { name: 'Мята свежая', unit: 'пучок', category: 'Фрукты', supplier: 'Fresh Fruits' },
  { name: 'Салфетки 100 шт', unit: 'уп', category: 'Хозтовары', supplier: 'HoReCa Supplies' },
  { name: 'Трубочки коктейльные', unit: 'уп', category: 'Хозтовары', supplier: 'HoReCa Supplies' }
];

for (const p of products) {
  db.prepare('INSERT INTO products (name, unit, category, supplier_id, active) VALUES (?,?,?,?,1)')
    .run(p.name, p.unit, p.category, s[p.supplier]);
}

console.log('Seed completed.');
