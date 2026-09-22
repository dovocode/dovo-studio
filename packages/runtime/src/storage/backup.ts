import Database from 'better-sqlite3'
import { chmodSync } from 'node:fs'

// SQLite's backup API includes committed WAL contents; copying a live .sqlite file does not.
export async function backupRuntimeDatabase(source: string, destination: string) {
  const database = new Database(source, { readonly: true, fileMustExist: true })
  try {
    await database.backup(destination)
    chmodSync(destination, 0o600)
  } finally {
    database.close()
  }
}
