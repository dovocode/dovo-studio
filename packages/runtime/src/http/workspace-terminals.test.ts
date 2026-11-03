import { homedir } from 'node:os'
import { realpath } from 'node:fs/promises'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { decode, responses, STUDIO_TERMINAL_SCOPE, taskSchema } from '@dovo/protocol'
import { startRuntime } from '../index'
import { fixture } from '../testing/fixture'
import { runtimeIntegration, waitForRuntime } from '../testing/integration'

vi.setConfig(runtimeIntegration)
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
const ownerToken = 'workspace-terminal-owner-token-at-least-32-chars'
async function setup() {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken, port: 0 })
  cleanups.push(runtime.close)
  runtime.services.store.update(() => ({ ...f.workspace, tasks: [] }))
  const token = 'paired-computer-terminal-token-at-least-32-chars'
  runtime.services.devices.add('Paired computer', token)
  const request = (path: string, input: unknown, credential = token) =>
    fetch(`http://127.0.0.1:${runtime.port}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
  const post = (input: unknown, credential = token) =>
    request('/api/terminals/workspace', input, credential)
  const update = (input: unknown, credential = token) =>
    request('/api/terminals/update', input, credential)
  return { ...f, runtime, post, update }
}
it('opens home and project shells for a paired device without creating threads', async () => {
  const { runtime, post, directory, workspace } = await setup()
  const home = decode(responses.terminal, await (await post({})).json())
  expect(home.taskId).toBe(STUDIO_TERMINAL_SCOPE)
  expect(runtime.services.terminals.get(home.id).directory).toBe(await realpath(homedir()))
  const project = decode(
    responses.terminal,
    await (await post({ repositoryId: workspace.repositories[0].id })).json(),
  )
  expect(project.repositoryId).toBe(workspace.repositories[0].id)
  expect(runtime.services.terminals.get(project.id).directory).toBe(await realpath(directory))
  expect(runtime.services.store.get().tasks).toEqual([])
})
it('rejects unknown projects and unpaired devices before opening shells', async () => {
  const { runtime, post } = await setup()
  expect((await post({ repositoryId: 'missing' })).status).toBe(404)
  expect((await post({}, 'unpaired-token-at-least-32-characters')).status).toBe(401)
  expect((await post({ command: '' })).status).toBe(400)
  expect(runtime.services.terminals.list()).toEqual([])
})
it('runs explicitly submitted input in the new standalone terminal', async () => {
  const { runtime, post } = await setup()
  const session = decode(
    responses.terminal,
    await (
      await post({
        command: `"${process.execPath}" -e "process.stdout.write('workspace-' + 'command-ready')"`,
      })
    ).json(),
  )
  await waitForRuntime(() =>
    expect(runtime.services.terminals.get(session.id).buffer).toContain('workspace-command-ready'),
  )
})

it('pins, settles, reopens and snoozes a standalone shell without replacing or stopping it', async () => {
  const { runtime, post, update } = await setup()
  const terminal = decode(responses.terminal, await (await post({})).json())
  const session = runtime.services.terminals.get(terminal.id)
  const process = session.process
  const change = async (fields: object) => {
    const response = await update({ id: terminal.id, ...fields })
    expect(response.status).toBe(200)
    return decode(responses.terminal, await response.json())
  }
  const revision = runtime.services.activity.revision
  await Promise.all([change({ pinned: true }), change({ settled: true })])
  expect(session.info.pinned).toBe(true)
  expect(session.info.settledAt).toEqual(expect.any(String))
  runtime.services.terminals.input(terminal.id, "printf 'settled-%s\\n' usable\r")
  await waitForRuntime(() => expect(session.buffer).toContain('settled-usable'))
  const until = new Date(Date.now() + 60_000).toISOString()
  expect(await change({ snoozedUntil: until })).toMatchObject({ pinned: true, snoozedUntil: until })
  expect(session.info.settledAt).toBeUndefined()
  runtime.services.terminals.input(terminal.id, "printf 'snoozed-%s\\n' usable\r")
  await waitForRuntime(() => expect(session.buffer).toContain('snoozed-usable'))
  await change({ settled: true })
  expect(session.info.snoozedUntil).toBeUndefined()
  await change({ snoozedUntil: until })
  await change({ settled: false })
  expect(session.info.settledAt).toBeUndefined()
  expect(session.info.snoozedUntil).toBeUndefined()
  await change({ snoozedUntil: until })
  await change({ snoozedUntil: null, pinned: false })
  expect(session.info.snoozedUntil).toBeUndefined()
  expect(session.info.pinned).toBe(false)
  expect(runtime.services.activity.revision).toBeGreaterThan(revision)
  expect(session.process).toBe(process)
  expect(session.info.exited).toBe(false)
  runtime.services.terminals.input(terminal.id, "printf 'lifecycle-%s\\n' usable\r")
  await waitForRuntime(() => expect(session.buffer).toContain('lifecycle-usable'))
  expect(runtime.services.store.get().tasks).toEqual([])
})

it('supports thread terminals but denies lifecycle mutations even to a run that owns the terminal', async () => {
  const { runtime, directory, update } = await setup()
  const task = decode(taskSchema, {
    id: 'terminal-thread',
    title: 'Terminal thread',
    repositoryId: 'repo',
    agentId: 'agent',
    status: 'running',
    activeRunId: 'terminal-run',
    createdAt: new Date().toISOString(),
    messages: [],
    files: [],
    draft: '',
    example: false,
  })
  runtime.services.store.update((workspace) => ({ ...workspace, tasks: [task] }))
  const terminal = runtime.services.terminals.create(task.id, directory)
  const credential = runtime.services.runCredentials.issue(
    {
      taskId: task.id,
      runId: 'terminal-run',
      readOnly: false,
      permissions: { provider: 'codex', permission: 'ask' },
      artifacts: false,
      pipelineWatching: false,
      pullRequestWatching: false,
      deviceHub: false,
      memoryScopes: [],
    },
    new AbortController().signal,
  )
  runtime.services.runCredentials.addTerminal(credential, terminal.id)
  expect((await update({ id: terminal.id, settled: true }, credential)).status).toBe(403)
  expect(runtime.services.terminals.get(terminal.id).info.settledAt).toBeUndefined()
  expect((await update({ id: terminal.id, pinned: true, settled: true })).status).toBe(200)
  expect(runtime.services.terminals.get(terminal.id).info).toMatchObject({
    taskId: task.id,
    pinned: true,
    settledAt: expect.any(String),
    exited: false,
  })
})

it('reports shell exit after a combined lifecycle update in owner snapshots', async () => {
  const { runtime, post, update } = await setup()
  const terminal = decode(responses.terminal, await (await post({})).json())
  const until = new Date(Date.now() + 60_000).toISOString()
  const response = await update({
    id: terminal.id,
    pinned: true,
    settled: true,
    snoozedUntil: until,
  })
  expect(response.status).toBe(200)
  const updated = decode(responses.terminal, await response.json())
  expect(updated.snoozedUntil).toBe(until)
  expect(updated.settledAt).toBeUndefined()
  runtime.services.terminals.input(terminal.id, 'exit 7\r')
  await waitForRuntime(() =>
    expect(runtime.services.terminals.get(terminal.id).info).toMatchObject({
      exited: true,
      exitCode: 7,
      pinned: true,
      snoozedUntil: until,
    }),
  )
  const snapshot = await fetch(`http://127.0.0.1:${runtime.port}/api/snapshot`, {
    headers: { Authorization: `Bearer ${ownerToken}` },
  })
  expect(snapshot.status).toBe(200)
  expect(await snapshot.json()).toMatchObject({
    terminals: [
      expect.objectContaining({
        id: terminal.id,
        exited: true,
        exitCode: 7,
        pinned: true,
        snoozedUntil: until,
      }),
    ],
  })
})

