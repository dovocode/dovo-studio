import { decode } from '@dovo/protocol'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { commandsSchema, commandSettingsResponse, snapshotSchema, type Agent } from '@dovo/protocol'
import { checkAdapterUpdates } from '@dovo/runtime'
import { readConnection } from './connection.js'
import { serverStatus } from './server-manager.js'
export async function serverDoctor(directory: string, checkUpdates = false) {
  const status = await serverStatus(directory)
  let settings = decode(commandsSchema, {})
  let agents: Agent[] = []
  const warnings: string[] = []
  if (status.running) {
    try {
      const connection = readConnection(join(directory, 'runtime-connection.json'))
      const headers = {
        Authorization: `Bearer ${connection.token}`,
        'Content-Type': 'application/json',
      }
      const [commands, snapshot] = await Promise.all([
        fetch(connection.address + '/api/commands/read', {
          method: 'POST',
          body: '{}',
          headers,
          redirect: 'error',
          signal: AbortSignal.timeout(5000),
        }),
        fetch(connection.address + '/api/snapshot', {
          headers,
          redirect: 'error',
          signal: AbortSignal.timeout(5000),
        }),
      ])
      if (!commands.ok || !snapshot.ok) throw new Error('Runtime settings could not be read.')
      settings = decode(commandSettingsResponse, await commands.json()).settings
      agents = decode(snapshotSchema, await snapshot.json()).workspace.agents
    } catch (error) {
      warnings.push(
        `${error instanceof Error ? error.message : String(error)} Adapter checks use default executable names.`,
      )
    }
  } else
    warnings.push(
      'Runtime is offline. Adapter checks use default executable names; start it to check saved custom commands.',
    )
  const manifest: unknown = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  )
  const version =
    manifest &&
    typeof manifest === 'object' &&
    'version' in manifest &&
    typeof manifest.version === 'string'
      ? manifest.version
      : 'unknown'
  const adapters = await checkAdapterUpdates(settings, {
    checkUpdates,
    agents,
  })
  return {
    version,
    nodeVersion: process.version,
    platform: `${process.platform}/${process.arch}`,
    runtime: status,
    warnings,
    adapters,
  }
}
