import { statSync, renameSync, rmSync } from 'node:fs'

export const LOG_NAMES = [
  'server.log',
  'runtime-service.log',
  'server-update.log',
  'service.log',
  'update.log',
]
/** Rotate immediately before the owner opens its next descriptor. */
export function rotateRuntimeLog(path: string, maxBytes = 10 * 1024 * 1024) {
  const info = statSync(path, { throwIfNoEntry: false })
  if (!info?.isFile() || info.size <= maxBytes) return
  rmSync(path + '.3', { force: true })
  for (const index of [2, 1]) {
    try {
      renameSync(path + `.${index}`, path + `.${index + 1}`)
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    }
  }
  // A late append to an inherited descriptor remains in this archive.
  renameSync(path, path + '.1')
}
