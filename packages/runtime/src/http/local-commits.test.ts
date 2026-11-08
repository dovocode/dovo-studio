import { afterEach, expect, it, vi } from 'vite-plus/test'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { startRuntime } from '../index.js'
import { fixture } from '../testing/fixture.js'
import { runtimeIntegration } from '../testing/integration.js'
import { decode, localCommitsSchema, responses, reviewProgressSchema } from '@dovo/protocol'

vi.setConfig(runtimeIntegration)
const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const close of cleanup.splice(0).reverse()) await close()
})

it('authenticates commit reads, never prepares a checkout and keeps viewed marks separate per commit', async () => {
  const f = await fixture()
  cleanup.push(f.cleanup)
  const token = 'local-commits-test-owner-token-at-least-32-characters'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  cleanup.push(runtime.close)
  const s = runtime.services
  s.store.update(() => f.workspace)
  const task = s.tasks.create({
    title: 'Review commits',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: '',
  })
  s.store.updateTask(task.id, (current) => ({ ...current, execution: 'worktree' }))
  const prepare = vi
    .spyOn(s.checkouts, 'directory')
    .mockRejectedValue(new Error('A read must never prepare a checkout'))
  const post = (path: string, data: Record<string, unknown>, credential = token) =>
    fetch(`http://127.0.0.1:${runtime.port}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...(path.startsWith('/api/tasks/') ? { id: task.id } : {}), ...data }),
    })
  expect((await post('/api/tasks/commits/read', {}, 'wrong')).status).toBe(401)
  const listing = await post('/api/tasks/commits/read', {})
  expect(listing.status).toBe(200)
  const first = decode(localCommitsSchema, await listing.json()).commits[0]
  await writeFile(join(f.directory, 'hello.txt'), 'next\n')
  await s.git.stage(f.directory, ['hello.txt'])
  const second = await s.git.commit(f.directory, 'Next')
  const changes = await post('/api/tasks/commits/changes', { sha: second })
  expect(changes.status).toBe(200)
  expect(decode(responses.files, await changes.json()).files[0]).toMatchObject({
    before: 'original\n',
    after: 'next\n',
  })
  const previewInput = { sha: second, path: 'hello.txt' }
  const ordinaryPreview = await post('/api/tasks/commits/file-preview', previewInput)
  expect(ordinaryPreview.status).toBe(200)
  expect(await ordinaryPreview.json()).not.toHaveProperty('patch')
  const patchedPreview = await post('/api/tasks/commits/file-preview', {
    ...previewInput,
    patch: true,
  })
  expect(patchedPreview.status).toBe(200)
  expect((await patchedPreview.json()).patch).toContain('+next')
  const expandedPreview = await post('/api/tasks/commits/file-preview', {
    ...previewInput,
    full: true,
  })
  expect(await expandedPreview.json()).not.toHaveProperty('patch')
  expect(
    (await post('/api/tasks/commits/file-preview', { ...previewInput, patch: 'true' })).status,
  ).toBe(400)
  const context = { kind: 'task', taskId: task.id, source: 'commit', commitSha: second }
  const progress = await post('/api/review/read', { context })
  expect(progress.status).toBe(200)
  const mark = decode(reviewProgressSchema, await progress.json()).files[0]
  const marked = await post('/api/review/set', { context, ...mark, viewed: true })
  expect(marked.status).toBe(200)
  const original = await post('/api/review/read', { context: { ...context, commitSha: first.sha } })
  expect(decode(reviewProgressSchema, await original.json()).files[0].viewed).toBe(false)
  expect((await post('/api/tasks/commits/changes', { sha: '--all' })).status).toBe(400)
  expect(
    (await post('/api/tasks/commits/changes', { sha: second, checkoutId: 'not-linked' })).status,
  ).toBe(404)
  expect((await post('/api/tasks/commits/read', { id: 'missing-task' })).status).toBe(404)
  expect(
    (await post('/api/review/read', { context: { ...context, commitSha: undefined } })).status,
  ).toBe(400)
  expect(prepare).not.toHaveBeenCalled()
  expect(
    (await s.git.command(f.directory, ['worktree', 'list', '--porcelain'])).match(/^worktree /gm),
  ).toHaveLength(1)
})
