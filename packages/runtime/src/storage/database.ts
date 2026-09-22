import Database from 'better-sqlite3'
import { mkdirSync, chmodSync } from 'node:fs'
import { dirname } from 'node:path'
export function openDatabase(path: string): Database.Database {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.exec(`CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS devices (id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, revoked_at TEXT);
    CREATE TABLE IF NOT EXISTS job_runs (id TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS deliveries (key TEXT PRIMARY KEY, created_at TEXT NOT NULL);`)
  if (path !== ':memory:') chmodSync(path, 0o600)
  return db
}
