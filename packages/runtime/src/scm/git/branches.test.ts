import { afterEach, expect, it, vi } from 'vitest'
import { canChangeTaskCheckout } from '@dovo/protocol'
import { writeFile, rm, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { fixture } from '../../testing/fixture'
import { startRuntime } from '../../index'
import { listBranches, switchBranch } from './branches'
import { WorkspaceStore } from '../../storage/workspace'
import { openDatabase } from '../../storage/database'
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
async function setup() {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const runtime = await startRuntime({
    databasePath: ':memory:',
    ownerToken: 'branch-test-owner-token-with-32-characters',
    port: 0,
  })
  cleanups.push(runtime.close)
  runtime.services.store.update(() => f.workspace)
  return { s: runtime.services, cwd: await realpath(f.directory) }
}
it('switches local and remote branches, creates branches, and clears only affected session context', async () => {
  const { s, cwd } = await setup()
  const task = s.tasks.create({
    title: 'Task',
    agentId: 'agent',
    repositoryId: 'repo',
    objective: 'Keep conversation',
  })
  s.store.updateTask(task.id, (t) => ({
    ...t,
    sessionId: 'old',
    queue: [{ id: 'queued', role: 'user', text: 'Next', createdAt: new Date().toISOString() }],
  }))
  const first = await listBranches(s, cwd)
  await switchBranch(s, cwd, undefined, {
    action: 'create',
    name: 'feature/attachments',
    revision: first.revision,
  })
  expect(s.store.task(task.id)).toMatchObject({
    checkoutBranch: 'feature/attachments',
    queuePaused: true,
    messages: task.messages,
  })
  expect(s.store.task(task.id).sessionId).toBeUndefined()
  await expect(
    switchBranch(s, cwd, undefined, {
      action: 'switch',
      name: `refs/heads/${first.current}`,
      revision: first.revision,
    }),
  ).rejects.toThrow('Checkout changed')
  await s.git.command(cwd, ['update-ref', 'refs/remotes/origin/review', 'HEAD'])
  await s.git.command(cwd, ['config', 'remote.origin.url', cwd])
  await s.git.command(cwd, ['config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*'])
  const remote = await listBranches(s, cwd)
  expect(remote.branches.find((b) => b.name === 'origin/review')?.remote).toBe(true)
  await switchBranch(s, cwd, undefined, {
    action: 'switch',
    name: 'refs/remotes/origin/review',
    revision: remote.revision,
  })
  expect((await s.git.inspect(cwd)).branch).toBe('review')
  await switchBranch(s, cwd, undefined, {
    action: 'switch',
    name: `refs/heads/${first.current}`,
    revision: (await listBranches(s, cwd)).revision,
  })
  expect((await s.git.inspect(cwd)).branch).toBe(first.current)
})
it('keeps unsent drafts checkout-editable after the project branch changes', async () => {
  const { s, cwd } = await setup()
  const task = s.tasks.create({
    title: 'Unsent',
    agentId: 'agent',
    repositoryId: 'repo',
    execution: 'main',
    objective: '',
  })
  await switchBranch(s, cwd, task.id, {
    action: 'create',
    name: 'feature/unsent',
    revision: (await listBranches(s, cwd)).revision,
  })
  expect(canChangeTaskCheckout(s.store.task(task.id))).toBe(true)
  for (const execution of ['worktree', 'main'] as const) {
    s.store.patch({
      collection: 'tasks',
      id: task.id,
      changes: { execution: { before: s.store.task(task.id).execution, after: execution } },
    })
    expect(canChangeTaskCheckout(s.store.task(task.id))).toBe(true)
  }
  expect(s.store.task(task.id).execution).toBe('main')
  expect(s.store.get().repositories.find((repo) => repo.id === 'repo')?.branch).toBe(
    'feature/unsent',
  )
})
it('recovers legacy branch metadata on untouched local drafts without unlocking prepared tasks', () => {
  const db = openDatabase(':memory:')
  try {
    const store = new WorkspaceStore(db)
    const draft = {
      id: 'draft',
      title: 'Unsent',
      repositoryId: 'repo',
      agentId: '',
      status: 'draft' as const,
      execution: 'main' as const,
      createdAt: '',
      messages: [],
      files: [],
      draft: 'Keep my unsent input',
      example: false,
      checkoutBranch: 'feature/local',
    }
    store.update((w) => ({
      ...w,
      tasks: [
        draft,
        { ...draft, id: 'worktree', execution: 'worktree' },
        { ...draft, id: 'submitted', checkoutLocked: true },
      ],
    }))
    const restored = new WorkspaceStore(db)
    expect(canChangeTaskCheckout(restored.task('draft'))).toBe(true)
    expect(restored.task('draft').draft).toBe(draft.draft)
    expect(restored.task('draft').checkoutBranch).toBeUndefined()
    expect(canChangeTaskCheckout(restored.task('worktree'))).toBe(false)
    expect(canChangeTaskCheckout(restored.task('submitted'))).toBe(false)
    expect(new WorkspaceStore(db).task('draft').checkoutBranch).toBeUndefined()
  } finally {
    db.close()
  }
})
it('refuses dirty checkouts and running agents; task worktree changes leave the project untouched', async () => {
  const { s, cwd } = await setup()
  const task = s.tasks.create({
    title: 'Isolated',
    agentId: 'agent',
    repositoryId: 'repo',
    execution: 'worktree',
    objective: 'Test',
  })
  const worktree = await s.checkouts.directory(task.id)
  cleanups.push(() => rm(worktree, { recursive: true, force: true }))
  const original = (await s.git.inspect(cwd)).branch
  await writeFile(join(worktree, 'hello.txt'), 'Keep this change')
  const input = {
    action: 'create',
    name: 'feature/review',
    revision: (await listBranches(s, worktree)).revision,
  }
  await expect(switchBranch(s, worktree, task.id, input)).rejects.toThrow('Commit or stash')
  await s.git.command(worktree, ['add', 'hello.txt'])
  await s.git.command(worktree, ['commit', '-m', 'Keep work'])
  s.store.updateTask(task.id, (t) => ({
    ...t,
    files: [
      {
        path: 'hello.txt',
        before: 'Original',
        after: 'Unsaved draft',
        diskContents: 'Keep this change',
        viewed: false,
      },
    ],
  }))
  await expect(
    switchBranch(s, worktree, task.id, {
      ...input,
      revision: (await listBranches(s, worktree)).revision,
    }),
  ).rejects.toThrow('Apply or discard saved diff drafts')
  expect(s.store.task(task.id).files[0].after).toBe('Unsaved draft')
  s.store.updateTask(task.id, (t) => ({ ...t, files: [] }))
  await switchBranch(s, worktree, task.id, {
    ...input,
    revision: (await listBranches(s, worktree)).revision,
  })
  expect((await s.git.inspect(cwd)).branch).toBe(original)
  expect(s.store.get().repositories[0].branch).toBe('main')
  expect(s.store.task(task.id).checkoutBranch).toBe('feature/review')
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: async () => ({ provider: 'codex', available: true, detail: '' }),
    run: async (run) => {
      await new Promise<void>((resolve) =>
        run.signal.addEventListener('abort', () => resolve(), { once: true }),
      )
      run.signal.throwIfAborted()
    },
  })
  const execution = await s.tasks.start(task.id)
  await expect(switchBranch(s, worktree, task.id, input)).rejects.toThrow('running agent')
  s.tasks.cancel(task.id)
  await expect(execution.done).rejects.toThrow('Cancelled')
})