it('validates lifecycle input atomically and requires paired or owner authorization', async () => {
  const { runtime, post, update } = await setup()
  const terminal = decode(responses.terminal, await (await post({})).json())
  for (const snoozedUntil of [
    'tomorrow',
    '2030-02-30T12:00:00.000Z',
    '2030-13-01T00:00:00Z',
    new Date(Date.now() - 60_000).toISOString(),
  ]) {
    expect((await update({ id: terminal.id, pinned: true, snoozedUntil })).status).toBe(400)
  }
  expect((await update({ id: terminal.id, settled: 'true' })).status).toBe(400)
  expect((await update({ id: 'missing', pinned: true })).status).toBe(404)
  expect((await update({ id: terminal.id, pinned: true }, 'unpaired-token')).status).toBe(401)
  expect(runtime.services.terminals.get(terminal.id).info.pinned).toBeUndefined()
  expect((await update({ id: terminal.id, pinned: true, settled: true }, ownerToken)).status).toBe(
    200,
  )
  const response = await fetch(`http://127.0.0.1:${runtime.port}/api/snapshot`, {
    headers: { Authorization: `Bearer ${ownerToken}` },
  })
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({
    terminals: [
      expect.objectContaining({ id: terminal.id, pinned: true, settledAt: expect.any(String) }),
    ],
  })
})
