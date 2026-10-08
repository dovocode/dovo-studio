import { stat, truncate, rename, rm, chmod, open } from 'node:fs/promises'
import { join } from 'node:path'

const LOG_NAMES = [
  'server.log',
  'runtime-service.log',
  'server-update.log',
  'service.log',
  'update.log',
]
/** Copy/truncate keeps append-only descriptors valid across runtime and supervisor processes. */
export async function rotateRuntimeLogs(directory: string, maxBytes = 10 * 1024 * 1024) {
  for (const name of LOG_NAMES) {
    const path = join(directory, name)
    const info = await stat(path).catch((error: unknown) => {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
      throw error
    })
    if (!info || info.size <= maxBytes) continue
    await rm(path + '.3', { force: true })
    for (const index of [2, 1]) {
      await rename(path + `.${index}`, path + `.${index + 1}`).catch((error: unknown) => {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
      })
    }
    // Only the newest budget of each log is retained, even after a burst while offline.
    const source = await open(path, 'r')
    try {
      const destination = await open(path + '.1', 'w', 0o600)
      try {
        const bytes = Buffer.alloc(Math.min(maxBytes, info.size))
        const { bytesRead } = await source.read(
          bytes,
          0,
          bytes.length,
          Math.max(0, info.size - bytes.length),
        )
        await destination.write(bytes.subarray(0, bytesRead))
      } finally {
        await destination.close()
      }
    } finally {
      await source.close()
    }
    await chmod(path + '.1', 0o600)
    await truncate(path, 0)
  }
}
