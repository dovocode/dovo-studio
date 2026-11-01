import { afterEach, expect, it, vi } from 'vite-plus/test'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runClientEffect } from '@dovo/client-runtime'
import { startRuntime } from '../../index.js'
import { fixture } from '../../testing/fixture.js'
import { runtimeIntegration, waitForRuntime } from '../../testing/integration.js'
import {
  bringBackSideThreadResultSchema,
  decode,
  sideThreadChangesResultSchema,
} from '@dovo/protocol'

vi.setConfig(runtimeIntegration)
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function setup() {
  const fixtureData = await fixture()
  cleanups.push(fixtureData.cleanup)
  const ownerToken = 'side-thread-test-owner-token-at-least-32-characters'
  const runtimeDirectory = await mkdtemp(join(tmpdir(), 'dovo-side-thread-runtime-'))
  cleanups.push(() => rm(runtimeDirectory, { recursive: true, force: true }))
  const options = {
    databasePath: join(runtimeDirectory, 'runtime.sqlite'),
    ownerToken,
    port: 0,
  }
  let runtime = await startRuntime(options)
  cleanups.push(() => runtime.close())
  runtime.services.store.update(() => fixtureData.workspace)
  const call = async (path: string, input: unknown) => {
    const response = await fetch(`http://127.0.0.1:${runtime.port}/api/tasks/side-thread/${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    return { status: response.status, body: await response.json() }
  }
  const restart = async () => {
    await runtime.close()
    runtime = await startRuntime(options)
    return runtime.services
  }
  return {
    fixtureData,
    get services() {
      return runtime.services
    },
    call,
    lifecycle: async (input: unknown) => {
      const response = await fetch(`http://127.0.0.1:${runtime.port}/api/tasks/lifecycle`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      return response.status
    },
    restart,
  }
}

it('discards only an unused side thread, including an edited draft', async () => {
  const setupData = await setup()
  const s = setupData.services
  const parent = s.tasks.create({
    title: 'Parent',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: '',
  })
  const childId = randomUUID()
  expect(
    (await setupData.call('create', { id: parent.id, childId, objective: 'Question' })).status,
  ).toBe(200)
  s.store.updateTask(childId, (task) => ({ ...task, draft: 'Edited question' }))
  expect((await setupData.call('discard', { id: parent.id })).status).toBe(409)
  expect(await setupData.call('discard', { id: childId })).toEqual({
    status: 200,
    body: { ok: true },
  })
  expect(s.store.get().tasks.some((task) => task.id === childId)).toBe(false)
  expect(await setupData.call('discard', { id: childId })).toEqual({
    status: 200,
    body: { ok: true },
  })
  await setupData.restart()
  expect(await setupData.call('discard', { id: childId })).toEqual({
    status: 200,
    body: { ok: true },
  })
  expect((await setupData.call('discard', { id: randomUUID() })).status).toBe(404)
})

it('does not discard a side thread that receives queued work during cleanup', async () => {
  const setupData = await setup()
  const s = setupData.services
  const parent = s.tasks.create({
    title: 'Parent',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: '',
  })
  const childId = randomUUID()
  await setupData.call('create', { id: parent.id, childId, objective: 'Question' })
  let release!: () => void
  let entered!: () => void
  const waiting = new Promise<void>((resolve) => {
    release = resolve
  })
  const started = new Promise<void>((resolve) => {
    entered = resolve
  })
  vi.spyOn(s.browsers, 'closeTask').mockImplementation(async () => {
    entered()
    await waiting
  })
  const discard = setupData.call('discard', { id: childId })
  await started
  s.store.updateTask(childId, (task) => ({
    ...task,
    queue: [{ id: 'queued', role: 'user', text: 'work', createdAt: new Date().toISOString() }],
  }))
  release()
  expect((await discard).status).toBe(409)
  expect(s.store.task(childId).queue).toHaveLength(1)
})

