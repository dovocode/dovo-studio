import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { decodeResult, desktopBrowserHostSchema } from '@dovo/protocol'

export type DesktopBrowserTarget = (typeof desktopBrowserHostSchema.Type)['targets'][number]

/** Desktop discovery is optional; a closed desktop app must never break browser tools. */
export function readDesktopBrowserTargets(): DesktopBrowserTarget[] {
  if (process.env.DOVO_RELEASE_DISTRIBUTION !== 'desktop') return []
  const directory = dirname(
    process.env.DOVO_DATABASE_PATH ?? join(homedir(), '.dovo', 'runtime.sqlite'),
  )
  try {
    const host = decodeResult(
      desktopBrowserHostSchema,
      JSON.parse(readFileSync(join(directory, 'desktop-browser-host.json'), 'utf8')),
    )
    if (!host.success) return []
    process.kill(host.data.pid, 0)
    return [...host.data.targets]
  } catch {
    return []
  }
}
