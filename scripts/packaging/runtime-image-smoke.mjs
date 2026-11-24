// Check a built runtime image at its real boundaries: native modules on the image's OS, the
// published HTTP port, the health check, CLI pairing, and device credentials that survive a new
// container on the same volume. Usage: node scripts/packaging/runtime-image-smoke.mjs <image> [previous-image]
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'
import { runtimeSmoke } from './runtime-smoke.mjs'

const [image, previousImage] = process.argv.slice(2)
if (!image)
  throw new Error('Usage: node scripts/packaging/runtime-image-smoke.mjs <image> [previous-image]')
const name = `dovo-image-smoke-${process.pid}`
const publicAddress = 'http://dovo-smoke.invalid:51464'
// Matches PAIRING_PROTOCOL_VERSION in @dovo/protocol. A mismatch fails with HTTP 426.
const pairingProtocol = 2

function docker(...args) {
  try {
    return execFileSync('docker', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
      timeout: 120_000,
    }).trim()
  } catch (error) {
    // Keep the long inline smoke script out of the failure message.
    throw new Error(`docker ${args[0]} failed: ${error.status ?? error.signal ?? error.message}`)
  }
}

async function call(origin, path, body, token, method = body ? 'POST' : 'GET') {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status} ${await response.text()}`)
  return response.json()
}

async function start(runtimeImage) {
  docker(
    'run',
    '--pull=never',
    '--detach',
    '--name',
    name,
    '--env',
    `DOVO_PUBLIC_ADDRESS=${publicAddress}`,
    '--publish',
    '127.0.0.1::51464',
    '--volume',
    `${name}:/home/node`,
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges:true',
    runtimeImage,
  )
  const origin = `http://${docker('port', name, '51464/tcp').split('\n')[0]}`
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    const state = JSON.parse(docker('inspect', '--format', '{{json .State}}', name))
    if (!state.Running) throw new Error(`Container exited with code ${state.ExitCode}`)
    if (state.Health?.Status === 'healthy') {
      const health = await call(origin, '/health')
      if (health.service !== 'dovo-runtime') throw new Error('Unexpected /health response')
      return origin
    }
    await sleep(1000)
  }
  throw new Error('Container did not become healthy within two minutes')
}

const imageId = docker('image', 'inspect', '--format', '{{.Id}}', image)
const previousId = previousImage
  ? docker('image', 'inspect', '--format', '{{.Id}}', previousImage)
  : undefined
if (previousId === imageId) throw new Error('Upgrade smoke needs a different previous image')

try {
  // Native SQLite, PTY, ONNX and esbuild from the archive, on the image's libraries.
  docker(
    'run',
    '--rm',
    '--pull=never',
    '--entrypoint',
    '/opt/dovo-server/libexec/node',
    '--workdir',
    '/opt/dovo-server/libexec/server',
    imageId,
    '--input-type=module',
    '--eval',
    runtimeSmoke,
  )
  for (const tool of [
    ['git', '--version'],
    ['ssh', '-V'],
  ])
    docker('run', '--rm', '--pull=never', '--entrypoint', tool[0], imageId, tool[1])
  let origin = await start(previousId ?? imageId)
  const pair = JSON.parse(docker('exec', name, 'dovo-server', 'pair', '--json'))
  if (pair.address !== publicAddress) throw new Error(`Pairing showed ${pair.address}`)
  const request = await call(origin, '/api/pair/request', {
    protocolVersion: pairingProtocol,
    code: pair.code,
    name: 'Image smoke test',
  })
  const claim = await call(origin, '/api/pair/claim', { id: request.id, secret: request.secret })
  if (claim.status !== 'approved' || !claim.token) throw new Error('Pairing was not approved')
  await call(origin, '/api/pair/confirm', { id: request.id, secret: request.secret })
  const before = await call(origin, '/api/snapshot', undefined, claim.token)
  const draft = {
    id: randomUUID(),
    repositoryId: before.workspace.repositories.find(({ kind }) => kind === 'scratch')?.id,
    title: 'Container smoke draft',
    agentId: '',
    status: 'draft',
    createdAt: new Date().toISOString(),
    messages: [],
    files: [],
    draft: 'Keep this draft across runtime replacements.',
    example: false,
  }
  assert.ok(draft.repositoryId, 'Expected a scratch project for the smoke draft')
  await call(
    origin,
    '/api/workspace',
    { collection: 'tasks', id: draft.id, create: draft, changes: {} },
    claim.token,
    'PATCH',
  )
  await requireDraft(origin)

  // A restart or upgrade replaces the container while retaining its named volume.
  docker('stop', name)
  docker('rm', name)
  origin = await start(imageId)
  await requireDraft(origin)
  console.log(
    `${image}: health, pairing and saved draft persisted across ${previousId ? `upgrade from ${previousImage}` : 'same-image restart'}`,
  )

  async function requireDraft(address) {
    const snapshot = await call(address, '/api/snapshot', undefined, claim.token)
    const restored = snapshot.workspace.tasks.filter(({ id }) => id === draft.id)
    assert.equal(restored.length, 1, 'Expected the original draft exactly once')
    assert.equal(restored[0].draft, draft.draft, 'Expected the original saved draft text')
  }
} catch (error) {
  try {
    console.error(docker('logs', '--tail', '100', name))
  } catch {
    // The container may not exist yet.
  }
  throw error
} finally {
  for (const args of [
    ['rm', '--force', name],
    ['volume', 'rm', '--force', name],
  ])
    spawnSync('docker', args, { stdio: 'ignore' })
}