it('creates an executable isolated snapshot and atomically brings its result back once across restart', async () => {
  const setupData = await setup()
  const s = setupData.services
  const parent = s.tasks.create({
    title: 'Parent',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Parent request',
    agentOverrides: { model: 'test-model', permission: 'workspace-write' },
  })
  s.store.updateTask(parent.id, (task) => ({ ...task, draft: 'Keep my draft' }))
  await writeFile(join(setupData.fixtureData.directory, 'hello.txt'), 'uncommitted parent\n')
  await writeFile(join(setupData.fixtureData.directory, 'untracked.txt'), 'untracked parent\n')
  const childId = randomUUID()
  const input = { id: parent.id, childId, objective: 'Investigate this' }
  const created = await Promise.all([
    setupData.call('create', input),
    setupData.call('create', input),
  ])
  expect(created).toEqual([
    { status: 200, body: { id: childId } },
    { status: 200, body: { id: childId } },
  ])
  expect((await setupData.call('create', { ...input, objective: 'different' })).status).toBe(409)
  const child = s.store.task(childId)
  expect(child).toMatchObject({
    status: 'draft',
    execution: 'worktree',
    draft: 'Investigate this',
    agentOverrides: { model: 'test-model', permission: 'workspace-write' },
    sideThread: { parentTaskId: parent.id, source: 'snapshot' },
  })
  expect(() =>
    s.store.updateTask(childId, (task) => ({
      ...task,
      agentOverrides: { ...task.agentOverrides, permission: 'full-access' },
    })),
  ).toThrow('cannot exceed')
  expect((await setupData.call('create', { id: childId, childId: randomUUID() })).status).toBe(409)
  expect((await setupData.call('bring-back', { id: childId })).status).toBe(409)
  let childCwd = ''
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: async () => ({ provider: 'codex', available: true, detail: '' }),
    run: async (run) => {
      childCwd = run.cwd
      expect(childCwd).not.toBe(setupData.fixtureData.directory)
      expect(await readFile(join(childCwd, 'hello.txt'), 'utf8')).toBe('uncommitted parent\n')
      expect(await readFile(join(childCwd, 'untracked.txt'), 'utf8')).toBe('untracked parent\n')
      await writeFile(join(childCwd, 'hello.txt'), 'child edit\n')
      run.onText('The completed finding')
    },
  })
  await s.tasks.send(childId, randomUUID(), 'Investigate this')
  await waitForRuntime(() => expect(s.store.task(childId).status).toBe('review'))
  expect((await setupData.call('discard', { id: childId })).status).toBe(409)
  cleanups.push(() => rm(childCwd, { recursive: true, force: true }))
  await writeFile(join(childCwd, 'child-only.txt'), 'child untracked\n')
  await writeFile(join(childCwd, 'large.txt'), 'x'.repeat(70_000))
  const changes = await setupData.call('changes', { id: childId })
  expect(changes.status).toBe(200)
  const review = decode(sideThreadChangesResultSchema, changes.body)
  expect(review.files.map((file) => file.path)).toEqual(
    expect.arrayContaining(['hello.txt', 'child-only.txt']),
  )
  expect(review.files.find((file) => file.path === 'untracked.txt')).toBeUndefined()
  const largeInput = { id: childId, before: review.before, after: review.after, path: 'large.txt' }
  expect(await setupData.call('file-preview', largeInput)).toMatchObject({
    status: 200,
    body: { after: { truncated: true } },
  })
  expect(await setupData.call('file-preview', { ...largeInput, full: true })).toMatchObject({
    status: 200,
    body: { after: { truncated: false, text: 'x'.repeat(70_000) } },
  })
  const preview = await setupData.call('file-preview', {
    id: childId,
    before: review.before,
    after: review.after,
    path: 'hello.txt',
  })
  expect(preview).toMatchObject({
    status: 200,
    body: { before: { text: 'uncommitted parent\n' }, after: { text: 'child edit\n' } },
  })
  await s.git.command(childCwd, ['add', 'hello.txt'])
  await s.git.command(childCwd, [
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.com',
    'commit',
    '-m',
    'Child change',
  ])
  await writeFile(join(childCwd, 'hello.txt'), 'later edit\n')
  const later = await setupData.call('changes', { id: childId })
  expect(later).toMatchObject({
    status: 200,
    body: {
      files: expect.arrayContaining([
        expect.objectContaining({
          path: 'hello.txt',
          before: 'uncommitted parent\n',
          after: 'later edit\n',
        }),
      ]),
    },
  })
  expect(
    await setupData.call('file-preview', {
      id: childId,
      before: review.before,
      after: review.after,
      path: 'hello.txt',
    }),
  ).toEqual(preview)
  expect(
    (
      await setupData.call('file-preview', {
        id: childId,
        before: review.before,
        after: review.after,
        path: 'untracked.txt',
      })
    ).status,
  ).toBe(404)
  expect(
    (
      await setupData.call('file-preview', {
        id: childId,
        before: review.before,
        after: '0'.repeat(40),
        path: 'hello.txt',
      })
    ).status,
  ).toBe(409)
  expect(await readFile(join(setupData.fixtureData.directory, 'hello.txt'), 'utf8')).toBe(
    'uncommitted parent\n',
  )
  s.store.updateTask(parent.id, (task) => ({ ...task, status: 'running' }))
  expect((await setupData.call('bring-back', { id: childId })).status).toBe(409)
  s.store.updateTask(parent.id, (task) => ({
    ...task,
    status: 'draft',
    queue: [{ id: 'queued', role: 'user', text: 'queued', createdAt: new Date().toISOString() }],
  }))
  expect((await setupData.call('bring-back', { id: childId })).status).toBe(409)
  s.store.updateTask(parent.id, (task) => ({
    ...task,
    queue: undefined,
    archivedAt: new Date().toISOString(),
  }))
  expect((await setupData.call('bring-back', { id: childId })).status).toBe(409)
  s.store.updateTask(parent.id, (task) => ({ ...task, archivedAt: undefined, archived: true }))
  s.store.updateTask(childId, (task) => ({
    ...task,
    archived: true,
    archivedAt: new Date().toISOString(),
  }))
  expect((await setupData.call('bring-back', { id: childId })).status).toBe(409)
  s.store.updateTask(childId, (task) => ({ ...task, archivedAt: undefined }))
  s.store.updateTask(childId, (task) => ({
    ...task,
    queue: [
      { id: 'child-queued', role: 'user', text: 'queued', createdAt: new Date().toISOString() },
    ],
  }))
  expect((await setupData.call('bring-back', { id: childId })).status).toBe(409)
  s.store.updateTask(childId, (task) => ({ ...task, queue: undefined }))
  const originalContext = s.store.task(childId).messages[0]!
  s.store.updateTaskHistory(childId, (task) => ({
    ...task,
    messages: task.messages.map((message, index) =>
      index === 0 ? { ...message, text: 'changed context' } : message,
    ),
  }))
  expect((await setupData.call('bring-back', { id: childId })).status).toBe(409)
  s.store.updateTaskHistory(childId, (task) => ({
    ...task,
    messages: task.messages.map((message, index) => (index === 0 ? originalContext : message)),
  }))
  s.store.updateTask(parent.id, (task) => ({ ...task, historyRevision: 1 }))
  expect((await setupData.call('bring-back', { id: childId })).status).toBe(409)
  s.store.updateTask(parent.id, (task) => ({ ...task, historyRevision: 0 }))
  expect((await setupData.call('bring-back', { id: childId, expectedDraft: 'stale' })).status).toBe(
    409,
  )
  const first = await setupData.call('bring-back', { id: childId, expectedDraft: 'Keep my draft' })
  expect(first.status).toBe(200)
  const receipt = decode(bringBackSideThreadResultSchema, first.body)
  const turnId = s.store.task(childId).turns?.at(-1)?.id
  expect(receipt).toMatchObject({ id: parent.id, receiptId: `${childId}:${turnId}` })
  expect(receipt.text).toContain(`[Side thread ${childId} ${turnId}]`)
  expect(receipt.text).toContain(`Checkout: ${childCwd}`)
  expect(receipt.text).toContain(
    `Branch: ${(await s.git.command(childCwd, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()}`,
  )
  expect(receipt.text).toContain(
    `HEAD: ${(await s.git.command(childCwd, ['rev-parse', 'HEAD'])).trim()}`,
  )
  expect(receipt.text).toContain('No Git merge was performed')
  const draft = s.store.task(parent.id).draft
  expect(draft).toBe(`Keep my draft\n\n${receipt.text}`)
  expect(draft).toContain('The completed finding')
  expect(receipt.text).toContain('Assistant: The completed finding')
  expect(await readFile(join(setupData.fixtureData.directory, 'hello.txt'), 'utf8')).toBe(
    'uncommitted parent\n',
  )
  expect(s.store.task(parent.id).archived).toBe(true)
  expect(s.store.task(childId).archived).toBe(true)
  s.store.updateTask(parent.id, (task) => ({ ...task, status: 'running' }))
  expect(await setupData.call('bring-back', { id: childId })).toEqual({
    status: 200,
    body: receipt,
  })
  s.store.updateTask(parent.id, (task) => ({ ...task, status: 'draft' }))
  s.store.updateTask(childId, (task) => ({ ...task, title: 'Renamed after handoff' }))
  const restarted = await setupData.restart()
  expect(
    await setupData.call('file-preview', {
      id: childId,
      before: review.before,
      after: review.after,
      path: 'hello.txt',
    }),
  ).toEqual(preview)
  expect(await setupData.call('create', input)).toMatchObject({
    status: 200,
    body: { id: childId },
  })
  expect(
    await setupData.call('bring-back', { id: childId, expectedDraft: 'Keep my draft' }),
  ).toEqual({ status: 200, body: receipt })
  expect(restarted.store.task(parent.id).draft).toBe(draft)
  restarted.store.updateTask(childId, (task) => ({ ...task, archived: false }))
  vi.spyOn(restarted.agents, 'get').mockResolvedValue({
    probe: async () => ({ provider: 'codex', available: true, detail: '' }),
    run: async (run) => {
      run.onText('A newer finding')
    },
  })
  await restarted.tasks.send(childId, randomUUID(), 'Follow up')
  await waitForRuntime(() => expect(restarted.store.task(childId).turns).toHaveLength(2))
  await waitForRuntime(() => expect(restarted.store.task(childId).status).toBe('review'))
  await restarted.tasks.send(childId, randomUUID(), 'Another follow up')
  await waitForRuntime(() => expect(restarted.store.task(childId).turns).toHaveLength(3))
  await waitForRuntime(() => expect(restarted.store.task(childId).status).toBe('review'))
  const second = await setupData.call('bring-back', { id: childId })
  expect(second.status).toBe(200)
  const secondReceipt = decode(bringBackSideThreadResultSchema, second.body)
  expect(secondReceipt.receiptId).not.toBe(receipt.receiptId)
  expect(secondReceipt.text).toContain('User: Follow up')
  expect(secondReceipt.text).toContain('User: Another follow up')
  expect(secondReceipt.text).toContain('Assistant: A newer finding')
  expect(secondReceipt.text).not.toContain('The completed finding')
  const updated = restarted.store.task(parent.id).draft
  expect(updated).toContain('A newer finding')
  expect(updated.split('The completed finding')).toHaveLength(2)
  expect(await setupData.call('bring-back', { id: childId })).toEqual({
    status: 200,
    body: secondReceipt,
  })
  expect(restarted.store.task(parent.id).draft).toBe(updated)
  await restarted.git.command(childCwd, ['update-ref', '-d', `refs/dovo/forks/${childId}/source`])
  expect((await setupData.call('changes', { id: childId })).status).toBe(409)
  expect(
    (
      await setupData.call('file-preview', {
        id: childId,
        before: review.before,
        after: review.after,
        path: 'hello.txt',
      })
    ).status,
  ).toBe(409)
})

