const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const crypto = require('node:crypto');

const DB_PATH = path.join(__dirname, 'voting.db');
const db = new DatabaseSync(DB_PATH);

// ---------- Schema ----------
db.exec(`
  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS positions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS candidates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    party TEXT,
    photo_url TEXT,
    position_id INTEGER REFERENCES positions(id) ON DELETE SET NULL,
    votes INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS voters (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    has_voted INTEGER NOT NULL DEFAULT 0,
    voted_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    voter_id TEXT NOT NULL REFERENCES voters(id),
    candidate_id INTEGER NOT NULL REFERENCES candidates(id),
    position_id INTEGER REFERENCES positions(id),
    voted_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS election_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    title TEXT NOT NULL DEFAULT 'Student Council Election',
    is_open INTEGER NOT NULL DEFAULT 1
  );
`);

// Migrations for existing databases
['photo_url', 'position_id'].forEach(col => {
  try { db.exec(`ALTER TABLE candidates ADD COLUMN ${col} TEXT`); } catch (e) {}
});
try { db.exec(`ALTER TABLE candidates ADD COLUMN position_id INTEGER REFERENCES positions(id) ON DELETE SET NULL`); } catch (e) {}

// Create votes table if not exists (upgrade path)
try {
  db.exec(`CREATE TABLE IF NOT EXISTS votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    voter_id TEXT NOT NULL,
    candidate_id INTEGER NOT NULL,
    position_id INTEGER,
    voted_at TEXT DEFAULT (datetime('now'))
  )`);
} catch (e) {}

// Seed election settings row if missing
const settingsRow = db.prepare('SELECT * FROM election_settings WHERE id = 1').get();
if (!settingsRow) {
  db.prepare(`INSERT INTO election_settings (id, title, is_open) VALUES (1, 'Student Council Election', 1)`).run();
}

// Seed default positions if none exist
const posCount = db.prepare('SELECT COUNT(*) AS c FROM positions').get().c;
if (posCount === 0) {
  [
    { title: 'President', sort_order: 1 },
    { title: 'Vice President', sort_order: 2 },
    { title: 'Secretary', sort_order: 3 },
  ].forEach(p => {
    db.prepare('INSERT INTO positions (title, sort_order) VALUES (?, ?)').run(p.title, p.sort_order);
  });
}

// ---------- Password hashing ----------
function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
}

function createAdmin(username, password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPassword(password, salt);
  db.prepare('INSERT INTO admins (username, password_hash, salt) VALUES (?, ?, ?)').run(username, hash, salt);
}

function verifyAdmin(username, password) {
  const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
  if (!admin) return false;
  const hash = hashPassword(password, admin.salt);
  return hash === admin.password_hash;
}

// Seed a default admin account if none exists
const adminCount = db.prepare('SELECT COUNT(*) AS c FROM admins').get().c;
if (adminCount === 0) {
  createAdmin('admin', 'admin123');
  console.log('Default admin created -> username: admin | password: admin123 (change this!)');
}

module.exports = { db, verifyAdmin, createAdmin };
