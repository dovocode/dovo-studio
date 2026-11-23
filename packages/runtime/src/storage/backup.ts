import Database from 'better-sqlite3'
import { existsSync } from 'node:fs'
import { Worker } from 'node:worker_threads'
import type { RuntimeBackupProgress } from '@dovo/protocol'

export type BackupWorkerProgress = Omit<RuntimeBackupProgress, 'startedAt'>

export function backupRuntimeDatabase(
  source: string,
  destination: string,
  {
    verify = false,
    onProgress,
  }: { verify?: boolean; onProgress?: (progress: BackupWorkerProgress) => void } = {},
) {
  const compiled = new URL('./backup-worker.js', import.meta.url)
  const entry = existsSync(compiled) ? compiled : new URL('./backup-worker.ts', import.meta.url)
  return new Promise<void>((resolve, reject) => {
    const worker = new Worker(entry, {
      workerData: { source, destination, verify, reportProgress: !!onProgress },
      execArgv: entry.pathname.endsWith('.ts') ? ['--import', import.meta.resolve('tsx')] : [],
    })
    if (onProgress) worker.on('message', onProgress)
    worker.once('error', reject)
    worker.once('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`SQLite backup worker exited with code ${code}`))
    })
  })
}

export function verifyRuntimeBackup(path: string) {
  const db = new Database(path, { readonly: true, fileMustExist: true })
  try {
    if (db.pragma('quick_check', { simple: true }) !== 'ok')
      throw new Error('Backup failed SQLite integrity check')
    if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='documents'").get())
      throw new Error('This is not a Dovo runtime database')
  } finally {
    db.close()
  }
}