it('omits an incomplete turn without losing the newest completed result', async () => {
  const setupData = await setup()
  const s = setupData.services
  const parent = s.tasks.create({
    title: 'Parent',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: '',
  })
  const childId = randomUUID()
  expect((await setupData.call('create', { id: parent.id, childId })).status).toBe(200)
  let calls = 0
  let childCwd = ''
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: async () => ({ provider: 'codex', available: true, detail: '' }),
    run: async (run) => {
      childCwd = run.cwd
      calls++
      if (calls === 1) run.onText(`Older answer ${'x'.repeat(20000)}`)
      else if (calls === 2) throw new Error('Provider disconnected')
      else run.onText('Newest final result')
    },
  })
  await s.tasks.send(childId, randomUUID(), 'Older question')
  await waitForRuntime(() => expect(s.store.task(childId).status).toBe('review'))
  cleanups.push(() => rm(childCwd, { recursive: true, force: true }))
  await s.tasks.send(childId, randomUUID(), 'Failed private prompt')
  await waitForRuntime(() => expect(s.store.task(childId).status).toBe('failed'))
  const failed = s.store.task(childId).turns?.at(-1)
  expect(failed?.status).toBe('failed')
  s.store.updateTaskHistory(childId, (task) => ({
    ...task,
    messages: task.messages.filter((message) => message.id !== failed?.assistantId),
  }))
  await runClientEffect(
    s.tasks.sendEffect(childId, randomUUID(), 'Newest question', [], false, true),
  )
  await waitForRuntime(() => expect(s.store.task(childId).turns).toHaveLength(3))
  await waitForRuntime(() => expect(s.store.task(childId).status).toBe('review'))
  const response = await setupData.call('bring-back', { id: childId })
  expect(response.status).toBe(200)
  const receipt = decode(bringBackSideThreadResultSchema, response.body)
  expect(receipt.text).toContain('Earlier conversation text omitted or truncated')
  expect(receipt.text).toContain('Assistant: [earlier text truncated] ')
  expect(receipt.text).toContain('Some non-completed or file content was omitted')
  expect(receipt.text).toContain('User: Newest question')
  expect(receipt.text).toContain('Assistant: Newest final result')
  expect(receipt.text).not.toContain('Failed private prompt')
  expect(await setupData.call('bring-back', { id: childId })).toEqual(response)
  await setupData.restart()
  expect(await setupData.call('bring-back', { id: childId })).toEqual(response)
})

