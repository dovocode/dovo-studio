import { afterEach, expect, it, vi } from 'vitest'
import { readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { startRuntime } from '../../index'
import { fixture } from '../../testing/fixture'
import { exec } from '../../process'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
async function setup() {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const ownerToken = 'quality-test-owner-token-at-least-32-characters'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken, port: 0 })
  cleanups.push(() => runtime.close())
  const s = runtime.services
  s.commands.save({ ...s.commands.get(), shell: '/bin/sh', shellArgs: [] })
  s.store.update(() => f.workspace)
  const call = async (path: string, input: unknown) => {
    const response = await fetch(`http://127.0.0.1:${runtime.port}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    return { status: response.status, body: (await response.json()) as Record<string, unknown> }
  }
  return { f, s, call }
}
const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  )

it('undoes and redoes a turn’s file changes without touching the branch or index', async () => {
  const { f, s, call } = await setup()
  await writeFile(join(f.directory, 'gone.txt'), 'will be deleted\n')
  await exec('git', ['add', 'gone.txt'], { cwd: f.directory })
  const task = s.tasks.create({
    title: 'Undo',
    agentId: 'agent',
    repositoryId: 'repo',
    objective: 'Change files',
  })
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: async () => ({ provider: 'codex', available: true, detail: '' }),
    run: async (run) => {
      await writeFile(join(run.cwd, 'hello.txt'), 'agent edit\n')
      await writeFile(join(run.cwd, 'new.txt'), 'created\n')
      await rm(join(run.cwd, 'gone.txt'))
    },
  })
  await (
    await s.tasks.start(task.id)
  ).done
  const turnId = s.store.task(task.id).turns?.at(-1)?.id ?? ''
  const head = (await exec('git', ['rev-parse', 'HEAD'], { cwd: f.directory })).stdout
  const staged = (await exec('git', ['diff', '--cached', '--name-only'], { cwd: f.directory }))
    .stdout
  // A later manual edit is kept by redo.
  await writeFile(join(f.directory, 'new.txt'), 'created and edited\n')

  expect(
    (await call('/api/tasks/turn/restore', { id: task.id, turnId, direction: 'undo' })).status,
  ).toBe(200)
  expect(await readFile(join(f.directory, 'hello.txt'), 'utf8')).toBe('original\n')
  expect(await exists(join(f.directory, 'new.txt'))).toBe(false)
  expect(await readFile(join(f.directory, 'gone.txt'), 'utf8')).toBe('will be deleted\n')
  expect((await exec('git', ['rev-parse', 'HEAD'], { cwd: f.directory })).stdout).toBe(head)
  expect(
    (await exec('git', ['diff', '--cached', '--name-only'], { cwd: f.directory })).stdout,
  ).toBe(staged)
  const undone = s.store.task(task.id)
  expect(undone.turns?.at(-1)?.checkpoint?.undone).toBeDefined()
  expect(undone.messages.at(-1)?.text).toContain('I undid the file changes')

  expect(
    (await call('/api/tasks/turn/restore', { id: task.id, turnId, direction: 'redo' })).status,
  ).toBe(200)
  expect(await readFile(join(f.directory, 'hello.txt'), 'utf8')).toBe('agent edit\n')
  expect(await readFile(join(f.directory, 'new.txt'), 'utf8')).toBe('created and edited\n')
  expect(await exists(join(f.directory, 'gone.txt'))).toBe(false)
  expect(s.store.task(task.id).turns?.at(-1)?.checkpoint?.undone).toBeUndefined()
})

it('runs a chat command in the task terminal, lists files for mentions, and removes unsent comments', async () => {
  const { f, s, call } = await setup()
  await writeFile(join(f.directory, 'notes.md'), 'untracked\n')
  const task = s.tasks.create({
    title: 'Tools',
    agentId: 'agent',
    repositoryId: 'repo',
    objective: '',
  })
  const files = await call('/api/tasks/files', { id: task.id, query: 'not' })
  expect(files.body.files).toEqual(['notes.md'])
  const listed = await call('/api/tasks/files/list', { id: task.id })
  expect(listed.status).toBe(200)
  expect(listed.body.files).toContain('notes.md')
  const preview = await call('/api/tasks/files/read', { id: task.id, path: 'notes.md' })
  expect(preview.body).toEqual({ path: 'notes.md', contents: 'untracked\n' })
  const written = await call('/api/tasks/files/write', {
    id: task.id,
    path: 'notes.md',
    expectedContents: 'untracked\n',
    contents: 'edited\n',
  })
  expect(written.body).toEqual({ path: 'notes.md', contents: 'edited\n' })
  expect(await readFile(join(f.directory, 'notes.md'), 'utf8')).toBe('edited\n')
  expect(
    (
      await call('/api/tasks/files/write', {
        id: task.id,
        path: 'notes.md',
        expectedContents: 'untracked\n',
        contents: 'stale edit\n',
      })
    ).status,
  ).toBe(409)
  expect((await call('/api/tasks/files/read', { id: task.id, path: '../outside' })).status).toBe(
    400,
  )

  const first = await call('/api/terminals/run', {
    taskId: task.id,
    command: 'printf dovo-ran > ran.txt',
  })
  expect(first.status).toBe(200)
  const again = await call('/api/terminals/run', { taskId: task.id, command: 'true' })
  // The same open terminal is reused.
  expect(again.body.id).toBe(first.body.id)
  const separate = await call('/api/terminals/run', {
    taskId: task.id,
    command: 'true',
    newTerminal: true,
  })
  expect(separate.status).toBe(200)
  expect(separate.body.id).not.toBe(first.body.id)
  await vi.waitFor(
    async () => expect(await readFile(join(f.directory, 'ran.txt'), 'utf8')).toBe('dovo-ran'),
    {
      timeout: 5000,
    },
  )

  s.store.updateTask(task.id, (value) => ({
    ...value,
    files: [{ path: 'hello.txt', before: 'original\n', after: 'original\n', viewed: false }],
  }))
  expect(
    (
      await call('/api/tasks/feedback', {
        id: task.id,
        path: 'hello.txt',
        side: 'additions',
        start: 1,
        end: 1,
        excerpt: 'original',
        body: 'Rename this',
      })
    ).status,
  ).toBe(200)
  const comment = s.store.task(task.id).messages.at(-1)
  expect(comment?.diffComment?.body).toBe('Rename this')
  expect(
    (await call('/api/tasks/feedback/remove', { id: task.id, messageId: comment?.id })).status,
  ).toBe(200)
  expect(s.store.task(task.id).messages.some((message) => message.id === comment?.id)).toBe(false)
})

it('moves a task into its own worktree with its uncommitted changes, and back', async () => {
  const { f, s, call } = await setup()
  await exec('git', ['branch', '-M', 'main'], { cwd: f.directory })
  const task = s.tasks.create({
    title: 'Handoff',
    agentId: 'agent',
    repositoryId: 'repo',
    objective: 'Work',
  })
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: async () => ({ provider: 'codex', available: true, detail: '' }),
    run: async () => {},
  })
  await (
    await s.tasks.start(task.id)
  ).done
  // Uncommitted work of every kind: modified, staged new file, untracked file.
  await writeFile(join(f.directory, 'hello.txt'), 'edited in place\n')
  await writeFile(join(f.directory, 'staged.txt'), 'staged\n')
  await exec('git', ['add', 'staged.txt'], { cwd: f.directory })
  await writeFile(join(f.directory, 'untracked.txt'), 'untracked\n')

  const moved = await call('/api/tasks/handoff', { id: task.id, target: 'worktree' })
  expect(moved.status).toBe(200)
  const worktree = String(moved.body.cwd)
  cleanups.push(() => rm(worktree, { recursive: true, force: true }))
  expect(worktree).not.toBe(f.directory)
  expect(s.store.task(task.id).execution).toBe('worktree')
  expect(await readFile(join(worktree, 'hello.txt'), 'utf8')).toBe('edited in place\n')
  expect(await readFile(join(worktree, 'untracked.txt'), 'utf8')).toBe('untracked\n')
  expect(
    (await exec('git', ['diff', '--cached', '--name-only'], { cwd: worktree })).stdout.trim(),
  ).toBe('staged.txt')
  // The project folder is clean again, and no stash entry is left behind.
  expect((await exec('git', ['status', '--porcelain'], { cwd: f.directory })).stdout).toBe('')
  expect((await exec('git', ['stash', 'list'], { cwd: f.directory })).stdout).toBe('')

  const back = await call('/api/tasks/handoff', { id: task.id, target: 'main' })
  expect(back.status).toBe(200)
  const branch = (
    await exec('git', ['branch', '--show-current'], { cwd: f.directory })
  ).stdout.trim()
  expect(branch).toBe(s.store.task(task.id).checkoutBranch)
  expect(branch).not.toBe('main')
  expect(await readFile(join(f.directory, 'hello.txt'), 'utf8')).toBe('edited in place\n')
  expect(await exists(worktree)).toBe(false)
  expect(s.store.task(task.id).execution).toBe('main')
  expect(s.store.task(task.id).messages.at(-1)?.text).toContain('moved this task back')
})

it('adds a mentioned skill to that turn’s prompt even when it is not enabled', async () => {
  const { f, s } = await setup()
  s.store.update((workspace) => ({
    ...workspace,
    repositories: workspace.repositories.map((repository) => ({
      ...repository,
      resources: {
        mcpServers: [],
        skills: [
          {
            name: 'release-notes',
            description: 'Write release notes',
            enabled: false,
            content: 'Group changes by user impact.',
          },
        ],
      },
    })),
  }))
  const prompts: string[] = []
  const instructions: string[] = []
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: async () => ({ provider: 'codex', available: true, detail: '' }),
    run: async (run) => {
      prompts.push(run.prompt)
      instructions.push(run.agent.instructions)
    },
  })
  const task = s.tasks.create({
    title: 'Notes',
    agentId: 'agent',
    repositoryId: 'repo',
    objective: '/release-notes for this week',
  })
  await (
    await s.tasks.start(task.id)
  ).done
  expect(prompts[0]).toContain('Group changes by user impact.')
  // Disabled skills stay out of the agent's standing instructions.
  expect(instructions[0]).not.toContain('Group changes by user impact.')
  expect(f.directory).toBeTruthy()
})

it('reverts one file, forks from a turn with its files, retries, and marks review requests', async () => {
  const { f, s, call } = await setup()
  const prompts: string[] = []
  let attempt = 0
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: async () => ({ provider: 'codex', available: true, detail: '' }),
    run: async (run) => {
      prompts.push(run.prompt)
      attempt++
      await writeFile(join(run.cwd, 'hello.txt'), `attempt ${attempt}\n`)
      await writeFile(join(run.cwd, 'other.txt'), `other ${attempt}\n`)
    },
  })
  const task = s.tasks.create({
    title: 'Many',
    agentId: 'agent',
    repositoryId: 'repo',
    objective: 'Edit',
  })
  await (
    await s.tasks.start(task.id)
  ).done
  const turnId = s.store.task(task.id).turns?.at(-1)?.id ?? ''

  // One file back to before the turn; the other keeps the agent's edit.
  expect(
    (await call('/api/tasks/file/restore', { id: task.id, path: 'hello.txt', turnId })).status,
  ).toBe(200)
  expect(await readFile(join(f.directory, 'hello.txt'), 'utf8')).toBe('original\n')
  expect(await readFile(join(f.directory, 'other.txt'), 'utf8')).toBe('other 1\n')
  // Discard to the last commit: the untracked file disappears.
  expect((await call('/api/tasks/file/restore', { id: task.id, path: 'other.txt' })).status).toBe(
    200,
  )
  expect(await exists(join(f.directory, 'other.txt'))).toBe(false)

  // Fork from the turn: a draft with the conversation, in a worktree holding that turn's files.
  const forked = await call('/api/tasks/fork', { id: task.id, turnId })
  expect(forked.status).toBe(200)
  const fork = s.store.task(String(forked.body.id))
  expect(fork).toMatchObject({ status: 'draft', execution: 'worktree' })
  expect(fork.messages.map((message) => message.role)).toEqual(['user', 'assistant'])
  const forkCwd = await s.checkouts.directory(fork.id)
  cleanups.push(() => rm(forkCwd, { recursive: true, force: true }))
  expect(await readFile(join(forkCwd, 'hello.txt'), 'utf8')).toBe('attempt 1\n')
  expect(await readFile(join(forkCwd, 'other.txt'), 'utf8')).toBe('other 1\n')
  expect(s.store.task(fork.id).forkedFrom?.snapshot).toBeUndefined()

  // Try again with another model: the request is repeated and the model override is set.
  expect((await call('/api/tasks/retry', { id: task.id, turnId, model: 'gpt-other' })).status).toBe(
    200,
  )
  await vi.waitFor(() => expect(s.store.task(task.id).status).not.toBe('running'), {
    timeout: 10000,
  })
  expect(s.store.task(task.id).agentOverrides?.model).toBe('gpt-other')
  expect(prompts.at(-1)).toContain('Try this again from scratch')
  expect(prompts.at(-1)).toContain('Edit')

  // A review request carries the review instructions in the prompt.
  expect(
    (
      await call('/api/tasks/message', {
        id: task.id,
        messageId: 'review-1',
        text: 'Review the changes so far.',
        review: true,
      })
    ).status,
  ).toBe(200)
  await vi.waitFor(() => expect(prompts).toHaveLength(3), { timeout: 10000 })
  expect(prompts.at(-1)).toContain('Review mode:')
})
