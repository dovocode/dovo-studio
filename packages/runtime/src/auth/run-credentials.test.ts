import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { taskToolsServer } from '../agent-tools/config.js'
import { WebSocket } from 'ws'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import { Schema } from 'effect'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { randomUUID } from 'node:crypto'
import { readFileSync, statSync, existsSync } from 'node:fs'
import { decode, taskSchema, artifactWriteResponseSchema } from '@dovo/protocol'
import { startRuntime } from '../index.js'
import { RunCredentials, type RunPolicy } from './run-credentials.js'
import { authorizeRunTerminal } from './run-authorization.js'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
async function setup(overrides: Partial<RunPolicy> = {}) {
  const runtime = await startRuntime({
    databasePath: ':memory:',
    ownerToken: 'human-owner-test-token',
    port: 0,
  })
  const s = runtime.services
  cleanups.push(async () => {
    s.runCredentials.dispose()
    await runtime.close()
  })
  const taskId = randomUUID(),
    otherId = randomUUID(),
    runId = randomUUID()
  s.store.update((workspace) => ({
    ...workspace,
    tasks: [taskId, otherId].map((id) =>
      decode(taskSchema, {
        id,
        title: 'Credential test',
        repositoryId: '',
        agentId: '',
        status: 'running',
        activeRunId: id === taskId ? runId : randomUUID(),
        createdAt: new Date().toISOString(),
        messages: [],
        files: [],
        draft: '',
        example: false,
      }),
    ),
  }))
  s.preferences.save({ enableArtifacts: true })
  s.memory.configure({ scope: 'system', enabled: true })
  const policy: RunPolicy = {
    permissions: { provider: 'codex', permission: 'ask' },
    taskId,
    runId,
    readOnly: false,
    artifacts: true,
    pipelineWatching: true,
    pullRequestWatching: true,
    deviceHub: true,
    memoryScopes: ['system'],
    ...overrides,
  }
  const controller = new AbortController()
  const token = s.runCredentials.issue(policy, controller.signal)
  const post = (path: string, input: unknown, credential = token) =>
    fetch(`http://127.0.0.1:${runtime.port}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
  return { s, runtime, taskId, otherId, runId, policy, token, controller, post }
}

it('allows task artifact and enabled memory tools over raw HTTP, preserving human authentication', async () => {
  const { s, taskId, runId, otherId, post } = await setup()
  const created = await post('/api/artifacts/create', {
    taskId,
    parentRunId: runId,
    title: 'Report',
    format: 'markdown',
    content: 'Allowed',
  })
  expect(created.status).toBe(200)
  const { artifact } = decode(artifactWriteResponseSchema, await created.json())
  expect((await post('/api/artifacts/read', { taskId, id: artifact.id })).status).toBe(200)
  expect((await post('/api/artifacts/read', { taskId: otherId, id: artifact.id })).status).toBe(403)
  const foreign = s.artifacts.write({
    taskId: otherId,
    title: 'Other report',
    format: 'markdown',
    content: 'Private',
  })
  expect((await post('/api/artifacts/read', { taskId, id: foreign.id })).status).toBe(404)
  expect(
    (
      await post('/api/memory/agent/write', {
        taskId,
        scope: 'system',
        key: 'test',
        content: 'Allowed',
      })
    ).status,
  ).toBe(200)
  expect(
    (await post('/api/memory/agent/read', { taskId, scope: 'system', key: 'test' })).status,
  ).toBe(200)
  expect((await post('/api/memory/agent/list', { taskId, scope: 'projectless' })).status).toBe(403)
  expect((await post('/api/artifacts/list', { taskId }, 'human-owner-test-token')).status).toBe(200)
  s.devices.add('Human device', 'human-device-test-token')
  expect((await post('/api/artifacts/list', { taskId }, 'human-device-test-token')).status).toBe(
    200,
  )
})

it('denies admin, trust, unrelated tasks and forged or missing run ownership before dispatch', async () => {
  const { taskId, otherId, runId, post } = await setup()
  for (const path of [
    '/api/pair/request',
    '/api/pair/claim',
    '/api/pair/confirm',
    '/api/pair/cancel',
    '/api/pair',
    '/api/devices/revoke',
    '/api/runtime/preferences/save',
    '/api/runtime/backup',
    '/api/workspace',
    '/api/agents/settings/save',
    '/api/device-hosts',
    '/api/device-host/action',
    '/api/memory/settings/save',
    '/api/artifacts/library',
    '/api/mcp-apps/proxy',
    '/api/tasks/message',
  ])
    expect((await post(path, { taskId })).status).toBe(403)
  expect((await post('/api/artifacts/list', { taskId: otherId })).status).toBe(403)
  for (const parentRunId of [undefined, 'forged'])
    expect((await post('/api/subagents/spawn', { taskId, parentRunId })).status).toBe(403)
  expect(
    (await post('/api/subagents/read', { taskId, parentRunId: runId, id: otherId })).status,
  ).toBe(403)
})

it('allows read-only browser/device reads and cleanup but blocks mutations and terminal escape', async () => {
  const { s, taskId, runId, post } = await setup({ readOnly: true })
  const browser = vi.spyOn(s.browsers, 'agentCommand').mockResolvedValue({ ok: true })
  const devices = vi
    .spyOn(s.deviceHosts, 'list')
    .mockResolvedValue({ host: 'test', devices: [], diagnostics: [] })
  const action = vi.spyOn(s.deviceHosts, 'action').mockResolvedValue({ ok: true })
  for (const action of ['snapshot', 'close'])
    expect(
      (await post('/api/previews/browser/agent', { taskId, command: { action } })).status,
    ).toBe(200)
  expect((await post('/api/previews/devices', { taskId })).status).toBe(200)
  expect(devices).toHaveBeenCalledWith(taskId, undefined, true)
  for (const name of ['screenshot', 'apps', 'capabilities'])
    expect(
      (await post('/api/previews/action', { taskId, id: 'ios:test', action: name })).status,
    ).toBe(200)
  expect(action).toHaveBeenCalledWith(
    expect.objectContaining({ taskId }),
    true,
    expect.any(AbortSignal),
    expect.any(Function),
  )
  expect((await post('/api/artifacts/list', { taskId })).status).toBe(200)
  expect((await post('/api/memory/agent/list', { taskId, scope: 'system' })).status).toBe(200)
  for (const [path, input] of [
    ['/api/previews/browser/agent', { command: { action: 'evaluate', script: '1' } }],
    ['/api/previews/action', { id: 'ios:test', action: 'launch' }],
    ['/api/previews/action', { id: 'ios:test', action: 'stop', bundleId: 'com.example' }],
    ['/api/previews/action', { id: 'ios:test', action: 'uninstall', bundleId: 'com.example' }],
    ['/api/previews/action', { id: 'ios:test', action: 'deep-link', url: 'example://test' }],
    ['/api/previews/simulator/open', { id: 'ios:test' }],
    ['/api/device-hosts/install', { id: 'ios:test', artifactPath: '/tmp/app' }],
    ['/api/device-hosts/forward', {}],
    ['/api/device-hosts/forward/stop', {}],
    ['/api/artifacts/create', {}],
    ['/api/artifacts/update', {}],
    ['/api/memory/agent/write', { scope: 'system' }],
    ['/api/memory/agent/delete', { scope: 'system' }],
    ['/api/pipeline-watch', { action: 'watch' }],
    ['/api/pull-request-watch', { action: 'watch' }],
    ['/api/terminals/run', { command: 'pwd', newTerminal: true }],
  ] satisfies Array<[string, Record<string, unknown>]>)
    expect((await post(path, { ...input, taskId, parentRunId: runId })).status).toBe(403)
  expect(browser).toHaveBeenCalledTimes(2)
})

it('enforces feature flags and explicit native sandbox against raw HTTP', async () => {
  const { taskId, runId, post } = await setup({
    artifacts: false,
    pipelineWatching: false,
    pullRequestWatching: false,
    deviceHub: false,
    memoryScopes: [],
    sandboxMode: 'workspace-write',
  })
  for (const path of [
    '/api/artifacts/list',
    '/api/memory/agent/list',
    '/api/pipeline-watch',
    '/api/pull-request-watch',
    '/api/previews/devices',
    '/api/device-hosts/install',
    '/api/terminals/run',
  ])
    expect(
      (await post(path, { taskId, parentRunId: runId, scope: 'system', newTerminal: true })).status,
    ).toBe(403)
})

it('revokes expired, cancelled, replaced and stale-run grants and rotates private files for warm transports', async () => {
  const { s, taskId, policy, token, controller, post } = await setup()
  const file = s.runCredentials.file(token)
  expect(statSync(file).mode & 0o777).toBe(0o600)
  expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ token, runId: policy.runId })
  const next = s.runCredentials.issue(policy, controller.signal)
  expect(s.runCredentials.file(next)).toBe(file)
  expect((await post('/api/artifacts/list', { taskId }, token)).status).toBe(401)
  s.runCredentials.revoke(token)
  expect(existsSync(file)).toBe(true)
  expect((await post('/api/artifacts/list', { taskId }, next)).status).toBe(200)
  controller.abort()
  expect((await post('/api/artifacts/list', { taskId }, next)).status).toBe(401)
  const fresh = s.runCredentials.issue(policy, new AbortController().signal)
  s.store.updateTask(taskId, (task) => ({ ...task, activeRunId: randomUUID() }))
  expect((await post('/api/artifacts/list', { taskId }, fresh)).status).toBe(401)
  s.store.updateTask(taskId, (task) => ({ ...task, activeRunId: policy.runId }))
  s.runCredentials.revoke(fresh)
  expect((await post('/api/artifacts/list', { taskId }, fresh)).status).toBe(401)
  const expired = s.runCredentials.issue(policy, new AbortController().signal, -1)
  expect((await post('/api/artifacts/list', { taskId }, expired)).status).toBe(401)
  // Expiry uses a deadline, not a refresh interval.
  let now = 0
  const credentials = new RunCredentials(s.store, () => now)
  cleanups.push(async () => credentials.dispose())
  const timed = credentials.issue(policy, new AbortController().signal, 10)
  expect(credentials.authenticate(timed).taskId).toBe(taskId)
  now = 10
  expect(() => credentials.authenticate(timed)).toThrow('expired or revoked')
})

it('denies guessed terminal IDs even in the same task', async () => {
  const { s, token, post } = await setup()
  expect(() => authorizeRunTerminal(s, token, 'user-terminal')).toThrow('outside')
  expect((await post('/api/terminals/ticket', { id: 'user-terminal' })).status).toBe(403)
  expect((await post('/api/terminals/close', { id: 'other-task-terminal' })).status).toBe(403)
})

it('dispatches enabled watcher and writable device tools with agent host restrictions', async () => {
  const { s, taskId, runId, post } = await setup()
  const pipeline = vi.spyOn(s.pipelineWatch, 'command').mockResolvedValue({ watches: [] })
  const pull = vi.spyOn(s.pullRequestWatch, 'command').mockResolvedValue({ watches: [] })
  s.deviceHosts.settings.save({ enabled: true, hosts: [] })
  vi.spyOn(s.checkouts, 'directory').mockResolvedValue('/tmp')
  const install = vi.spyOn(s.deviceHosts, 'install').mockResolvedValue({ ok: true })
  const forward = vi.spyOn(s.deviceHosts, 'forward').mockResolvedValue({
    ok: true,
    id: randomUUID(),
    url: 'http://localhost:3000',
    expiresAt: new Date().toISOString(),
  })
  const stop = vi.spyOn(s.deviceHosts, 'stopForward').mockResolvedValue({ ok: true })
  expect(
    (
      await post('/api/device-hosts/forward', {
        taskId,
        hostId: 'host',
        localPort: 3000,
        remotePort: 3000,
        exposeToNetwork: true,
      })
    ).status,
  ).toBe(403)
  expect(
    (await post('/api/pipeline-watch', { taskId, parentRunId: runId, action: 'status' })).status,
  ).toBe(200)
  expect(
    (await post('/api/pull-request-watch', { taskId, parentRunId: runId, action: 'status' }))
      .status,
  ).toBe(200)
  expect(pipeline).toHaveBeenCalledWith({ taskId, parentRunId: runId, action: 'status' })
  expect(pull).toHaveBeenCalledWith({ taskId, parentRunId: runId, action: 'status' })
  expect(
    (await post('/api/device-hosts/install', { taskId, id: 'ios:test', artifactPath: '/tmp/app' }))
      .status,
  ).toBe(200)
  expect(install).toHaveBeenCalledWith(
    expect.objectContaining({ taskId }),
    '/tmp',
    true,
    expect.any(AbortSignal),
    expect.any(Function),
  )
  expect(
    (
      await post('/api/device-hosts/forward', {
        taskId,
        hostId: randomUUID(),
        localPort: 3000,
        remotePort: 3000,
      })
    ).status,
  ).toBe(200)
  expect(forward).toHaveBeenCalledWith(
    expect.objectContaining({ taskId }),
    true,
    expect.any(AbortSignal),
    expect.any(Function),
  )
  expect((await post('/api/device-hosts/forward/stop', { taskId, id: 'forward' })).status).toBe(200)
  expect(stop).toHaveBeenCalledWith('forward', taskId, true)
})

it.each(['revoke', 'abort', 'stale-run'] as const)(
  'rejects installation after delayed checkout when the grant becomes %s',
  async (mode) => {
    const { s, taskId, token, controller, post } = await setup()
    s.deviceHosts.settings.save({ enabled: true, hosts: [] })
    const entered = deferred<void>()
    const checkout = deferred<string>()
    vi.spyOn(s.checkouts, 'directory').mockImplementation(() => {
      entered.resolve()
      return checkout.promise
    })
    const install = vi.spyOn(s.deviceHosts, 'install').mockResolvedValue({ ok: true })
    const pending = post('/api/device-hosts/install', {
      taskId,
      id: 'ios:test',
      artifactPath: 'app.app',
    })
    try {
      await entered.promise
      if (mode === 'revoke') s.runCredentials.revoke(token)
      else if (mode === 'abort') controller.abort()
      else s.store.updateTask(taskId, (task) => ({ ...task, activeRunId: randomUUID() }))
    } finally {
      checkout.resolve('/tmp')
    }
    expect((await pending).status).toBe(401)
    expect(install).not.toHaveBeenCalled()
  },
)

it.each([
  ['install', 'revoke'],
  ['install', 'abort'],
  ['forward', 'revoke'],
  ['forward', 'abort'],
] as const)('cancels an in-flight %s operation on run %s', async (operation, mode) => {
  const { s, taskId, token, controller, post } = await setup()
  const hostId = randomUUID()
  s.deviceHosts.settings.save({
    enabled: true,
    hosts: [
      {
        id: hostId,
        name: 'Mac',
        sshHost: 'mac.local',
        sshUser: 'developer',
        sshPort: 22,
        runtimeAddress: 'http://127.0.0.1:4317',
        token: 'paired-secret',
        agentAccess: true,
      },
    ],
  })
  vi.spyOn(s.checkouts, 'directory').mockResolvedValue('/tmp')
  const staging = await import('../previews/device-artifact-staging.js')
  const dispose = vi.fn<() => Promise<void>>(async () => {})
  vi.spyOn(staging, 'stageDeviceArtifact').mockResolvedValue({
    file: '/tmp/staged.apk',
    extension: '.apk',
    directory: false,
    dispose,
  })
  const ssh = await import('../previews/device-host-ssh.js')
  const copy = vi.spyOn(ssh, 'copyArtifact').mockResolvedValue()
  const start = vi.spyOn(ssh, 'startSsh')
  const entered = deferred<AbortSignal>()
  const request = vi
    .spyOn(s.deviceHosts.client, 'request')
    .mockImplementation(async (_host, _path, _input, signal, authorize) => {
      authorize?.()
      if (!signal) throw new Error('Missing operation cancellation signal')
      entered.resolve(signal)
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    })
  const pending = post(
    `/api/device-hosts/${operation}`,
    operation === 'install'
      ? { taskId, id: `remote:${hostId}:android:test`, artifactPath: 'app.apk' }
      : { taskId, hostId, localPort: 3000, remotePort: 3000 },
  )
  const signal = await entered.promise
  expect(signal.aborted).toBe(false)
  if (mode === 'revoke') s.runCredentials.revoke(token)
  else controller.abort()
  expect(signal.aborted).toBe(true)
  expect((await pending).status).toBe(409)
  expect(request).toHaveBeenCalledOnce()
  expect(copy).not.toHaveBeenCalled()
  expect(start).not.toHaveBeenCalled()
  expect(dispose).toHaveBeenCalledTimes(operation === 'install' ? 1 : 0)
})

it('aborts retained grant signals on replacement, explicit revoke, expiry and disposal', async () => {
  const { s, policy } = await setup()
  vi.useFakeTimers()
  const credentials = new RunCredentials(s.store)
  try {
    const issue = () => credentials.issue(policy, new AbortController().signal, 1000)
    const first = credentials.authenticate(issue()).signal
    const secondToken = issue()
    expect(first.aborted).toBe(true)
    const second = credentials.authenticate(secondToken).signal
    credentials.revoke(secondToken)
    expect(second.aborted).toBe(true)
    const timedToken = issue()
    const timed = credentials.authenticate(timedToken).signal
    await vi.advanceTimersByTimeAsync(1000)
    expect(timed.aborted).toBe(true)
    expect(() => credentials.authenticate(timedToken)).toThrow('expired or revoked')
    const last = credentials.authenticate(issue())
    const clear = vi.spyOn(globalThis, 'clearTimeout')
    credentials.dispose()
    expect(last.signal.aborted).toBe(true)
    expect(clear).toHaveBeenCalledWith(last.expiryTimer)
    clear.mockRestore()
  } finally {
    credentials.dispose()
    vi.useRealTimers()
  }
})

it('preserves paired-device install and forward calls over HTTP', async () => {
  const { s, taskId, post } = await setup()
  const token = 'human-device-install-token'
  s.devices.add('Human device', token)
  s.deviceHosts.settings.save({ enabled: true, hosts: [] })
  vi.spyOn(s.checkouts, 'directory').mockResolvedValue('/tmp')
  const install = vi
    .spyOn(s.deviceHosts, 'install')
    .mockImplementation(async (_input, _directory, agent, signal, authorize) => {
      expect(agent).toBe(false)
      expect(signal?.aborted).toBe(false)
      authorize?.()
      return { ok: true }
    })
  const forward = vi
    .spyOn(s.deviceHosts, 'forward')
    .mockImplementation(async (_input, agent, signal, authorize) => {
      expect(agent).toBe(false)
      expect(signal?.aborted).toBe(false)
      authorize?.()
      return {
        ok: true as const,
        id: randomUUID(),
        url: 'http://localhost:3000' as const,
        expiresAt: new Date().toISOString(),
      }
    })
  expect(
    (
      await post(
        '/api/device-hosts/install',
        {
          taskId,
          id: 'ios:test',
          artifactPath: 'app.app',
        },
        token,
      )
    ).status,
  ).toBe(200)
  expect(
    (
      await post(
        '/api/device-hosts/forward',
        {
          taskId,
          hostId: randomUUID(),
          localPort: 3000,
          remotePort: 3000,
          exposeToNetwork: true,
        },
        token,
      )
    ).status,
  ).toBe(200)
  expect(install).toHaveBeenCalledOnce()
  expect(forward).toHaveBeenCalledOnce()
})

it('rechecks revoked credentials in delayed browser work', async () => {
  const { s, taskId, token, post } = await setup()
  vi.spyOn(s.browsers, 'agentCommand').mockImplementation(async (_task, _command, authorize) => {
    s.runCredentials.revoke(token)
    authorize?.()
    return { ok: true }
  })
  expect(
    (await post('/api/previews/browser/agent', { taskId, command: { action: 'snapshot' } })).status,
  ).toBe(401)
})

it('allows run-owned terminal tickets and input, then rejects revoked WebSocket input', async () => {
  const { s, runtime, taskId, token, controller, post } = await setup()
  s.store.update((workspace) => ({
    ...workspace,
    repositories: [{ id: 'repo', name: 'Test', path: tmpdir(), branch: 'main' }],
  }))
  s.store.updateTask(taskId, (task) => ({ ...task, repositoryId: 'repo' }))
  vi.spyOn(s.checkouts, 'selectedDirectory').mockResolvedValue(tmpdir())
  const opened = await post('/api/terminals/run', {
    taskId,
    command: 'echo scoped-terminal',
    newTerminal: true,
  })
  expect(opened.status).toBe(200)
  const terminal = decode(Schema.Struct({ id: Schema.String }), await opened.json())
  expect(() => authorizeRunTerminal(s, token, terminal.id)).not.toThrow()
  const ticketResponse = await post('/api/terminals/ticket', { id: terminal.id })
  expect(ticketResponse.status).toBe(200)
  const { ticket } = decode(Schema.Struct({ ticket: Schema.String }), await ticketResponse.json())
  const socket = new WebSocket(
    `ws://127.0.0.1:${runtime.port}/ws/terminal?ticket=${encodeURIComponent(ticket)}`,
  )
  await once(socket, 'open')
  const input = vi.spyOn(s.terminals, 'input')
  socket.send(JSON.stringify({ type: 'input', data: 'echo allowed\r' }))
  await vi.waitFor(() => expect(input).toHaveBeenCalledWith(terminal.id, 'echo allowed\r'))
  input.mockClear()
  const closed = once(socket, 'close')
  controller.abort()
  socket.send(JSON.stringify({ type: 'input', data: 'echo forbidden\r' }))
  await closed
  expect(input).not.toHaveBeenCalled()
  expect((await post('/api/terminals/ticket', { id: terminal.id })).status).toBe(401)
})