it('keeps linked checkouts read-only and rejects handoff after parent deletion', async () => {
  const setupData = await setup()
  const s = setupData.services
  const parent = s.tasks.create({
    title: 'Parent',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: '',
  })
  s.store.updateTask(parent.id, (task) => ({
    ...task,
    linkedCheckouts: [{ id: 'linked', repositoryId: 'repo', execution: 'main', access: 'edit' }],
  }))
  const childId = randomUUID()
  expect((await setupData.call('create', { id: parent.id, childId })).status).toBe(200)
  expect(s.store.task(childId).linkedCheckouts?.[0]?.access).toBe('read-only')
  expect(() =>
    s.store.updateTask(childId, (task) => ({
      ...task,
      linkedCheckouts: task.linkedCheckouts?.map((link) => ({ ...link, access: 'edit' })),
    })),
  ).toThrow('read-only')
  const deletedId = randomUUID()
  expect((await setupData.call('create', { id: parent.id, childId: deletedId })).status).toBe(200)
  s.store.update((workspace) => ({
    ...workspace,
    tasks: workspace.tasks.filter((task) => task.id !== deletedId),
  }))
  expect((await setupData.call('create', { id: parent.id, childId: deletedId })).status).toBe(409)
  s.store.update((workspace) => ({
    ...workspace,
    tasks: workspace.tasks.filter((task) => task.id !== parent.id),
  }))
  expect((await setupData.call('bring-back', { id: childId })).status).toBe(409)
  expect(s.store.task(childId).sideThread?.parentTaskId).toBe(parent.id)
})

