import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '../data/overleaf.db');

// Ensure data directory exists
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db: Database.Database = new Database(dbPath);

// Enable WAL mode for better read concurrency
db.pragma('journal_mode = WAL');

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    content TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS project_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    path TEXT NOT NULL,
    content TEXT DEFAULT '',
    is_folder INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id, path)
  );

  CREATE TABLE IF NOT EXISTS project_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'viewer' CHECK(role IN ('viewer', 'editor', 'owner')),
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS share_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    token TEXT UNIQUE NOT NULL,
    role TEXT NOT NULL DEFAULT 'viewer' CHECK(role IN ('viewer', 'editor')),
    created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
`);

// Add auto_save_interval column to projects (may already exist from prior migrations)
try {
  db.exec('ALTER TABLE projects ADD COLUMN auto_save_interval INTEGER DEFAULT 5');
} catch {
  // Column already exists — ignore
}

// Add display_name column to users (may already exist)
try {
  db.exec('ALTER TABLE users ADD COLUMN display_name TEXT');
} catch {
  // Column already exists — ignore
}

// Ensure the project owner is always a project_member with role 'owner'
// Migration: insert owner memberships for existing projects
try {
  const existingProjects = db.prepare('SELECT id, user_id FROM projects').all() as any[];
  const insertMember = db.prepare(
    'INSERT OR IGNORE INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)'
  );
  const transaction = db.transaction(() => {
    for (const p of existingProjects) {
      insertMember.run(p.id, p.user_id, 'owner');
    }
  });
  transaction();
} catch {
  // Table may not exist yet during initial setup
}

export default db;