import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  ARTIFACT_MAX_BYTES,
  artifactReferences,
  compactActivityEvents,
  decode,
  artifactResponseSchema,
  artifactListSchema,
  artifactWriteResponseSchema,
} from '@dovo/protocol'
import { startRuntime } from '../index.js'

const runtimes: Awaited<ReturnType<typeof startRuntime>>[] = []
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()))
})
const token = 'artifacts-test-owner-token-at-least-thirty-two-characters'
async function fixture(databasePath = ':memory:', enableArtifacts = true) {
  const runtime = await startRuntime({ databasePath, ownerToken: token, port: 0 })
  runtimes.push(runtime)
  runtime.services.preferences.save({ enableArtifacts })
  const taskId = randomUUID(),
    otherId = randomUUID()
  runtime.services.store.update((workspace) => ({
    ...workspace,
    tasks: [taskId, otherId].map((id) => ({
      id,
      title: 'Artifacts',
      repositoryId: 'repo',
      agentId: '',
      status: 'draft' as const,
      createdAt: new Date().toISOString(),
      messages: [],
      files: [],
      draft: '',
      example: false,
    })),
  }))
  const post = async (action: string, input: unknown, credential = token) => {
    const response = await fetch(`http://127.0.0.1:${runtime.port}/api/artifacts/${action}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    const value: unknown = await response.json()
    return { status: response.status, value }
  }
  return { runtime, taskId, otherId, post }
}
it('creates, lists and versions artifacts without embedding bodies in activity; enforces thread scope and concurrent revisions', async () => {
  const f = await fixture()
  const input = {
    taskId: f.taskId,
    title: 'Counter',
    format: 'html' as const,
    content: '<button>Count</button>',
  }
  const created = await f.post('create', input)
  expect(created.status).toBe(200)
  const first = decode(artifactWriteResponseSchema, created.value).artifact
  expect(created.value).not.toHaveProperty('artifact.content')
  const updated = await f.post('update', {
    ...input,
    id: first.id,
    expectedRevision: 1,
    content: '<button>Count 2</button>',
  })
  expect(updated.status).toBe(200)
  expect(decode(artifactWriteResponseSchema, updated.value).artifact.revision).toBe(2)
  expect((await f.post('update', { ...input, id: first.id, expectedRevision: 1 })).status).toBe(409)
  expect(
    f.runtime.services.artifacts.versions(f.taskId, first.id).map((version) => version.revision),
  ).toEqual([2, 1])
  expect(f.runtime.services.artifacts.read(f.taskId, first.id, 1).content).toBe(input.content)
  expect(
    decode(artifactResponseSchema, (await f.post('read', { taskId: f.taskId, id: first.id })).value)
      .artifact.content,
  ).toBe('<button>Count 2</button>')
  expect(f.runtime.services.artifacts.list(f.taskId)).toHaveLength(1)
  expect((await f.post('read', { taskId: f.otherId, id: first.id })).status).toBe(404)
  expect(
    (await f.post('update', { ...input, taskId: f.otherId, id: first.id, expectedRevision: 2 }))
      .status,
  ).toBe(404)
  const events = f.runtime.services.activity.list('', '', 0, f.taskId).events
  const compact = compactActivityEvents(events)
  expect(compact.flatMap((event) => artifactReferences(event.payload))).toHaveLength(2)
  expect(JSON.stringify(compact)).not.toContain('Count 2</button>')
  f.runtime.services.store.update((workspace) => ({
    ...workspace,
    tasks: workspace.tasks.filter((task) => task.id !== f.taskId),
  }))
  expect(f.runtime.services.db.prepare('SELECT id FROM artifacts').all()).toEqual([])
})
it('collects hosted links from full thread history and all tool results, preserving thread scope', async () => {
  const f = await fixture()
  f.runtime.services.store.updateTask(f.taskId, (task) => ({
    ...task,
    messages: Array.from({ length: 350 }, (_, index) => ({
      id: `message-${index}`,
      role: 'assistant' as const,
      text: index === 0 ? '[Original design](https://claude.ai/code/artifact/old-id)' : 'History',
    })),
  }))
  const activity = f.runtime.services.activity
  activity.add('tool', f.taskId, 'Sites result', {
    content: [
      {
        text: JSON.stringify({
          id: 'site-id',
          slug: 'dashboard',
          title: 'Dashboard',
          latest_version_number: 1,
          current_live_url: 'https://dashboard.example.com/',
        }),
      },
    ],
  })
  for (let index = 0; index < 120; index++) activity.add('tool', f.taskId, 'Other tool', {})
  activity.add('tool', f.taskId, 'Repeated artifact', {
    url: 'https://claude.ai/code/artifact/old-id#comment',
  })
  activity.add('tool', f.otherId, 'Unrelated thread', { url: 'https://unrelated.chatgpt.site/' })
  const result = await f.post('list', { taskId: f.taskId })
  expect(result.status).toBe(200)
  expect(decode(artifactListSchema, result.value)).toEqual({
    artifacts: [],
    links: [
      {
        provider: 'claude',
        title: 'Original design',
        url: 'https://claude.ai/code/artifact/old-id',
      },
      { provider: 'chatgpt', title: 'Dashboard', url: 'https://dashboard.example.com/' },
    ],
  })
  expect((await f.post('list', { taskId: 'missing' })).status).toBe(404)
  expect((await f.post('list', { taskId: f.taskId }, 'invalid')).status).toBe(401)
})
it('authenticates requests and prevents paired devices and read-only agents from writing artifacts', async () => {
  const f = await fixture()
  const input = { taskId: f.taskId, title: 'Notes', format: 'markdown', content: '# Notes' }
  expect((await f.post('create', input, 'invalid')).status).toBe(401)
  const paired = 'paired-artifacts-token-at-least-thirty-two-characters'
  f.runtime.services.devices.add('Phone', paired)
  expect((await f.post('create', input, paired)).status).toBe(403)
  const created = decode(
    artifactWriteResponseSchema,
    (await f.post('create', input)).value,
  ).artifact
  expect((await f.post('read', { taskId: f.taskId, id: created.id }, paired)).status).toBe(200)
  f.runtime.services.store.update((workspace) => ({
    ...workspace,
    tasks: workspace.tasks.map((task) =>
      task.id === f.taskId
        ? {
            ...task,
            harness: {
              provider: 'claude' as const,
              permission: 'read-only' as const,
              model: '',
              endpoint: '',
              reasoning: '',
              instructions: '',
            },
          }
        : task,
    ),
  }))
  expect((await f.post('create', input)).status).toBe(403)
  expect((await f.post('update', { ...input, id: created.id, expectedRevision: 1 })).status).toBe(
    403,
  )
})
it('rejects invalid formats, titles, revisions and oversized UTF-8 bodies', async () => {
  const f = await fixture()
  const input = { taskId: f.taskId, title: 'Notes', format: 'code', content: 'const value = 1' }
  expect((await f.post('create', { ...input, format: 'remote-url' })).status).toBe(400)
  expect((await f.post('create', { ...input, title: ' ' })).status).toBe(400)
  expect(
    (
      await f.post('create', {
        ...input,
        content: '€'.repeat(Math.floor(ARTIFACT_MAX_BYTES / 3) + 1),
      })
    ).status,
  ).toBe(413)
  expect(f.runtime.services.artifacts.list(f.taskId)).toEqual([])
})
it('keeps saved content and revisions after a runtime restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-artifacts-'))
  try {
    const f = await fixture(join(directory, 'runtime.sqlite'))
    const input = {
      taskId: f.taskId,
      title: 'Diagram',
      format: 'svg' as const,
      content: '<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>',
    }
    const first = f.runtime.services.artifacts.write(input)
    f.runtime.services.artifacts.write({
      ...input,
      id: first.id,
      expectedRevision: 1,
      title: 'Revised diagram',
    })
    f.runtime.services.preferences.save({ settledArtifactRetention: '30-days' })
    f.runtime.services.store.updateTask(f.taskId, (task) => ({ ...task, archived: true }))
    const deadline = f.runtime.services.artifacts.library()[0]?.deleteAt
    await f.runtime.close()
    runtimes.splice(runtimes.indexOf(f.runtime), 1)
    const restarted = await startRuntime({
      databasePath: join(directory, 'runtime.sqlite'),
      ownerToken: token,
      port: 0,
    })
    try {
      expect(restarted.services.artifacts.read(f.taskId, first.id).revision).toBe(2)
      expect(restarted.services.artifacts.library()[0]?.deleteAt).toBe(deadline)
      expect(restarted.services.artifacts.read(f.taskId, first.id, 1).title).toBe('Diagram')
      expect(restarted.services.artifacts.list(f.taskId)[0]).not.toHaveProperty('content')
    } finally {
      await restarted.close()
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

it('defaults to disabled and immediately blocks old sessions when switched off, retaining saved artifacts', async () => {
  const f = await fixture(':memory:', false)
  expect(f.runtime.services.preferences.get().enableArtifacts).toBe(false)
  const input = { taskId: f.taskId, title: 'Opt in', format: 'markdown', content: '# Saved' }
  expect((await f.post('create', input)).status).toBe(403)
  f.runtime.services.preferences.save({ enableArtifacts: true })
  const saved = decode(artifactWriteResponseSchema, (await f.post('create', input)).value).artifact
  f.runtime.services.preferences.save({ enableArtifacts: false })
  expect((await f.post('read', { taskId: f.taskId, id: saved.id })).status).toBe(403)
  expect((await f.post('update', { ...input, id: saved.id, expectedRevision: 1 })).status).toBe(403)
  const snapshot = await fetch(`http://127.0.0.1:${f.runtime.port}/api/snapshot`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(await snapshot.json()).toHaveProperty('artifactsEnabled', false)
  f.runtime.services.preferences.save({ enableArtifacts: true })
  expect((await f.post('read', { taskId: f.taskId, id: saved.id })).status).toBe(200)
  expect(f.runtime.services.artifacts.read(f.taskId, saved.id).content).toBe('# Saved')
})

it('keeps artifacts forever by default and exposes only metadata in the global library', async () => {
  const f = await fixture()
  const artifact = f.runtime.services.artifacts.write({
    taskId: f.taskId,
    title: 'Library note',
    format: 'markdown',
    content: 'Private body',
  })
  f.runtime.services.store.updateTask(f.taskId, (task) => ({ ...task, archived: true }))
  expect(f.runtime.services.artifacts.prune(Date.now() + 1000 * 86_400_000)).toBe(0)
  const response = await f.post('library', {})
  expect(response.status).toBe(200)
  expect(JSON.stringify(response.value)).not.toContain('Private body')
  expect(f.runtime.services.artifacts.library()).toEqual([
    expect.objectContaining({
      id: artifact.id,
      threadState: 'settled',
      threadTitle: 'Artifacts',
      deleteAt: undefined,
    }),
  ])
})
it('retains settle timers through edits, cancels on reopen and starts fresh when settled again', async () => {
  const f = await fixture()
  f.runtime.services.preferences.save({ settledArtifactRetention: '7-days' })
  const artifact = f.runtime.services.artifacts.write({
    taskId: f.taskId,
    title: 'Keep versions',
    format: 'code',
    content: 'first',
  })
  f.runtime.services.artifacts.write({
    taskId: f.taskId,
    id: artifact.id,
    expectedRevision: 1,
    title: 'Keep versions',
    format: 'code',
    content: 'second',
  })
  const since = Date.now()
  const clock = vi.spyOn(Date, 'now').mockReturnValue(since)
  try {
    f.runtime.services.store.updateTask(f.taskId, (task) => ({ ...task, archived: true }))
    clock.mockReturnValue(since + 6 * 86_400_000)
    f.runtime.services.store.updateTask(f.taskId, (task) => ({ ...task, title: 'Renamed' }))
    expect(f.runtime.services.artifacts.library()[0]?.deleteAt).toBe(
      new Date(since + 7 * 86_400_000).toISOString(),
    )
    expect(f.runtime.services.artifacts.prune()).toBe(0)
    f.runtime.services.store.updateTask(f.taskId, (task) => ({ ...task, archived: false }))
    clock.mockReturnValue(since + 20 * 86_400_000)
    expect(f.runtime.services.artifacts.prune()).toBe(0)
    f.runtime.services.store.updateTask(f.taskId, (task) => ({ ...task, archived: true }))
    expect(f.runtime.services.artifacts.library()[0]?.deleteAt).toBe(
      new Date(since + 27 * 86_400_000).toISOString(),
    )
    expect(f.runtime.services.artifacts.prune(since + 27 * 86_400_000)).toBe(2)
    expect(f.runtime.services.artifacts.list(f.taskId)).toEqual([])
  } finally {
    clock.mockRestore()
  }
})
it('gives archived retention priority and immediately applies changed rules to all saved versions', async () => {
  const f = await fixture()
  f.runtime.services.preferences.save({
    settledArtifactRetention: '7-days',
    archivedArtifactRetention: 'forever',
  })
  const artifact = f.runtime.services.artifacts.write({
    taskId: f.taskId,
    title: 'Archive',
    format: 'svg',
    content: '<svg/>',
  })
  f.runtime.services.store.updateTask(f.taskId, (task) => ({
    ...task,
    archived: true,
    archivedAt: new Date().toISOString(),
  }))
  expect(f.runtime.services.artifacts.prune(Date.now() + 100 * 86_400_000)).toBe(0)
  expect(f.runtime.services.artifacts.library()[0]?.deleteAt).toBeUndefined()
  const response = await fetch(`http://127.0.0.1:${f.runtime.port}/api/runtime/preferences/save`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ archivedArtifactRetention: 'immediately' }),
  })
  expect(response.status).toBe(200)
  expect(() => f.runtime.services.artifacts.read(f.taskId, artifact.id)).toThrow(
    'Artifact not found',
  )
})
it('immediately removes all artifact versions on settlement when configured', async () => {
  const f = await fixture()
  f.runtime.services.preferences.save({ settledArtifactRetention: 'immediately' })
  f.runtime.services.artifacts.write({
    taskId: f.taskId,
    title: 'Transient',
    format: 'html',
    content: '<p>Preview</p>',
  })
  f.runtime.services.store.updateTask(f.taskId, (task) => ({ ...task, archived: true }))
  expect(f.runtime.services.artifacts.list(f.taskId)).toEqual([])
})