it('inherits the primary pull request only as an informational link', async () => {
  const setupData = await setup()
  const s = setupData.services
  const pullRequest = {
    number: 42,
    url: 'https://github.com/example/repo/pull/42',
    repositoryUrl: 'https://github.com/example/repo',
    headSha: 'a'.repeat(40),
    baseSha: 'b'.repeat(40),
  }
  const parent = s.tasks.create({
    title: 'PR review',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: '',
    pullRequest,
  })
  const childId = randomUUID()
  expect((await setupData.call('create', { id: parent.id, childId })).status).toBe(200)
  const child = s.store.task(childId)
  expect(child.pullRequest).toBeUndefined()
  expect(child.linkedPullRequests).toContainEqual({
    number: 42,
    url: pullRequest.url,
    repositoryUrl: pullRequest.repositoryUrl,
    title: 'Source pull request',
  })
})

it('creates a separate General conversation without changing a settled parent', async () => {
  const setupData = await setup()
  const s = setupData.services
  const scratch = await s.scratch.ensure()
  const parent = s.tasks.create({
    title: 'General parent',
    repositoryId: scratch.id,
    agentId: 'agent',
    objective: 'Previous context',
    linkedCheckouts: [{ id: 'reference', repositoryId: 'repo', execution: 'main', access: 'edit' }],
  })
  s.store.updateTask(parent.id, (task) => ({
    ...task,
    status: 'done',
    archived: true,
    draft: 'Existing draft',
  }))
  const settledAt = s.store.task(parent.id).settledAt
  const parentDirectory = await s.checkouts.directory(parent.id)
  await writeFile(join(parentDirectory, 'private.txt'), 'parent only')
  const childId = randomUUID()
  const run = vi.fn<() => Promise<void>>(async () => {})
  const getAgent = vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: async () => ({ provider: 'codex', available: true, detail: '' }),
    run,
  })
  expect(
    (await setupData.call('create', { id: parent.id, childId, objective: 'Investigate' })).status,
  ).toBe(200)
  expect(s.store.task(parent.id)).toMatchObject({
    archived: true,
    status: 'done',
    settledAt,
    draft: 'Existing draft',
  })
  const child = s.store.task(childId)
  expect(child).toMatchObject({
    status: 'draft',
    execution: 'main',
    sideThread: { source: 'scratch' },
    linkedCheckouts: [{ id: 'reference', access: 'read-only' }],
  })
  expect(child.messages[0]?.text).toBe('Previous context')
  expect(run).not.toHaveBeenCalled()
  const childDirectory = await s.checkouts.directory(childId)
  expect(childDirectory).not.toBe(parentDirectory)
  await expect(readFile(join(childDirectory, 'private.txt'))).rejects.toMatchObject({
    code: 'ENOENT',
  })
  getAgent.mockResolvedValue({
    probe: async () => ({ provider: 'codex', available: true, detail: '' }),
    run: async (input) => input.onText('General result'),
  })
  await s.tasks.send(childId, randomUUID(), 'Investigate')
  await waitForRuntime(() => expect(s.store.task(childId).status).toBe('review'))
  expect(
    (await setupData.call('bring-back', { id: childId, expectedDraft: 'Existing draft' })).status,
  ).toBe(200)
  expect(s.store.task(parent.id)).toMatchObject({ archived: true, status: 'done', settledAt })
  expect(s.store.task(parent.id).draft).toContain('General result')
  expect(s.store.task(parent.id).draft).toContain(`Scratch directory: ${childDirectory}`)
  expect(s.store.task(parent.id).draft).toContain('Git: not applicable')
})

