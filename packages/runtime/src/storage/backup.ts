import Database from 'better-sqlite3'
import { closeSync, openSync } from 'node:fs'

// SQLite's backup API includes committed WAL contents; copying a live .sqlite file does not.
export async function backupRuntimeDatabase(source: string, destination: string) {
  const database = new Database(source, { readonly: true, fileMustExist: true })
  try {
    // Restrict access before the first SQLite page is written, including interrupted backups.
    // Destinations are operation-owned; never overwrite a pre-existing recovery file.
    closeSync(openSync(destination, 'wx', 0o600))
    await database.backup(destination)
  } finally {
    database.close()
  }
}
