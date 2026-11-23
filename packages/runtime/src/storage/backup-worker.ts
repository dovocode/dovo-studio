import Database from 'better-sqlite3'
import { closeSync, openSync } from 'node:fs'
import { parentPort, workerData } from 'node:worker_threads'
import { verifyRuntimeBackup, type BackupWorkerProgress } from './backup.js'

const {
  source,
  destination,
  verify,
  reportProgress,
}: {
  source: string
  destination: string
  verify: boolean
  reportProgress: boolean
} = workerData
const report = (progress: BackupWorkerProgress) => {
  if (reportProgress) parentPort?.postMessage(progress)
}
const db = new Database(source, { readonly: true, fileMustExist: true })
try {
  // Pin a WAL read snapshot so commits from other connections cannot restart the copy.
  db.exec('BEGIN')
  db.pragma('schema_version', { simple: true })
  closeSync(openSync(destination, 'wx', 0o600))
  report({ phase: 'copying' })
  let lastReport = -Infinity
  await db.backup(
    destination,
    reportProgress
      ? {
          progress: ({ totalPages, remainingPages }) => {
            const now = performance.now()
            if (now - lastReport >= 250) {
              lastReport = now
              report({ phase: 'copying', copiedPages: totalPages - remainingPages, totalPages })
            }
            return 100
          },
        }
      : undefined,
  )
} finally {
  db.close()
}
if (verify) {
  report({ phase: 'verifying' })
  verifyRuntimeBackup(destination)
}
