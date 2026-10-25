// SQLite database. One file at backend/data/app.db (or DB_FILE). Back this file up regularly.
const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");
const seed = require("./data/content.json");

const dir = path.join(__dirname, "data");
fs.mkdirSync(dir, { recursive: true });
const db = new Database(process.env.DB_FILE || path.join(dir, "app.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS content (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE, phone TEXT UNIQUE,
  pass_hash TEXT NOT NULL, two_fa INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS codes (key TEXT PRIMARY KEY, code TEXT NOT NULL, expires_at INTEGER NOT NULL, payload TEXT);
CREATE TABLE IF NOT EXISTS reservations (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL, email TEXT, date TEXT NOT NULL,
  time TEXT NOT NULL, guests INTEGER NOT NULL, notes TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY, ref TEXT UNIQUE NOT NULL, lines TEXT NOT NULL, subtotal REAL NOT NULL, fee REAL NOT NULL,
  total REAL NOT NULL, mode TEXT NOT NULL, address TEXT, name TEXT NOT NULL, phone TEXT NOT NULL, time TEXT,
  notes TEXT, display_name TEXT, opt_in INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL,
  stripe_session TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS loyalty (
  phone TEXT PRIMARY KEY, points INTEGER NOT NULL DEFAULT 0, display_name TEXT, opt_in INTEGER NOT NULL DEFAULT 0);
`);

// Migration: link orders to customer accounts (older databases did not have this column).
if (!db.prepare("PRAGMA table_info(orders)").all().some(c => c.name === "user_id")) {
  db.exec("ALTER TABLE orders ADD COLUMN user_id TEXT");
}
if (!db.prepare("PRAGMA table_info(codes)").all().some(c => c.name === "attempts")) {
  db.exec("ALTER TABLE codes ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0");
}
db.exec("CREATE INDEX IF NOT EXISTS orders_user ON orders (user_id)");
db.exec("CREATE INDEX IF NOT EXISTS orders_phone ON orders (phone)");

// First run: load the seed content. After that, the database is the source of truth.
if (!db.prepare("SELECT 1 FROM content WHERE id = 1").get()) {
  db.prepare("INSERT INTO content (id, json) VALUES (1, ?)").run(JSON.stringify(seed));
}

module.exports = {
  db,
  getContent: () => JSON.parse(db.prepare("SELECT json FROM content WHERE id = 1").get().json),
  setContent: c => db.prepare("UPDATE content SET json = ? WHERE id = 1").run(JSON.stringify(c)),
};
