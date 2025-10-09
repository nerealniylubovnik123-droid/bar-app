// backend/src/make-dev-admin.js
import Database from 'better-sqlite3';

// Путь к БД: берём из .env или локальный файл
const dbFile = process.env.DB_FILE || './data.sqlite';
const db = new Database(dbFile);

// назначаем роль admin пользователю с tg_user_id='dev'
const r = db.prepare("UPDATE users SET role='admin' WHERE tg_user_id=?").run('dev');

// если записи не было — создадим пользователя-админа
if (r.changes === 0) {
  db.prepare("INSERT INTO users (tg_user_id, name, role) VALUES (?,?,?)").run('dev', 'Dev Admin', 'admin');
}

console.log('OK: dev -> admin');
