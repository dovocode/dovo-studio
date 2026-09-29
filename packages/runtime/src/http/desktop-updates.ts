import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { decode, desktopUpdateHostSchema, serverUpdateStatusSchema } from '@dovo/protocol'
import { HttpError } from '../errors.js'

function desktopHost() {
  if (process.env.DOVO_RELEASE_DISTRIBUTION !== 'desktop') return undefined
  const directory = dirname(
    process.env.DOVO_DATABASE_PATH ?? join(homedir(), '.dovo', 'runtime.sqlite'),
  )
  try {
    const host = decode(
      desktopUpdateHostSchema,
      JSON.parse(readFileSync(join(directory, 'desktop-update-host.json'), 'utf8')),
    )
    process.kill(host.pid, 0)
    return host
  } catch {
    return undefined
  }
}
export const canUpdateDesktop = () => !!desktopHost()
export async function desktopUpdate(action: 'status' | 'download' | 'restart', version?: string) {
  const host = desktopHost()
  if (!host)
    throw new HttpError(409, 'Open the signed desktop app on this computer to update it remotely.')
  const response = await fetch(`http://127.0.0.1:${host.port}/${action}`, {
    method: action === 'status' ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${host.token}`, 'Content-Type': 'application/json' },
    body: action === 'status' ? undefined : JSON.stringify({ version }),
    signal: AbortSignal.timeout(5000),
  })
  const value: unknown = await response.json()
  if (!response.ok)
    throw new HttpError(
      response.status,
      value && typeof value === 'object' && 'error' in value && typeof value.error === 'string'
        ? value.error
        : 'Desktop updater is unavailable',
    )
  return decode(serverUpdateStatusSchema, value)
}
