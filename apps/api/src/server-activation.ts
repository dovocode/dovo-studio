import { existsSync } from 'node:fs'
import { cp, mkdir, rm, rename } from 'node:fs/promises'
import { dirname } from 'node:path'
import { backupRuntimeDatabase } from '@dovo/runtime'

/** Activation includes readiness verification. Rollback never writes beneath a live process. */
export async function activateServerRelease(options: {
  databasePath: string
  backupPath: string
  wasRunning: boolean
  stop: () => Promise<void>
  select: () => void | Promise<void>
  rollback: () => void
  start: () => Promise<void>
  verify?: () => Promise<void>
}) {
  await options.stop()
  let backedUp = false
  try {
    if (existsSync(options.databasePath)) {
      await mkdir(dirname(options.backupPath), { recursive: true, mode: 0o700 })
      await backupRuntimeDatabase(options.databasePath, options.backupPath)
      backedUp = true
    }
    await options.select()
    await options.start()
    await options.verify?.()
  } catch (error) {
    try {
      await options.stop()
    } catch (cause) {
      throw new AggregateError(
        [error, cause],
        `Candidate could not be stopped; database was not restored. Backup: ${options.backupPath}`,
      )
    }
    try {
      if (backedUp) {
        const temporary = options.backupPath + '.restore'
        await cp(options.backupPath, temporary)
        await rm(options.databasePath + '-wal', { force: true })
        await rm(options.databasePath + '-shm', { force: true })
        await rename(temporary, options.databasePath)
      }
      options.rollback()
      if (options.wasRunning) await options.start()
    } catch (cause) {
      throw new AggregateError(
        [error, cause],
        `Release activation and recovery failed. Backup: ${options.backupPath}`,
      )
    }
    throw new Error('Release activation failed; previous release and database were restored.', {
      cause: error,
    })
  }
}