it('keeps a bounded native-child grant only for the originating live session', async () => {
  const { s, policy, taskId, token, post } = await setup()
  s.runCredentials.bind(token, 'native-session:test')
  s.runCredentials.nativeSession(token, 'session')
  s.store.updateTask(taskId, (task) => ({
    ...task,
    sessionId: 'session',
    subagents: [
      {
        id: 'native-child',
        provider: 'claude',
        name: 'Child',
        status: 'working',
        sessionLive: true,
        sessionId: 'session',
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
  }))
  s.runCredentials.retire(token)
  s.store.updateTask(taskId, (task) => ({ ...task, activeRunId: undefined }))
  expect((await post('/api/artifacts/list', { taskId })).status).toBe(200)
  expect(
    (
      await post('/api/artifacts/create', {
        taskId,
        parentRunId: 'native-session:test',
        title: 'Native result',
        format: 'markdown',
        content: 'Allowed',
      })
    ).status,
  ).toBe(200)
  s.store.updateTask(taskId, (task) => ({
    ...task,
    subagents: task.subagents?.map((agent) => ({ ...agent, completion: 'disposed' })),
  }))
  expect((await post('/api/artifacts/list', { taskId })).status).toBe(401)
  s.store.updateTask(taskId, (task) => ({
    ...task,
    subagents: task.subagents?.map((agent) => ({ ...agent, completion: undefined })),
  }))
  s.store.updateTask(taskId, (task) => ({ ...task, sessionId: 'different' }))
  expect((await post('/api/artifacts/list', { taskId })).status).toBe(401)
  s.store.updateTask(taskId, (task) => ({
    ...task,
    sessionId: 'session',
    activeRunId: randomUUID(),
  }))
  expect((await post('/api/artifacts/list', { taskId })).status).toBe(401)
  s.store.updateTask(taskId, (task) => ({
    ...task,
    activeRunId: undefined,
    subagents: task.subagents?.map((agent) => ({
      ...agent,
      status: 'completed',
      finishedAt: new Date().toISOString(),
    })),
  }))
  expect((await post('/api/artifacts/list', { taskId })).status).toBe(401)
  s.store.updateTask(taskId, (task) => ({ ...task, activeRunId: policy.runId }))
  const idle = s.runCredentials.issue(policy, new AbortController().signal)
  s.runCredentials.retire(idle)
  expect(() => s.runCredentials.authenticate(idle)).toThrow('expired or revoked')
})

it('resolves simulator session ownership before dispatching input', async () => {
  const { s, taskId, otherId, post } = await setup()
  vi.spyOn(s.simulators, 'taskId').mockReturnValue(otherId)
  const input = vi.spyOn(s.simulators, 'input').mockResolvedValue(undefined)
  expect(
    (
      await post('/api/previews/simulator/input', {
        taskId,
        id: 'preview',
        input: { type: 'text', text: 'test' },
      })
    ).status,
  ).toBe(403)
  expect(input).not.toHaveBeenCalled()
  vi.spyOn(s.simulators, 'taskId').mockReturnValue(taskId)
  vi.spyOn(s.simulators, 'authorizeDevice').mockResolvedValue(undefined)
  expect(
    (
      await post('/api/previews/simulator/input', {
        taskId,
        id: 'preview',
        input: { type: 'text', text: 'test' },
      })
    ).status,
  ).toBe(200)
  expect(input).toHaveBeenCalledWith(
    'preview',
    { type: 'text', text: 'test' },
    expect.any(Function),
    expect.any(AbortSignal),
  )
})

it('rotates run credentials through an already connected MCP transport', async () => {
  const { s, runtime, policy, taskId, token, post } = await setup()
  const file = s.runCredentials.file(token)
  const config = taskToolsServer(
    taskId,
    runtime.port,
    '',
    '127.0.0.1',
    false,
    true,
    policy.runId,
    false,
    false,
    [],
    false,
    undefined,
    file,
  )
  const client = new Client({ name: 'run-rotation-test', version: '1' })
  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args,
    env: config.envValues,
    stderr: 'ignore',
  })
  cleanups.push(() => client.close())
  await client.connect(transport)
  expect(
    (
      await client.callTool({
        name: 'artifact_create',
        arguments: {
          title: 'First run',
          format: 'markdown',
          content: 'one',
        },
      })
    ).isError,
  ).not.toBe(true)
  s.runCredentials.retire(token)
  expect(existsSync(file)).toBe(false)
  const runId = randomUUID()
  s.store.updateTask(taskId, (task) => ({ ...task, activeRunId: runId }))
  const next = s.runCredentials.issue({ ...policy, runId }, new AbortController().signal)
  expect(s.runCredentials.file(next)).toBe(file)
  expect(
    (
      await client.callTool({
        name: 'artifact_create',
        arguments: {
          title: 'Second run',
          format: 'markdown',
          content: 'two',
        },
      })
    ).isError,
  ).not.toBe(true)
  expect(s.artifacts.list(taskId)).toHaveLength(2)
  expect((await post('/api/artifacts/list', { taskId }, token)).status).toBe(401)
})

