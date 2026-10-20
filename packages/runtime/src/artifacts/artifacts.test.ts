import { afterEach, expect, it, vi } from 'vite-plus/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { unzipSync, strFromU8 } from 'fflate'
import {
  ARTIFACT_MAX_BYTES,
  artifactReferences,
  artifactPdfResponseSchema,
  artifactExportPreviewResponseSchema,
  artifactPngResponseSchema,
  artifactHtmlResponseSchema,
  artifactMhtmlResponseSchema,
  artifactDownloadResponseSchema,
  compactActivityEvents,
  decode,
  artifactResponseSchema,
  artifactListSchema,
  activitySchema,
  artifactWriteResponseSchema,
  conversationToolsByMessage,
  recentTools,
} from '@dovo/protocol'
import { startRuntime } from '../index.js'

const runtimes: Awaited<ReturnType<typeof startRuntime>>[] = []
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()))
})
it('keeps turn artifact tiles after the recent tool window and activity retention, without duplicating or leaking them', async () => {
  const f = await fixture()
  const turnId = randomUUID(),
    messageId = randomUUID()
  f.runtime.services.store.updateTaskHistory(f.taskId, (task) => ({
    ...task,
    status: 'running',
    messages: [{ id: messageId, turnId, role: 'assistant', text: 'Creating the preview' }],
    turns: [
      {
        id: turnId,
        assistantId: messageId,
        agentId: '',
        provider: 'codex',
        model: '',
        status: 'running',
        startedAt: new Date().toISOString(),
      },
    ],
  }))
  const created = decode(
    artifactWriteResponseSchema,
    (
      await f.post('create', {
        taskId: f.taskId,
        title: 'Turn preview',
        format: 'html',
        content: '<p>Saved preview</p>',
      })
    ).value,
  ).artifact
  const activity = f.runtime.services.activity
  const artifactEvent = () =>
    activity
      .list('', 'task-activity', 0, f.taskId)
      .events.find((event) => artifactReferences(event.payload).length)
  expect(JSON.parse(artifactEvent()!.payload)).toMatchObject({ turnId, messageId, textOffset: 20 })
  expect(
    activity
      .list('', 'task-activity', 0, f.taskId)
      .events.flatMap((event) => artifactReferences(event.payload)),
  ).toHaveLength(1)
  const nextMessageId = randomUUID()
  f.runtime.services.store.updateTaskHistory(f.taskId, (task) => ({
    ...task,
    messages: [
      ...task.messages,
      { id: 'steer', turnId, role: 'user', text: 'Finish the preview' },
      { id: nextMessageId, turnId, role: 'assistant', text: 'Preview ready' },
    ],
    turns: task.turns?.map((turn) => ({ ...turn, assistantId: nextMessageId })),
  }))
  expect(
    conversationToolsByMessage(
      f.runtime.services.store.task(f.taskId),
      recentTools(activity.list('', 'task-activity', 0, f.taskId).events),
    ).get(messageId),
  ).toHaveLength(1)
  for (let index = 0; index < 120; index++)
    activity.add('tool', f.taskId, 'Later command', {}, `later-${index}`)
  f.runtime.services.db
    .prepare('UPDATE activity SET time=? WHERE id=?')
    .run('2026-01-01T00:00:00Z', `artifact:${created.id}:1`)
  const response = await fetch(`http://127.0.0.1:${f.runtime.port}/api/activity`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope: f.taskId, kind: 'task-activity' }),
  })
  const events = decode(activitySchema, await response.json()).events
  expect(events).toHaveLength(101)
  expect(events.flatMap((event) => artifactReferences(event.payload))).toEqual(
    artifactReferences({ artifacts: [created] }),
  )
  expect(JSON.stringify(events)).not.toContain('Saved preview')
  expect(activity.list('', 'task-activity', 0, f.otherId).events).toEqual([])
  activity.pruneBefore(new Date(Date.now() + 60_000).toISOString())
  expect(artifactEvent()).toBeDefined()
  f.runtime.services.store.update((workspace) => ({
    ...workspace,
    tasks: workspace.tasks.filter((task) => task.id !== f.taskId),
  }))
  expect(activity.list('', 'task-activity', 0, f.taskId).events).toEqual([])
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
  f.runtime.services.store.updateTaskHistory(f.taskId, (task) => ({
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
      format: 'html' as const,
      files: [
        { path: 'index.html', content: '<h1>Persisted folder</h1>' },
        { path: 'notes.txt', content: 'Unreferenced file retained' },
      ],
    }
    const first = await f.runtime.services.artifacts.write(input)
    await f.runtime.services.artifacts.write({
      ...input,
      id: first.id,
      expectedRevision: 1,
      title: 'Revised diagram',
    })
    f.runtime.services.preferences.save({ settledArtifactRetention: '30-days' })
    f.runtime.services.store.updateTask(f.taskId, (task) => ({ ...task, archived: true }))
    const deadline = f.runtime.services.artifacts.library()[0]?.deleteAt
    f.runtime.services.activity.add(
      'tool',
      f.taskId,
      'Previously expired artifact',
      {},
      `artifact:${first.id}:999`,
    )
    await f.runtime.close()
    runtimes.splice(runtimes.indexOf(f.runtime), 1)
    const restarted = await startRuntime({
      databasePath: join(directory, 'runtime.sqlite'),
      ownerToken: token,
      port: 0,
    })
    try {
      expect(restarted.services.artifacts.read(f.taskId, first.id).revision).toBe(2)
      expect(restarted.services.artifacts.read(f.taskId, first.id).files).toEqual(input.files)
      expect(restarted.services.artifacts.read(f.taskId, first.id, 1).files).toEqual(input.files)
      expect(restarted.services.artifacts.library()[0]?.deleteAt).toBe(deadline)
      expect(restarted.services.artifacts.read(f.taskId, first.id, 1).title).toBe('Diagram')
      expect(restarted.services.artifacts.list(f.taskId)[0]).not.toHaveProperty('content')
      const events = restarted.services.activity.list('', 'task-activity', 0, f.taskId).events
      expect(events.some((event) => event.id === `artifact:${first.id}:999`)).toBe(false)
      expect(
        events
          .flatMap((event) => artifactReferences(event.payload))
          .map((reference) => reference.revision)
          .sort((a, b) => a - b),
      ).toEqual([1, 2])
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
  const artifact = await f.runtime.services.artifacts.write({
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
  const artifact = await f.runtime.services.artifacts.write({
    taskId: f.taskId,
    title: 'Keep versions',
    format: 'code',
    content: 'first',
  })
  await f.runtime.services.artifacts.write({
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
    expect(f.runtime.services.activity.list('', 'task-activity', 0, f.taskId).events).toEqual([])
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
  const artifact = await f.runtime.services.artifacts.write({
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
  await f.runtime.services.artifacts.write({
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
  await f.runtime.services.artifacts.write({
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

it('lets paired devices copy artifacts between writable threads and delete all versions independently', async () => {
  const f = await fixture()
  const paired = 'paired-artifacts-library-at-least-thirty-two-characters'
  f.runtime.services.devices.add('Phone', paired)
  const artifacts = f.runtime.services.artifacts
  const input = {
    taskId: f.taskId,
    title: 'Reusable',
    format: 'markdown' as const,
    content: '# Original',
  }
  const original = await artifacts.write(input)
  const sibling = await artifacts.write({ ...input, title: 'Keep me' })
  await artifacts.write({ ...input, id: original.id, expectedRevision: 1, content: '# Latest' })
  expect(
    (await f.post('attach', { taskId: f.otherId, id: original.id, targetTaskId: f.taskId }, paired))
      .status,
  ).toBe(404)
  expect(
    (await f.post('attach', { taskId: f.taskId, id: original.id, targetTaskId: f.taskId }, paired))
      .status,
  ).toBe(409)
  const copied = await f.post(
    'attach',
    { taskId: f.taskId, id: original.id, targetTaskId: f.otherId },
    paired,
  )
  expect(copied.status).toBe(200)
  const copy = decode(artifactWriteResponseSchema, copied.value).artifact
  expect(copy.id).not.toBe(original.id)
  expect(copy.revision).toBe(1)
  expect(artifacts.read(f.otherId, copy.id).content).toBe('# Latest')
  expect(
    (await f.post('delete', { taskId: f.otherId, id: original.id, expectedRevision: 2 }, paired))
      .status,
  ).toBe(404)
  expect(
    (await f.post('delete', { taskId: f.taskId, id: original.id, expectedRevision: 1 }, paired))
      .status,
  ).toBe(409)
  expect(
    (
      await f.post(
        'delete',
        { taskId: f.taskId, id: original.id, expectedRevision: 2 },
        'invalid-token',
      )
    ).status,
  ).toBe(401)
  expect(
    (await f.post('delete', { taskId: f.taskId, id: original.id, expectedRevision: 2 }, paired))
      .status,
  ).toBe(200)
  expect(artifacts.versions(f.taskId, original.id)).toEqual([])
  expect(artifacts.read(f.otherId, copy.id).content).toBe('# Latest')
  expect(artifacts.read(f.taskId, sibling.id)).toBeDefined()
  const references = f.runtime.services.activity
    .list('', '', 0, f.taskId)
    .events.flatMap((event) => artifactReferences(event.payload))
  expect(references.map((reference) => reference.id)).toEqual([sibling.id])
})

it.each(['permission', 'sandboxMode'] as const)(
  'rejects copying into settled, archived, missing and %s read-only threads',
  async (dimension) => {
    const f = await fixture()
    const source = await f.runtime.services.artifacts.write({
      taskId: f.taskId,
      title: 'Source',
      format: 'code',
      content: 'const value = 1',
    })
    const input = { taskId: f.taskId, id: source.id, targetTaskId: f.otherId }
    f.runtime.services.store.updateTask(f.otherId, (task) => ({ ...task, archived: true }))
    expect((await f.post('attach', input)).status).toBe(409)
    f.runtime.services.store.updateTask(f.otherId, (task) => ({
      ...task,
      archived: false,
      archivedAt: new Date().toISOString(),
    }))
    expect((await f.post('attach', input)).status).toBe(409)
    expect((await f.post('attach', { ...input, targetTaskId: randomUUID() })).status).toBe(404)
    f.runtime.services.store.updateTask(f.otherId, (task) => ({
      ...task,
      archivedAt: undefined,
      harness: {
        provider: 'codex',
        permission: dimension === 'permission' ? 'read-only' : 'full-access',
        ...(dimension === 'sandboxMode' ? { sandboxMode: 'read-only' as const } : {}),
        model: '',
        endpoint: '',
        reasoning: '',
        instructions: '',
      },
    }))
    expect((await f.post('attach', input)).status).toBe(403)
  },
)

it('caches revision snapshots, checks scope on cache hits, and invalidates deleted previews', async () => {
  const f = await fixture()
  const artifacts = f.runtime.services.artifacts
  const input = {
    taskId: f.taskId,
    title: 'Preview',
    format: 'html' as const,
    content: '<h1>Hello</h1>',
  }
  const saved = await artifacts.write(input)
  const render = vi
    .spyOn(f.runtime.services.browsers, 'artifactSnapshot')
    .mockResolvedValue('data:image/jpeg;base64,cHJldmlldw==')
  const request = { taskId: f.taskId, id: saved.id }
  expect((await f.post('snapshot', request)).value).toEqual({
    image: 'data:image/jpeg;base64,cHJldmlldw==',
    excerpt: '',
  })
  await f.post('snapshot', request)
  expect(render).toHaveBeenCalledTimes(1)
  expect((await f.post('snapshot', { ...request, taskId: f.otherId })).status).toBe(404)
  await artifacts.write({
    ...input,
    id: saved.id,
    expectedRevision: 1,
    content: '<h1>Updated</h1>',
  })
  await f.post('snapshot', request)
  expect(render).toHaveBeenCalledTimes(2)
  artifacts.delete(f.taskId, saved.id, 2)
  expect((await f.post('snapshot', request)).status).toBe(404)
  const text = await artifacts.write({ ...input, format: 'markdown', content: 'x'.repeat(2000) })
  expect((await f.post('snapshot', { taskId: f.taskId, id: text.id })).value).toEqual({
    excerpt: 'x'.repeat(1200),
  })
  expect(render).toHaveBeenCalledTimes(2)
  const retry = await artifacts.write(input)
  render.mockRejectedValueOnce(new Error('Browser unavailable'))
  expect((await f.post('snapshot', { taskId: f.taskId, id: retry.id })).status).toBe(500)
  expect((await f.post('snapshot', { taskId: f.taskId, id: retry.id })).status).toBe(200)
  render.mockRestore()
})

it('exports the selected saved revision as PDF for paired devices and enforces artifact scope', async () => {
  const f = await fixture()
  const artifacts = f.runtime.services.artifacts
  const saved = await artifacts.write({
    taskId: f.taskId,
    title: '../Quarterly: report',
    format: 'markdown',
    content: '# Version one',
  })
  await artifacts.write({
    ...artifacts.read(f.taskId, saved.id),
    expectedRevision: 1,
    content: '# Version two',
  })
  const render = vi
    .spyOn(f.runtime.services.browsers, 'artifactPdf')
    .mockResolvedValue(Buffer.from('%PDF-1.7\nfixture'))
  const input = { taskId: f.taskId, id: saved.id, revision: 1 }
  const paired = 'paired-artifact-pdf-token-at-least-thirty-two-characters'
  f.runtime.services.devices.add('Phone', paired)
  const exported = await f.post('pdf', input, paired)
  expect(exported.status).toBe(200)
  const result = decode(artifactPdfResponseSchema, exported.value)
  expect(result.mime).toBe('application/pdf')
  expect(result.name).toBe('_Quarterly_ report.pdf')
  expect(Buffer.from(result.data, 'base64').toString()).toBe('%PDF-1.7\nfixture')
  expect(render).toHaveBeenCalledWith(
    expect.objectContaining({ revision: 1, content: '# Version one' }),
    undefined,
  )
  expect((await f.post('pdf', { taskId: f.taskId, id: saved.id })).status).toBe(200)
  expect(render).toHaveBeenLastCalledWith(
    expect.objectContaining({ revision: 2, content: '# Version two' }),
    undefined,
  )
  expect((await f.post('pdf', { ...input, taskId: f.otherId })).status).toBe(404)
  expect((await f.post('pdf', { ...input, revision: 99 })).status).toBe(404)
  expect((await f.post('pdf', input, 'wrong-token')).status).toBe(401)
  expect(render).toHaveBeenCalledTimes(2)
  render.mockRejectedValueOnce(new Error('Browser unavailable'))
  expect((await f.post('pdf', input)).status).toBe(500)
  expect((await f.post('pdf', input)).status).toBe(200)
  f.runtime.services.preferences.save({ enableArtifacts: false })
  expect((await f.post('pdf', input)).status).toBe(403)
  render.mockRestore()
})

it('versions, copies and downloads complete artifact folders without leaking sources into metadata', async () => {
  const f = await fixture()
  const input = {
    taskId: f.taskId,
    title: 'Dashboard',
    format: 'html' as const,
    files: [
      {
        path: 'index.html',
        content:
          '<link rel="stylesheet" href="styles/main.css"><h1>Folder preview</h1><script src="scripts/main.js"></script><img src="assets/image.png">',
      },
      { path: 'styles/main.css', content: 'h1 { color: blue }' },
      { path: 'scripts/main.js', content: 'document.body.dataset.ready = "yes";' },
      { path: 'assets/image.png', content: 'aW1hZ2U=', encoding: 'base64' as const },
    ],
  }
  const created = await f.post('create', input)
  expect(created.status).toBe(200)
  const artifact = decode(artifactWriteResponseSchema, created.value).artifact
  expect(artifact).toMatchObject({ entrypoint: 'index.html', fileCount: 4 })
  expect(created.value).not.toHaveProperty('artifact.files')
  expect(JSON.stringify(f.runtime.services.artifacts.library())).not.toContain('dataset.ready')
  expect(JSON.stringify(f.runtime.services.activity.list('', '', 0, f.taskId))).not.toContain(
    'dataset.ready',
  )
  const saved = f.runtime.services.artifacts.read(f.taskId, artifact.id)
  expect(saved.files).toEqual(input.files)
  expect(saved.content).toContain('data:image/png;base64,aW1hZ2U=')
  const newer = {
    ...input,
    id: artifact.id,
    expectedRevision: 1,
    files: input.files.map((file) =>
      file.path === 'scripts/main.js'
        ? { ...file, content: 'document.body.dataset.ready = "new";' }
        : file,
    ),
  }
  expect((await f.post('update', newer)).status).toBe(200)
  expect((await f.post('update', newer)).status).toBe(409)
  expect(f.runtime.services.artifacts.read(f.taskId, artifact.id, 1).files).toEqual(input.files)
  const paired = 'artifact-folder-paired-device-token-at-least-thirty-two-characters'
  f.runtime.services.devices.add('Phone', paired)
  const download = await f.post(
    'download',
    { taskId: f.taskId, id: artifact.id, revision: 1 },
    paired,
  )
  expect(download.status).toBe(200)
  const archive = decode(artifactDownloadResponseSchema, download.value)
  expect(archive.name).toBe('Dashboard.zip')
  const files = unzipSync(Buffer.from(archive.data, 'base64'))
  expect(Object.keys(files)).toEqual(input.files.map((file) => `Dashboard/${file.path}`))
  expect(strFromU8(files['Dashboard/scripts/main.js']!)).toBe(input.files[2]!.content)
  expect(strFromU8(files['Dashboard/assets/image.png']!)).toBe('image')
  expect((await f.post('download', { taskId: f.otherId, id: artifact.id })).status).toBe(404)
  expect((await f.post('download', { taskId: f.taskId, id: artifact.id }, 'invalid')).status).toBe(
    401,
  )
  const copied = decode(
    artifactWriteResponseSchema,
    (
      await f.post(
        'attach',
        { taskId: f.taskId, id: artifact.id, revision: 1, targetTaskId: f.otherId },
        paired,
      )
    ).value,
  ).artifact
  expect(f.runtime.services.artifacts.read(f.otherId, copied.id).files).toEqual(input.files)
  expect(
    (await f.post('delete', { taskId: f.taskId, id: artifact.id, expectedRevision: 2 })).status,
  ).toBe(200)
  expect((await f.post('download', { taskId: f.taskId, id: artifact.id })).status).toBe(404)
  expect(f.runtime.services.artifacts.read(f.otherId, copied.id).fileCount).toBe(4)
})
it('rejects malformed folders and keeps the previous revision when compilation fails', async () => {
  const f = await fixture()
  const input = {
    taskId: f.taskId,
    title: 'Bundle',
    format: 'html',
    files: [{ path: 'index.html', content: '<h1>Saved</h1>' }],
  }
  const saved = decode(artifactWriteResponseSchema, (await f.post('create', input)).value).artifact
  for (const changes of [
    { files: [{ path: '../escape', content: '' }] },
    {
      files: [
        { path: 'index.html', content: '' },
        { path: 'INDEX.html', content: '' },
      ],
    },
    { files: [{ path: 'index.html', content: '<script src="missing.js"></script>' }] },
    { entrypoint: 'missing.html' },
    { format: 'code' },
    { files: undefined },
    { content: 'Ambiguous content and files' },
  ])
    expect(
      (await f.post('update', { ...input, ...changes, id: saved.id, expectedRevision: 1 })).status,
    ).toBe(400)
  expect(f.runtime.services.artifacts.read(f.taskId, saved.id).revision).toBe(1)
  expect(
    (
      await f.post('update', {
        taskId: f.taskId,
        id: saved.id,
        expectedRevision: 1,
        title: 'Single file',
        format: 'html',
        content: '<p>Converted</p>',
      })
    ).status,
  ).toBe(200)
  expect(f.runtime.services.artifacts.read(f.taskId, saved.id).files).toBeUndefined()
  expect((await f.post('download', { taskId: f.taskId, id: saved.id })).status).toBe(400)
})

it('rechecks authorization after a folder build and prevents concurrent revision overwrites', async () => {
  const f = await fixture()
  const artifacts = f.runtime.services.artifacts
  const input = {
    taskId: f.taskId,
    title: 'Concurrent folder',
    format: 'html' as const,
    files: [{ path: 'index.html', content: '<script>document.body.dataset.ready="yes";</script>' }],
  }
  const pending = artifacts.write(input)
  f.runtime.services.preferences.save({ enableArtifacts: false })
  await expect(pending).rejects.toThrow('Enable Dovo Artifacts')
  expect(artifacts.list(f.taskId)).toEqual([])
  f.runtime.services.preferences.save({ enableArtifacts: true })
  const saved = await artifacts.write(input)
  const results = await Promise.allSettled([
    artifacts.write({ ...input, id: saved.id, expectedRevision: 1, title: 'First update' }),
    artifacts.write({ ...input, id: saved.id, expectedRevision: 1, title: 'Second update' }),
  ])
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
  expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
  expect(artifacts.versions(f.taskId, saved.id).map((version) => version.revision)).toEqual([2, 1])
})

it.each(['html', 'mhtml'] as const)(
  'exports a selected folder revision as %s with paired-device authorization',
  async (format) => {
    const f = await fixture()
    const artifacts = f.runtime.services.artifacts
    const files = [
      {
        path: 'index.html',
        content: '<button onclick="this.textContent=1">First revision</button>',
      },
    ]
    const saved = await artifacts.write({
      taskId: f.taskId,
      title: 'Folder export',
      format: 'html',
      files,
    })
    await artifacts.write({
      taskId: f.taskId,
      title: 'Folder export',
      format: 'html',
      files: [{ path: 'index.html', content: '<h1>Second revision</h1>' }],
      id: saved.id,
      expectedRevision: 1,
    })
    const render = vi
      .spyOn(f.runtime.services.browsers, 'artifactMhtml')
      .mockResolvedValue(Buffer.from('MIME-Version: 1.0\r\nContent-Type: multipart/related\r\n'))
    const paired = 'paired-folder-export-token-at-least-thirty-two-characters'
    f.runtime.services.devices.add('Phone', paired)
    const input = { taskId: f.taskId, id: saved.id, revision: 1 }
    const exported = await f.post(format, input, paired)
    expect(exported.status).toBe(200)
    const result =
      format === 'html'
        ? decode(artifactHtmlResponseSchema, exported.value)
        : decode(artifactMhtmlResponseSchema, exported.value)
    expect(result.name).toBe(`Folder export.${format}`)
    const content = Buffer.from(result.data, 'base64').toString()
    expect(content).toContain(format === 'html' ? 'First revision' : 'MIME-Version: 1.0')
    expect(content).not.toContain('Second revision')
    expect(content.includes('sandbox="allow-scripts allow-downloads"')).toBe(format === 'html')
    expect(content.includes("connect-src 'none'")).toBe(format === 'html')
    expect(
      render.mock.calls.map(([artifact]) => ({
        revision: artifact.revision,
        files: artifact.files,
      })),
    ).toEqual(format === 'html' ? [] : [{ revision: 1, files }])
    render.mockRejectedValueOnce(new Error('Chromium unavailable'))
    expect((await f.post(format, input, paired)).status).toBe(format === 'mhtml' ? 500 : 200)
    expect((await f.post(format, input, paired)).status).toBe(200)
    expect((await f.post(format, { ...input, revision: 99 }, paired)).status).toBe(404)
    expect((await f.post(format, { ...input, taskId: f.otherId }, paired)).status).toBe(404)
    expect((await f.post(format, input, 'invalid')).status).toBe(401)
    f.runtime.services.preferences.save({ enableArtifacts: false })
    expect((await f.post(format, input, paired)).status).toBe(403)
    render.mockRestore()
  },
)

it('validates PDF options before rendering and forwards selected settings', async () => {
  const f = await fixture()
  const saved = await f.runtime.services.artifacts.write({
    taskId: f.taskId,
    title: 'Document',
    format: 'markdown',
    content: '# Report',
  })
  const render = vi
    .spyOn(f.runtime.services.browsers, 'artifactPdf')
    .mockResolvedValue(Buffer.from('%PDF-1.7'))
  const input = { taskId: f.taskId, id: saved.id }
  for (const options of [
    { paperSize: 'A0' },
    { landscape: 'true' },
    { marginMm: -1 },
    { marginMm: 51 },
    { scale: 9 },
    { scale: 201 },
    { background: 'yes' },
  ]) {
    expect((await f.post('pdf', { ...input, options })).status).toBe(400)
  }
  expect(render).not.toHaveBeenCalled()
  const options = {
    paperSize: 'Letter',
    landscape: true,
    marginMm: 8.5,
    scale: 85,
    background: false,
  }
  expect((await f.post('pdf', { ...input, options })).status).toBe(200)
  expect(render).toHaveBeenLastCalledWith(expect.objectContaining({ id: saved.id }), options)
  render.mockRestore()
})
it('exports scoped PNG revisions and validates width before rendering', async () => {
  const f = await fixture()
  const artifacts = f.runtime.services.artifacts
  const saved = await artifacts.write({
    taskId: f.taskId,
    title: 'Preview',
    format: 'html',
    content: '<h1>Earlier</h1>',
  })
  await artifacts.write({
    ...artifacts.read(f.taskId, saved.id),
    expectedRevision: 1,
    content: '<h1>Current</h1>',
  })
  const render = vi
    .spyOn(f.runtime.services.browsers, 'artifactPng')
    .mockResolvedValue(Buffer.from('PNG fixture'))
  const paired = 'paired-artifact-png-token-at-least-thirty-two-characters'
  f.runtime.services.devices.add('Phone', paired)
  const input = { taskId: f.taskId, id: saved.id, revision: 1, width: 960 }
  const exported = await f.post('png', input, paired)
  expect(exported.status).toBe(200)
  const result = decode(artifactPngResponseSchema, exported.value)
  expect(result.name).toBe('Preview.png')
  expect(result.mime).toBe('image/png')
  expect(Buffer.from(result.data, 'base64').toString()).toBe('PNG fixture')
  expect(render).toHaveBeenLastCalledWith(
    expect.objectContaining({ revision: 1, content: '<h1>Earlier</h1>' }),
    960,
  )
  expect((await f.post('png', { taskId: f.taskId, id: saved.id })).status).toBe(200)
  expect(render).toHaveBeenLastCalledWith(expect.objectContaining({ revision: 2 }), undefined)
  for (const width of [0, 319, 4097, 640.5, '960'])
    expect((await f.post('png', { ...input, width })).status).toBe(400)
  expect((await f.post('png', { ...input, taskId: f.otherId })).status).toBe(404)
  expect((await f.post('png', { ...input, revision: 99 })).status).toBe(404)
  expect((await f.post('png', input, 'wrong-token')).status).toBe(401)
  expect(render).toHaveBeenCalledTimes(2)
  render.mockRejectedValueOnce(new Error('Browser unavailable'))
  expect((await f.post('png', input)).status).toBe(500)
  expect((await f.post('png', input)).status).toBe(200)
  f.runtime.services.preferences.save({ enableArtifacts: false })
  expect((await f.post('png', input)).status).toBe(403)
  render.mockRestore()
})

it.each(['pdf', 'mhtml'] as const)(
  'exports a temporary %s edit without updating the saved source',
  async (format) => {
    const f = await fixture()
    const saved = await f.runtime.services.artifacts.write({
      taskId: f.taskId,
      title: 'Saved source',
      format: 'markdown',
      content: '# Saved source',
    })
    const artifact = f.runtime.services.artifacts.read(f.taskId, saved.id)
    const render = vi
      .spyOn(f.runtime.services.browsers, format === 'pdf' ? 'artifactPdf' : 'artifactMhtml')
      .mockResolvedValue(Buffer.from('export'))
    const input = {
      taskId: f.taskId,
      id: saved.id,
      revision: 1,
      draftHtml: '<h1>Temporary changes</h1><aside data-no-print>Skip</aside>',
    }
    expect((await f.post(format, input)).status).toBe(200)
    expect(render.mock.calls[0]?.[0]).toEqual({
      ...artifact,
      format: 'html',
      content: input.draftHtml,
    })
    expect(f.runtime.services.artifacts.read(f.taskId, saved.id)).toEqual(artifact)
    expect(f.runtime.services.artifacts.versions(f.taskId, saved.id)).toHaveLength(1)
    expect((await f.post(format, { ...input, draftHtml: 42 })).status).toBe(400)
    expect((await f.post(format, { ...input, taskId: f.otherId })).status).toBe(404)
    expect((await f.post(format, { ...input, revision: 99 })).status).toBe(404)
    expect(render).toHaveBeenCalledTimes(1)
    render.mockRestore()
  },
)
it('prepares a scoped rendered export copy for paired devices without creating a revision', async () => {
  const f = await fixture()
  const saved = await f.runtime.services.artifacts.write({
    taskId: f.taskId,
    title: 'Editor',
    format: 'html',
    content: '<h1>Source</h1>',
  })
  const render = vi
    .spyOn(f.runtime.services.browsers, 'artifactExportPreview')
    .mockResolvedValue('<h1>Rendered initial state</h1>')
  const paired = 'paired-export-editor-token-at-least-thirty-two-characters'
  f.runtime.services.devices.add('Phone', paired)
  const input = { taskId: f.taskId, id: saved.id, revision: 1 }
  const response = await f.post('export-preview', input, paired)
  expect(response.status).toBe(200)
  expect(decode(artifactExportPreviewResponseSchema, response.value).content).toBe(
    '<h1>Rendered initial state</h1>',
  )
  expect(render).toHaveBeenCalledWith(expect.objectContaining({ id: saved.id, revision: 1 }))
  expect((await f.post('export-preview', { ...input, taskId: f.otherId })).status).toBe(404)
  expect((await f.post('export-preview', { ...input, revision: 99 })).status).toBe(404)
  expect((await f.post('export-preview', input, 'wrong-token')).status).toBe(401)
  render.mockRejectedValueOnce(new Error('Renderer unavailable'))
  expect((await f.post('export-preview', input)).status).toBe(500)
  expect((await f.post('export-preview', input)).status).toBe(200)
  expect(f.runtime.services.artifacts.versions(f.taskId, saved.id)).toHaveLength(1)
  f.runtime.services.preferences.save({ enableArtifacts: false })
  expect((await f.post('export-preview', input)).status).toBe(403)
  render.mockRestore()
})
