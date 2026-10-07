import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { decode, desktopUpdateHostSchema, serverUpdateStatusSchema } from '@dovo/protocol'
import { readLocalSettingsSection } from '@dovo/protocol/local-settings'
import { HttpError } from '../errors.js'

function readDesktopHost(shared = false) {
  if (!shared && process.env.DOVO_RELEASE_DISTRIBUTION !== 'desktop') return undefined
  const directory = shared
    ? (process.env.DOVO_DATA_ROOT ?? join(homedir(), '.dovo'))
    : dirname(process.env.DOVO_DATABASE_PATH ?? join(homedir(), '.dovo', 'runtime.sqlite'))
  try {
    const host = decode(
      desktopUpdateHostSchema,
      JSON.parse(readFileSync(join(directory, 'desktop-update-host.json'), 'utf8')),
    )
    return host
  } catch {
    return undefined
  }
}
function desktopHost(shared = false) {
  const host = readDesktopHost(shared)
  if (!host) return undefined
  try {
    process.kill(host.pid, 0)
    return host
  } catch {
    return undefined
  }
}
export function desktopAppUpdateInfo() {
  const host = readDesktopHost(true)
  if (!host?.version) return undefined
  let channel: 'stable' | 'nightly' | undefined
  try {
    const value = readLocalSettingsSection('updates')
    if (value === 'stable' || value === 'nightly') channel = value
  } catch {
    console.warn('Could not read desktop update channel; using the installed release channel.')
  }
  return { version: host.version, canUpdate: !!desktopHost(true), channel }
}
export const canUpdateDesktop = () => !!desktopHost()
export async function desktopUpdate(
  action: 'status' | 'download' | 'restart',
  version?: string,
  shared = false,
) {
  const host = desktopHost(shared)
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
