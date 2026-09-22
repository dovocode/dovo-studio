import { discoverNetworks, networkUrls } from './network.js'
import { parseArgs } from 'node:util'
import { responses, snapshotSchema } from '@dovo/protocol'
import { connectionPaths, readConnection, type LocalConnection } from './connection.js'
async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      connection: { type: 'string' },
      'public-address': { type: 'string' },
      json: { type: 'boolean' },
      manual: { type: 'boolean' },
      network: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  })
  if (values.help) {
    console.log(`Usage: pnpm pair [code | devices | approve <request-id> | deny <request-id>]
  --connection <file>       Select a runtime-connection.json file
  --public-address <url>    Address to display for the phone (does not change runtime binding)
  --network <name>         Choose local, tailscale or netbird address
  --manual                 Require approval for a single-use code
  --json                   Print machine-readable results

Codes expire after two minutes and automatically approve devices using them.
With --manual, approve a request with pnpm pair approve <id>.
Bind the runtime with DOVO_HOST=0.0.0.0, a local IP, local, tailscale or netbird.
Device listings show paired devices, not live network presence.`)
    return
  }
  const [command = 'code', id, ...extra] = positionals
  if (
    !['code', 'devices', 'approve', 'deny'].includes(command) ||
    extra.length ||
    (['approve', 'deny'].includes(command) ? !id : !!id)
  )
    throw new Error('Invalid command. Run pnpm pair --help.')
  const publicAddress = values['public-address'] ? new URL(values['public-address']) : undefined
  if (
    publicAddress &&
    (!['http:', 'https:'].includes(publicAddress.protocol) ||
      publicAddress.username ||
      publicAddress.password ||
      publicAddress.search ||
      publicAddress.hash ||
      publicAddress.pathname !== '/' ||
      ['0.0.0.0', '[::]'].includes(publicAddress.hostname))
  )
    throw new Error('Public address must be an HTTP(S) origin, including the runtime port.')
  const candidates = values.connection ? [values.connection] : connectionPaths()
  const live: Array<{
    path: string
    connection: LocalConnection
    snapshot: ReturnType<typeof snapshotSchema.parse>
  }> = []
  const failures: string[] = []
  for (const path of candidates) {
    try {
      const connection = readConnection(path)
      const snapshot = snapshotSchema.parse(await call(connection, '/api/snapshot'))
      if (!snapshot.owner) throw new Error('Owner credentials required to manage pairing')
      live.push({ path, connection, snapshot })
    } catch (error) {
      failures.push(`${path}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (!live.length)
    throw new Error(
      `No accessible local runtime. Start or restart Dovo Studio, or pass --connection <file>.${failures.length ? '\n' + failures.join('\n') : ''}`,
    )
  if (live.length > 1)
    throw new Error(
      `Multiple runtimes are running. Select one with --connection:\n${live.map((entry) => entry.path).join('\n')}`,
    )
  const { connection, snapshot } = live[0]
  if (command === 'code') {
    if (values.network && !['local', 'tailscale', 'netbird'].includes(values.network))
      throw new Error('Network must be local, tailscale or netbird.')
    const addresses = networkUrls(
      connection.bindHost ?? new URL(connection.address).hostname,
      new URL(connection.address).port,
      await discoverNetworks(),
    )
    const choices = values.network
      ? addresses.filter((entry) => entry.network === values.network)
      : addresses
    if (values.network && !publicAddress && choices.length !== 1)
      throw new Error(
        choices.length
          ? 'Multiple matching addresses. Choose one with --public-address.'
          : `Runtime does not listen on ${values.network}. Start it with DOVO_HOST=0.0.0.0 or DOVO_HOST=${values.network}.`,
      )

    const result = {
      address: publicAddress?.origin ?? choices[0]?.address ?? connection.address,
      addresses,
      bindHost: connection.bindHost,
      autoApprove: !values.manual,
      ...responses.pairCode.parse(
        await call(connection, '/api/pair/code', { autoApprove: !values.manual }),
      ),
    }
    if (values.json) console.log(JSON.stringify(result))
    else {
      console.log(
        `Runtime: ${result.address}\nPairing code: ${result.code}\nExpires: ${result.expiresAt}\n${addresses.map((entry) => `${entry.name}: ${entry.address}`).join('\n')}\n\nEnter these in the phone's Devices & runtime settings.\n${values.manual ? 'Then run pnpm pair devices and pnpm pair approve <request-id>.' : 'Devices using this code are approved automatically until it expires.'}`,
      )
      if (['localhost', '127.0.0.1', '[::1]'].includes(new URL(result.address).hostname))
        console.log(
          'This is a loopback address. For your phone, bind the runtime to a reachable interface with DOVO_HOST and use --public-address for its private hostname.',
        )
    }
  } else if (command === 'devices') {
    const result = {
      pending: snapshot.pendingDevices,
      paired: snapshot.devices.filter((device) => !device.revokedAt),
    }
    if (values.json) console.log(JSON.stringify(result))
    else
      console.log(
        `Pending requests:\n${result.pending.map((device) => `${device.id}  ${device.name}  expires ${device.expiresAt}`).join('\n') || 'None'}\n\nPaired devices:\n${result.paired.map((device) => `${device.id}  ${device.name}`).join('\n') || 'None'}`,
      )
  } else {
    responses.ok.parse(
      await call(connection, '/api/pair/approve', { id, allow: command === 'approve' }),
    )
    console.log(
      values.json
        ? JSON.stringify({ id, status: command === 'approve' ? 'approved' : 'denied' })
        : `Request ${id} ${command === 'approve' ? 'approved' : 'denied'}.`,
    )
  }
}
async function call(connection: LocalConnection, path: string, body?: unknown): Promise<unknown> {
  const response = await fetch(connection.address + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${connection.token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
    redirect: 'error',
  })
  if (!response.ok)
    throw new Error(`Runtime returned HTTP ${response.status}: ${await response.text()}`)
  return response.json()
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