it('does not execute when the parent permission ceiling is narrowed', async () => {
  const setupData = await setup()
  const s = setupData.services
  const parent = s.tasks.create({
    title: 'Parent',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: '',
    agentOverrides: { permission: 'workspace-write' },
  })
  const childId = randomUUID()
  expect((await setupData.call('create', { id: parent.id, childId })).status).toBe(200)
  s.store.updateTask(parent.id, (task) => ({
    ...task,
    agentOverrides: { ...task.agentOverrides, permission: 'read-only' },
  }))
  const run = vi.fn<() => Promise<void>>(async () => {})
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: async () => ({ provider: 'codex', available: true, detail: '' }),
    run,
  })
  await expect(s.tasks.send(childId, randomUUID(), 'Try running')).rejects.toThrow(
    'permissions cannot exceed',
  )
  expect(run).not.toHaveBeenCalled()
  expect(s.store.task(childId).checkoutBranch).toBeUndefined()
})

it('rejects orphan execution and settings after parent deletion and restart', async () => {
  const setupData = await setup()
  const s = setupData.services
  const parent = s.tasks.create({
    title: 'Parent',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: '',
    agentOverrides: { permission: 'workspace-write' },
  })
  const unrestrictedChild = randomUUID()
  const readOnlyChild = randomUUID()
  expect(
    (await setupData.call('create', { id: parent.id, childId: unrestrictedChild })).status,
  ).toBe(200)
  expect((await setupData.call('create', { id: parent.id, childId: readOnlyChild })).status).toBe(
    200,
  )
  s.store.updateTask(parent.id, (task) => ({
    ...task,
    agentOverrides: { ...task.agentOverrides, permission: 'read-only' },
  }))
  s.store.update((workspace) => ({
    ...workspace,
    tasks: workspace.tasks.filter((task) => task.id !== parent.id),
  }))
  const restarted = await setupData.restart()
  expect(restarted.store.task(unrestrictedChild).sideThread?.parentTaskId).toBe(parent.id)
  expect(() =>
    restarted.store.updateTask(unrestrictedChild, (task) => ({
      ...task,
      agentOverrides: { ...task.agentOverrides, permission: 'full-access' },
    })),
  ).toThrow('cannot exceed')
  const run = vi.fn<(input: import('../execution/types.js').AgentRun) => Promise<void>>(
    async (input) => {
      input.onText('Done')
    },
  )
  vi.spyOn(restarted.agents, 'get').mockResolvedValue({
    probe: async () => ({ provider: 'codex', available: true, detail: '' }),
    run,
  })
  await expect(
    restarted.tasks.send(unrestrictedChild, randomUUID(), 'Try wider access'),
  ).rejects.toThrow('permissions cannot exceed')
  expect(run).not.toHaveBeenCalled()
  expect(restarted.store.task(unrestrictedChild).checkoutBranch).toBeUndefined()
  expect(() =>
    restarted.store.updateTask(readOnlyChild, (task) => ({
      ...task,
      agentOverrides: { ...task.agentOverrides, permission: 'read-only' },
    })),
  ).toThrow('cannot exceed')
  expect(() =>
    restarted.store.updateTask(readOnlyChild, (task) => ({
      ...task,
      draftTurnSettings: { provider: 'codex', model: 'example', reasoning: '' },
    })),
  ).toThrow('cannot exceed')
  expect(
    await setupData.lifecycle({ id: readOnlyChild, action: 'delete', removeWorktrees: false }),
  ).toBe(200)
  expect(restarted.store.get().tasks.some((task) => task.id === readOnlyChild)).toBe(false)
})