it('cancels archive cleanup on restore and restarts settlement retention', async () => {
  const f = await fixture()
  f.runtime.services.preferences.save({
    settledArtifactRetention: '30-days',
    archivedArtifactRetention: '7-days',
  })
  f.runtime.services.artifacts.write({
    taskId: f.taskId,
    title: 'Restored document',
    format: 'markdown',
    content: '# Keep me',
  })
  const since = Date.now()
  const clock = vi.spyOn(Date, 'now').mockReturnValue(since)
  try {
    f.runtime.services.store.updateTask(f.taskId, (task) => ({
      ...task,
      archived: true,
      archivedAt: new Date(since).toISOString(),
    }))
    expect(f.runtime.services.artifacts.library()[0]?.deleteAt).toBe(
      new Date(since + 7 * 86_400_000).toISOString(),
    )
    clock.mockReturnValue(since + 6 * 86_400_000)
    f.runtime.services.store.updateTask(f.taskId, (task) => ({
      ...task,
      archivedAt: undefined,
    }))
    expect(f.runtime.services.artifacts.library()[0]?.deleteAt).toBe(
      new Date(since + 36 * 86_400_000).toISOString(),
    )
    expect(f.runtime.services.artifacts.prune(since + 7 * 86_400_000)).toBe(0)
    expect(f.runtime.services.artifacts.prune(since + 36 * 86_400_000)).toBe(1)
  } finally {
    clock.mockRestore()
  }
})
