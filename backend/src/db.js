import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbFile = process.env.SQLITE_PATH || process.env.DB_FILE || path.resolve(__dirname, '../../data.sqlite');
const sqlPath = path.resolve(__dirname, '../sql/schema.sql');

fs.mkdirSync(path.dirname(dbFile), { recursive: true });
export const db = new Database(dbFile);
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');

export function migrate() {
  const schema = fs.readFileSync(sqlPath, 'utf8');
  db.exec(schema);
}