it.each(['abort', 'revoke'] as const)(
  'blocks remote device shutdown after %s during SSH acquisition',
  async (mode) => {
    const { s, taskId, token, controller, post } = await setup()
    const { createServer } = await import('node:http')
    const { ChildProcess } = await import('node:child_process')
    const requests: string[] = []
    const server = createServer((request, response) => {
      requests.push(request.url ?? '')
      response.end(JSON.stringify({ ok: true }))
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected TCP server')
    cleanups.push(
      () =>
        new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        ),
    )
    s.deviceHosts.settings.save({
      enabled: true,
      hosts: [
        {
          id: 'mac',
          name: 'Mac',
          sshHost: 'mac.local',
          sshUser: 'developer',
          sshPort: 22,
          runtimeAddress: 'http://127.0.0.1:4317',
          token: 'paired-secret',
          agentAccess: true,
        },
      ],
    })
    const entered = deferred<void>()
    const tunnel = deferred<Awaited<ReturnType<typeof s.deviceHosts.client.acquire>>>()
    vi.spyOn(s.deviceHosts.client, 'acquire').mockImplementation(() => {
      entered.resolve()
      return tunnel.promise
    })
    const release = vi.fn<() => void>()
    const pending = post('/api/previews/action', {
      taskId,
      id: 'remote:mac:ios:test',
      action: 'shutdown',
    })
    await entered.promise
    if (mode === 'abort') controller.abort()
    else s.runCredentials.revoke(token)
    tunnel.resolve({
      tunnel: {
        child: new ChildProcess(),
        port: address.port,
        address: `http://127.0.0.1:${address.port}`,
      },
      release,
    })
    expect((await pending).status).toBe(401)
    expect(requests).toEqual([])
    expect(release).toHaveBeenCalledOnce()
    // The same path remains usable by a paired human over HTTP.
    s.devices.add('Human', 'human-action-token')
    expect(
      (
        await post(
          '/api/previews/action',
          { taskId, id: 'remote:mac:ios:test', action: 'shutdown' },
          'human-action-token',
        )
      ).status,
    ).toBe(200)
    expect(requests).toEqual(['/api/device-host/action'])
  },
)

it.each(['abort', 'revoke'] as const)(
  'blocks simulator opening after %s during discovery',
  async (mode) => {
    const { s, taskId, token, controller, post } = await setup()
    s.deviceHosts.settings.save({ enabled: true, hosts: [] })
    const devices = await import('../previews/devices.js')
    const native = await import('../previews/simulator-native.js')
    const entered = deferred<void>()
    const discovery = deferred<Awaited<ReturnType<typeof devices.previewDevices>>>()
    vi.spyOn(devices, 'previewDevices').mockImplementation(() => {
      entered.resolve()
      return discovery.promise
    })
    const driver = vi.spyOn(native, 'iosSimulator').mockResolvedValue({
      start: () => () => {},
      input: async () => {},
      release: async () => {},
      close: async () => {},
    })
    const pending = post('/api/previews/simulator/open', { taskId, id: 'ios:test' })
    await entered.promise
    if (mode === 'abort') controller.abort()
    else s.runCredentials.revoke(token)
    discovery.resolve({
      host: 'Local',
      diagnostics: [],
      devices: [{ id: 'ios:test', name: 'Test', platform: 'ios', runtime: 'iOS', state: 'booted' }],
    })
    expect((await pending).status).toBe(401)
    expect(driver).not.toHaveBeenCalled()
  },
)