it('uses committed HEAD and completed context while the parent is actively running', async () => {
  const setupData = await setup()
  const s = setupData.services
  const parent = s.tasks.create({
    title: 'Active parent',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'First request',
  })
  let release!: () => void
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  let calls = 0
  let childContents = ''
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: async () => ({ provider: 'codex', available: true, detail: '' }),
    run: async (run) => {
      if (++calls === 1) run.onText('Completed answer')
      else if (calls === 2) {
        run.onPromptAccepted?.()
        await pending
        run.onText('Later answer')
      } else {
        childContents = await readFile(join(run.cwd, 'hello.txt'), 'utf8')
        cleanups.push(() => rm(run.cwd, { recursive: true, force: true }))
        run.onText('Independent result')
      }
    },
  })
  await (
    await s.tasks.start(parent.id)
  ).done
  const attachment = await s.attachments.upload({
    id: randomUUID(),
    taskId: parent.id,
    name: 'evidence.txt',
    data: Buffer.from('evidence').toString('base64'),
  })
  s.store.updateTaskHistory(parent.id, (task) => ({
    ...task,
    messages: task.messages.map((message, index) =>
      index === 0 ? { ...message, attachments: [attachment.attachment] } : message,
    ),
  }))
  await s.tasks.send(parent.id, randomUUID(), 'Still running')
  try {
    await waitForRuntime(() => expect(s.store.task(parent.id).runPhase).toBe('provider'))
    await writeFile(join(setupData.fixtureData.directory, 'hello.txt'), 'in-flight change\n')
    const childId = randomUUID()
    expect(await setupData.call('create', { id: parent.id, childId })).toMatchObject({
      status: 200,
    })
    const child = s.store.task(childId)
    expect(child.sideThread?.source).toBe('head')
    expect(child.messages.map((message) => message.text)).toContain('Completed answer')
    expect(child.messages.map((message) => message.text)).not.toContain('Still running')
    const copied = child.messages[0]?.attachments?.[0]
    expect(copied?.id).not.toBe(attachment.attachment.id)
    expect(s.attachments.read(childId, copied?.id ?? '').data).toBe(
      Buffer.from('evidence').toString('base64'),
    )
    expect(child.forkedFrom?.snapshot).toBeUndefined()
    await s.tasks.send(childId, randomUUID(), 'Work independently')
    await waitForRuntime(() => expect(s.store.task(childId).status).toBe('review'))
    expect(childContents).toBe('original\n')
    expect(s.store.task(parent.id).status).toBe('running')
    expect((await setupData.call('bring-back', { id: childId })).status).toBe(409)
  } finally {
    release()
    await waitForRuntime(() => expect(s.store.task(parent.id).status).toBe('review'))
  }
})
