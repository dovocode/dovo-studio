import { pairingQr } from './pairing-qr.js'
import { Schema } from 'effect'
import { decode, AccountClient, ACCOUNT_DIRECTORY_URL } from '@dovo/protocol'
import { discoverNetworks, networkUrls } from './network.js'
import { parseArgs } from 'node:util'
import { responses, snapshotSchema } from '@dovo/protocol'
import { connectionPaths, readConnection, type LocalConnection } from './connection.js'
async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      connection: {
        type: 'string',
      },
      'public-address': {
        type: 'string',
      },
      json: {
        type: 'boolean',
      },
      manual: {
        type: 'boolean',
      },
      network: {
        type: 'string',
      },
      help: {
        type: 'boolean',
        short: 'h',
      },
    },
  })
  if (values.help) {
    console.log(`Usage: pnpm pair [code | devices | internet on|off|status | relay-key | approve <request-id> | deny <request-id>]
  --connection <file>       Select a runtime-connection.json file
  --public-address <url>    Address to display for the phone (does not change runtime binding)
  --network <name>         Choose local, tailscale or netbird address
  --manual                 Require approval for a single-use code
  --json                   Print machine-readable results

Codes expire after two minutes and automatically approve one device. Each code is single-use.
With --manual, approve a request with pnpm pair approve <id>.
Bind the runtime with DOVO_HOST=0.0.0.0, a local IP, local, tailscale or netbird.
Use internet on to sign in and enable account-authorized Dovo Connect,
internet off to disable it, or internet status to inspect it. LAN/VPN pairing stays separate.
Device listings include internet upgrade requests from already paired phones.
Approve or deny these with the same approve/deny commands.
Use relay-key to show the public installation key for optional operator-approved relay access.
Device listings show paired devices, not live network presence.`)
    return
  }
  const [command = 'code', id, ...extra] = positionals
  if (
    !['code', 'devices', 'internet', 'relay-key', 'approve', 'deny'].includes(command) ||
    extra.length ||
    (command === 'internet'
      ? !['on', 'off', 'status'].includes(id ?? 'status')
      : ['approve', 'deny'].includes(command)
        ? !id
        : !!id)
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
    snapshot: Schema.Schema.Type<typeof snapshotSchema>
  }> = []
  const failures: string[] = []
  for (const path of candidates) {
    try {
      const connection = readConnection(path)
      const snapshot = decode(snapshotSchema, await call(connection, '/api/snapshot'))
      if (!snapshot.owner) throw new Error('Owner credentials required to manage pairing')
      live.push({
        path,
        connection,
        snapshot,
      })
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
  if (command === 'internet') {
    if (!snapshot.internet) throw new Error('Update this runtime to manage Dovo Connect.')
    if (id === 'off') {
      const status = decode(
        responses.internetStatus,
        await call(connection, '/api/runtime/internet', { enabled: false }),
      )
      console.log(
        values.json
          ? JSON.stringify(status)
          : 'Dovo Connect disabled. Separate LAN/VPN pairings are preserved.',
      )
    } else if (id === 'on' && !snapshot.internet.enabled) {
      const client = new AccountClient(
        { read: async () => null, write: async () => {} },
        async (url) => {
          console.log(
            `Sign in to enable Dovo Connect on this server:\n${url}\nConfirm code ${client.snapshot().login?.code} in your browser.`,
          )
        },
        process.env.DOVO_CONNECT_ORIGIN ?? ACCOUNT_DIRECTORY_URL,
      )
      await client.signIn()
      if (!client.snapshot().directory)
        throw new Error(client.snapshot().error || 'Sign-in was not completed.')
      await client.enableInternet((accountToken) =>
        call(connection, '/api/runtime/internet', { enabled: true, accountToken }),
      )
      console.log(
        values.json
          ? JSON.stringify({ enabled: true })
          : 'Dovo Connect enabled. Sign in to the same account on your phone and choose this computer. No pairing code is needed.',
      )
    } else
      console.log(
        values.json
          ? JSON.stringify(snapshot.internet)
          : `Dovo Connect: ${snapshot.internet.enabled ? (snapshot.internet.connected ? 'online' : 'enabled, connecting') : 'disabled'}${snapshot.internet.error ? '\n' + snapshot.internet.error : ''}`,
      )
  } else if (command === 'code') {
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
      ...decode(
        responses.pairCode,
        await call(connection, '/api/pair/code', {
          autoApprove: !values.manual,
        }),
      ),
    }
    if (values.json) console.log(JSON.stringify(result))
    else {
      console.log(
        `Runtime: ${result.address}\nPairing code: ${result.code}\nExpires: ${result.expiresAt}\n${addresses.map((entry) => `${entry.name}: ${entry.address}`).join('\n')}\n\nIn the mobile app, choose Scan pairing QR code or enter the address and code.\n${values.manual ? 'Then run pnpm pair devices and pnpm pair approve <request-id>.' : 'This single-use code automatically approves one device.'}`,
      )
      if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(result.address).hostname)) {
        try {
          const qr = await pairingQr(result)
          console.log(
            `\nScan this code in Dovo on your phone:\n${qr.terminal}\nPairing link: ${qr.url}`,
          )
        } catch (error) {
          console.log(
            `QR unavailable: ${error instanceof Error ? error.message : String(error)}. Enter the address and code above instead.`,
          )
        }
      }
      if (['localhost', '127.0.0.1', '[::1]'].includes(new URL(result.address).hostname))
        console.log(
          'This is a loopback address. For your phone, bind the runtime to a reachable interface with DOVO_HOST and use --public-address for its private hostname.',
        )
    }
  } else if (command === 'relay-key') {
    const identity = decode(
      responses.peerRelayIdentity,
      await call(connection, '/api/runtime/peer/identity', {}),
    )
    console.log(
      values.json
        ? JSON.stringify(identity)
        : `Public relay approval key: ${identity.publicKey}\nShare this public key with the Dovo operator to request relay access. It grants no access to this server.`,
    )
  } else if (command === 'devices') {
    const result = {
      pending: snapshot.pendingDevices,
      internet: snapshot.pendingPeerUpgrades ?? [],
      paired: snapshot.devices.filter((device) => !device.revokedAt),
    }
    if (values.json) console.log(JSON.stringify(result))
    else
      console.log(
        `Pending requests:\n${result.pending.map((device) => `${device.id}  ${device.name}  expires ${device.expiresAt}`).join('\n') || 'None'}\n\nInternet access requests:\n${result.internet.map((request) => `${request.id}  ${request.name}  ${request.relay === 'custom' ? 'Computer / organization relay fallback (encrypted)' : request.relay === 'dovo' ? 'Dovo relay fallback (encrypted)' : 'Direct only'}  expires ${request.expiresAt}`).join('\n') || 'None'}\n\nPaired devices:\n${result.paired.map((device) => `${device.id}  ${device.name}`).join('\n') || 'None'}`,
      )
  } else {
    decode(
      responses.ok,
      await call(
        connection,
        snapshot.pendingPeerUpgrades?.some((request) => request.id === id)
          ? '/api/runtime/peer/upgrade/approve'
          : '/api/pair/approve',
        {
          id,
          allow: command === 'approve',
        },
      ),
    )
    console.log(
      values.json
        ? JSON.stringify({
            id,
            status: command === 'approve' ? 'approved' : 'denied',
          })
        : `Request ${id} ${command === 'approve' ? 'approved' : 'denied'}.`,
    )
  }
}
async function call(connection: LocalConnection, path: string, body?: unknown): Promise<unknown> {
  const response = await fetch(connection.address + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Authorization: `Bearer ${connection.token}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(path === '/api/runtime/internet' ? 15000 : 5000),
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
