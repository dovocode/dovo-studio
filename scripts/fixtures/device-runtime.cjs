// Isolated runtime fixtures shared by desktop and mobile multi-device verification.
const { spawn, execFileSync } = require('node:child_process')
const { mkdirSync } = require('node:fs')
const { readFile } = require('node:fs/promises')
const { join, resolve } = require('node:path')

async function request(connection, path, body, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(connection.address + path, {
    method,
    headers: {
      Authorization: `Bearer ${connection.token}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
    redirect: 'error',
  })
  const value = await response.json()
  if (!response.ok) throw new Error(`${path}: ${response.status} ${JSON.stringify(value)}`)
  return value
}

async function seedDeviceRuntime(connection, { directory, repository, title }) {
  const checkout = join(directory, repository)
  mkdirSync(checkout, { recursive: true })
  execFileSync('git', ['init', '-q', checkout])
  execFileSync('git', [
    '-C',
    checkout,
    '-c',
    'user.name=Dovo Test',
    '-c',
    'user.email=test@example.invalid',
    'commit',
    '--allow-empty',
    '-qm',
    'Device fixture',
  ])
  const config = await request(connection, '/api/commands/read', {})
  await request(connection, '/api/commands/save', {
    ...config.settings,
    gh: resolve(__dirname, 'github.cjs'),
    codex: resolve(__dirname, 'codex.cjs'),
  })
  // Desktop seeds an example project on first launch. Keep every fixture read isolated.
  const snapshot = await request(connection, '/api/snapshot')
  for (const existing of snapshot.workspace.repositories)
    await request(
      connection,
      '/api/workspace',
      {
        collection: 'repositories',
        id: existing.id,
        changes: { path: { before: existing.path, after: checkout } },
      },
      'PATCH',
    )
  const entities = {
    agents: {
      id: 'shared-agent',
      name: 'Device fixture agent',
      provider: 'codex',
      model: '',
      instructions: '',
      permission: 'ask',
      endpoint: '',
    },
    repositories: {
      id: 'shared-repo',
      name: `${repository} project`,
      path: checkout,
      branch: 'main',
    },
    tasks: {
      id: 'shared-task',
      title,
      repositoryId: 'shared-repo',
      agentId: 'shared-agent',
      execution: 'main',
      status: 'draft',
      createdAt: new Date().toISOString(),
      messages: [],
      files: [],
      draft: '',
      example: false,
    },
  }
  for (const [collection, create] of Object.entries(entities))
    await request(
      connection,
      '/api/workspace',
      { collection, id: create.id, changes: {}, create },
      'PATCH',
    )
  return { checkout, taskId: entities.tasks.id }
}

async function startDeviceRuntime(options) {
  mkdirSync(options.directory, { recursive: true })
  const child = spawn(
    process.env.DOVO_NODE_PATH ?? 'node',
    [resolve(__dirname, '../../apps/api/dist/index.js')],
    {
      env: {
        ...process.env,
        DOVO_DATABASE_PATH: join(options.directory, 'runtime.sqlite'),
        DOVO_HOST: '127.0.0.1',
        PORT: '0',
        ELECTRON_RUN_AS_NODE: undefined,
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    },
  )
  let diagnostics = ''
  child.stderr.on('data', (chunk) => {
    diagnostics = (diagnostics + String(chunk)).slice(-4000)
  })
  const exited = new Promise((resolveExit) => child.once('exit', resolveExit))
  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return
    const timeout = setTimeout(() => child.kill('SIGKILL'), 10000)
    child.kill('SIGTERM')
    await exited
    clearTimeout(timeout)
  }
  try {
    await new Promise((resolveReady, reject) => {
      const timeout = setTimeout(() => reject(new Error('Device fixture startup timed out')), 15000)
      child.once('message', () => {
        clearTimeout(timeout)
        resolveReady()
      })
      child.once('error', (error) => {
        clearTimeout(timeout)
        reject(error)
      })
      child.once('exit', () => {
        clearTimeout(timeout)
        reject(new Error(`Device fixture exited before ready: ${diagnostics}`))
      })
    })
    const connection = JSON.parse(
      await readFile(join(options.directory, 'runtime-connection.json'), 'utf8'),
    )
    await seedDeviceRuntime(connection, options)
    const pairing = await request(connection, '/api/pair/code', { autoApprove: true })
    return { connection, pairing, stop, request: (...args) => request(connection, ...args) }
  } catch (error) {
    await stop()
    throw error
  }
}

module.exports = { startDeviceRuntime, seedDeviceRuntime, request }
