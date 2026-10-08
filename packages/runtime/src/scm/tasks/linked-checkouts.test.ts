import { afterEach, expect, it, vi } from 'vite-plus/test'
import { readFile, writeFile, rm, realpath, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runClientEffect } from '@dovo/client-runtime'
import { startRuntime } from '../../index.js'
import { fixture } from '../../testing/fixture.js'
import { runtimeIntegration, waitForRuntime } from '../../testing/integration.js'
import { listWorktreesEffect, removeWorktreeEffect } from '../git/worktrees.js'
import type { AgentAdapter } from '../../agents/execution/types.js'
import type { Automation } from '@dovo/protocol'

vi.setConfig(runtimeIntegration)
function barrier() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
async function setup() {
  const primary = await fixture()
  const secondary = await fixture()
  cleanups.push(primary.cleanup, secondary.cleanup)
  const runtime = await startRuntime({
    databasePath: ':memory:',
    ownerToken: 'linked-projects-test-token-at-least-32-chars',
    port: 0,
  })
  cleanups.push(() => runtime.close())
  const s = runtime.services
  s.store.update(() => ({
    ...primary.workspace,
    repositories: [
      ...primary.workspace.repositories,
      { ...secondary.workspace.repositories[0], id: 'backend', name: 'Backend' },
    ],
  }))
  return { s, primary, secondary }
}

it('keeps long linked identities protected and restores saved history after clean removal and a root change', async () => {
  const { s } = await setup()
  const root = await mkdtemp(join(tmpdir(), 'dovo-linked-history-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  s.preferences.save({ worktreesRoot: join(root, 'first') })
  const task = s.tasks.create({
    title: 'History',
    agentId: 'agent',
    repositoryId: 'repo',
    objective: 'Work',
    linkedCheckouts: [
      {
        id: 'link',
        repositoryId: 'backend',
        execution: 'worktree',
        access: 'edit',
        branch: `feature/${'long'.repeat(40)}`,
      },
    ],
  })
  const [link] = await s.checkouts.linked.resolve(task.id)
  expect((await runClientEffect(listWorktreesEffect(s))).worktrees).toContainEqual(
    expect.objectContaining({ path: link.directory, taskId: task.id, state: 'active' }),
  )
  const before = await s.git.snapshot(link.directory, 'refs/dovo/checkpoints/linked-history/before')
  await writeFile(join(link.directory, 'hello.txt'), 'saved history\n')
  const after = await s.git.snapshot(link.directory, 'refs/dovo/checkpoints/linked-history/after')
  const checkpoint = {
    checkoutId: link.id,
    repositoryId: link.repositoryId,
    directory: link.directory,
    branch: link.branch,
    before,
    after,
    ...(await s.git.checkpointChanges(link.directory, before, after)),
  }
  await s.git.stage(link.directory, ['hello.txt'])
  await s.git.commit(link.directory, 'Save linked work')
  s.store.updateTask(task.id, (current) => ({
    ...current,
    archivedAt: new Date().toISOString(),
    turns: [
      {
        id: 'turn',
        assistantId: 'reply',
        agentId: 'agent',
        provider: 'codex',
        model: 'fixture',
        status: 'completed',
        startedAt: new Date().toISOString(),
        checkpoint: { before: '', files: [], omitted: [], linked: [checkpoint] },
      },
    ],
  }))
  await runClientEffect(removeWorktreeEffect(s, link.directory))
  s.preferences.save({ worktreesRoot: join(root, 'second') })
  // History survives removal of the link from today's task settings too.
  s.store.updateTask(task.id, (current) => ({
    ...current,
    archivedAt: undefined,
    linkedCheckouts: [],
  }))
  expect((await s.tasks.filePreview(task.id, 'hello.txt', 'turn', 'link')).after?.text).toBe(
    'saved history\n',
  )
  await s.tasks.restoreTurn(task.id, 'turn', 'undo')
  const restored = await s.checkouts.linked.checkpointDirectory(checkpoint, true)
  expect(restored.startsWith(join(root, 'second'))).toBe(true)
  expect(await readFile(join(restored, 'hello.txt'), 'utf8')).toBe('original\n')
  await s.tasks.restoreTurn(task.id, 'turn', 'redo')
  expect(await readFile(join(restored, 'hello.txt'), 'utf8')).toBe('saved history\n')
})

it.each([
  { direction: 'git-to-folder', nestedExplicit: false },
  { direction: 'git-to-folder', nestedExplicit: true },
  { direction: 'folder-to-git', nestedExplicit: false },
  { direction: 'folder-to-git', nestedExplicit: true },
])(
  'uses selected checkout Git capability for $direction children (nested explicit: $nestedExplicit)',
  async ({ direction, nestedExplicit }) => {
    const { s, secondary } = await setup()
    const folder = await mkdtemp(join(tmpdir(), 'dovo-linked-folder-'))
    cleanups.push(() => rm(folder, { recursive: true, force: true }))
    s.store.update((workspace) => ({
      ...workspace,
      repositories: [
        ...workspace.repositories,
        { id: 'folder', name: 'Folder', path: folder, kind: 'folder', branch: '' },
      ],
    }))
    const git = direction === 'folder-to-git'
    const selectedDirectory = await realpath(git ? secondary.directory : folder)
    let childId = ''
    let nestedId = ''
    const childRuns: Array<{ id: string; cwd: string }> = []
    vi.spyOn(s.agents, 'get').mockResolvedValue({
      probe: vi.fn<AgentAdapter['probe']>(),
      run: async (run) => {
        if (!run.taskId) throw new Error('Expected task ID')
        if (run.agent.provider === 'codex') {
          childId = s.tasks.subagentSpawn({
            taskId: run.taskId,
            key: 'selected',
            name: 'Selected',
            prompt: 'Work in the linked checkout',
            provider: 'claude',
            checkoutId: 'selected',
          }).id
          await s.tasks.subagentWait(run.taskId, childId)
        } else {
          childRuns.push({ id: run.taskId, cwd: run.cwd })
          if (run.agent.provider === 'claude') {
            nestedId = s.tasks.subagentSpawn({
              taskId: run.taskId,
              key: 'nested',
              name: 'Nested',
              prompt: 'Use the current checkout',
              provider: 'opencode',
              checkoutId: nestedExplicit ? 'selected' : undefined,
            }).id
            await s.tasks.subagentWait(run.taskId, nestedId)
            await writeFile(join(run.cwd, 'hello.txt'), 'selected child write\n')
          } else await writeFile(join(run.cwd, 'nested.txt'), 'nested child write\n')
        }
        run.onText('Done')
      },
    })
    const parent = s.tasks.create({
      title: 'Parent',
      repositoryId: git ? 'folder' : 'repo',
      agentId: 'agent',
      objective: 'Delegate',
      linkedCheckouts: [
        {
          id: 'selected',
          repositoryId: git ? 'backend' : 'folder',
          execution: 'main',
          access: 'edit',
        },
      ],
    })
    await (
      await s.tasks.start(parent.id)
    ).done
    expect(childRuns).toEqual([
      { id: childId, cwd: selectedDirectory },
      { id: nestedId, cwd: selectedDirectory },
    ])
    for (const { id } of childRuns) {
      const task = s.store.task(id)
      expect(task.repositoryId).toBe(parent.repositoryId)
      expect(s.checkouts.executionRepository(id).id).toBe(git ? 'backend' : 'folder')
      expect(task.status).toBe('review')
      expect(task.error).toBeUndefined()
      expect(Boolean(task.turns?.at(-1)?.checkpoint)).toBe(git)
      expect(Boolean(task.turns?.at(-1)?.checkpoint?.after)).toBe(git)
      expect(task.files.length > 0).toBe(git)
    }
    expect(await readFile(join(selectedDirectory, 'hello.txt'), 'utf8')).toBe(
      'selected child write\n',
    )
    expect(await readFile(join(selectedDirectory, 'nested.txt'), 'utf8')).toBe(
      'nested child write\n',
    )
  },
)

it('retries selected Git checkout finalization under a folder parent without rerunning the provider', async () => {
  const { s, secondary } = await setup()
  const folder = await mkdtemp(join(tmpdir(), 'dovo-linked-finalization-'))
  cleanups.push(() => rm(folder, { recursive: true, force: true }))
  s.store.update((workspace) => ({
    ...workspace,
    repositories: [
      ...workspace.repositories,
      { id: 'folder', name: 'Folder', path: folder, kind: 'folder', branch: '' },
    ],
  }))
  const childFinished = barrier()
  const finishParent = barrier()
  const selectedDirectory = await realpath(secondary.directory)
  const changes = s.git.changes.bind(s.git)
  let failRefresh = true
  vi.spyOn(s.git, 'changes').mockImplementation(async (cwd) => {
    if (cwd === selectedDirectory && failRefresh) {
      failRefresh = false
      throw new Error('Change refresh failed')
    }
    return changes(cwd)
  })
  let childId = ''
  let childRuns = 0
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      if (!run.taskId) throw new Error('Expected task ID')
      if (run.agent.provider === 'claude') {
        childRuns++
        await writeFile(join(run.cwd, 'hello.txt'), 'child change\n')
      } else {
        childId = s.tasks.subagentSpawn({
          taskId: run.taskId,
          key: 'selected',
          name: 'Selected',
          prompt: 'Work',
          provider: 'claude',
          checkoutId: 'selected',
        }).id
        await s.tasks.subagentWait(run.taskId, childId)
        childFinished.resolve()
        await finishParent.promise
      }
      run.onText('Done')
    },
  })
  const parent = s.tasks.create({
    title: 'Folder parent',
    repositoryId: 'folder',
    agentId: 'agent',
    objective: 'Delegate',
    linkedCheckouts: [
      { id: 'selected', repositoryId: 'backend', execution: 'main', access: 'edit' },
    ],
  })
  const running = await s.tasks.start(parent.id)
  try {
    await childFinished.promise
    expect(s.store.task(childId).runPhase).toBe('finalizing')
    expect(s.store.task(childId).error).toContain('Change refresh failed')
    await (
      await s.tasks.start(childId)
    ).done
    expect(childRuns).toBe(1)
    expect(s.store.task(childId).runPhase).toBeUndefined()
    expect(s.store.task(childId).error).toBeUndefined()
    expect(s.store.task(childId).files).toEqual([
      expect.objectContaining({ path: 'hello.txt', after: 'child change\n' }),
    ])
  } finally {
    finishParent.resolve()
    await running.done
  }
})

it('captures, previews, undoes and redoes both repositories without changing their commits', async () => {
  const { s, primary, secondary } = await setup()
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      expect(run.cwd).toBe(await realpath(primary.directory))
      expect(run.linkedDirectories).toEqual([
        { id: 'backend-link', path: await realpath(secondary.directory), access: 'edit' },
      ])
      expect(run.agent.instructions).toContain('Backend')
      await writeFile(join(primary.directory, 'hello.txt'), 'frontend change\n')
      await writeFile(join(secondary.directory, 'hello.txt'), 'backend change\n')
      run.onText('Both updated')
    },
  })
  const task = s.tasks.create({
    title: 'Both projects',
    agentId: 'agent',
    repositoryId: 'repo',
    objective: 'Update both',
    linkedCheckouts: [
      { id: 'backend-link', repositoryId: 'backend', execution: 'main', access: 'edit' },
    ],
  })
  await (
    await s.tasks.start(task.id)
  ).done
  const turn = s.store.task(task.id).turns?.at(-1)
  expect(turn?.checkpoint?.files.map((file) => file.path)).toEqual(['hello.txt'])
  expect(turn?.checkpoint?.linked?.[0]).toMatchObject({
    repositoryName: 'Backend',
    checkoutId: 'backend-link',
    files: [
      expect.objectContaining({
        path: 'hello.txt',
        before: 'original\n',
        after: 'backend change\n',
      }),
    ],
  })
  if (!turn) throw new Error('Missing turn')
  expect(
    (await s.tasks.filePreview(task.id, 'hello.txt', turn.id, 'backend-link')).after?.text,
  ).toBe('backend change\n')
  await s.tasks.restoreTurn(task.id, turn.id, 'undo')
  expect(await readFile(join(primary.directory, 'hello.txt'), 'utf8')).toBe('original\n')
  expect(await readFile(join(secondary.directory, 'hello.txt'), 'utf8')).toBe('original\n')
  await s.tasks.restoreTurn(task.id, turn.id, 'redo')
  expect(await readFile(join(primary.directory, 'hello.txt'), 'utf8')).toBe('frontend change\n')
  expect(await readFile(join(secondary.directory, 'hello.txt'), 'utf8')).toBe('backend change\n')
  s.checkouts.linked.save(task.id, task.linkedCheckouts, [])
  expect(
    (await s.tasks.filePreview(task.id, 'hello.txt', turn.id, 'backend-link')).after?.text,
  ).toBe('backend change\n')
})

it('creates and reuses thread-owned worktrees and protects their dirty contents during cleanup', async () => {
  const { s } = await setup()
  const task = s.tasks.create({
    title: 'New linked worktree',
    agentId: 'agent',
    repositoryId: 'repo',
    objective: 'Work',
    linkedCheckouts: [
      {
        id: 'backend-link',
        repositoryId: 'backend',
        execution: 'worktree',
        branch: 'feature/backend',
        access: 'edit',
      },
    ],
  })
  const [link] = await s.checkouts.linked.resolve(task.id)
  cleanups.push(() => rm(link.directory, { recursive: true, force: true }))
  expect(link.branch).toMatch(/^feature\/backend-[a-f0-9]{8}$/)
  expect((await s.checkouts.linked.resolve(task.id))[0].directory).toBe(link.directory)
  const entry = (await runClientEffect(listWorktreesEffect(s))).worktrees.find(
    (item) => item.path === link.directory,
  )
  expect(entry).toMatchObject({ taskId: task.id, state: 'active', repositoryId: 'backend' })
  await expect(runClientEffect(removeWorktreeEffect(s, link.directory))).rejects.toThrow(
    'active task',
  )
  s.store.updateTask(task.id, (current) => ({ ...current, archivedAt: new Date().toISOString() }))
  await writeFile(join(link.directory, 'unsaved.txt'), 'Keep this')
  await expect(runClientEffect(removeWorktreeEffect(s, link.directory))).rejects.toThrow(
    'uncommitted',
  )
})

it('validates local projects and existing worktrees, and rejects stale or active settings saves', async () => {
  const { s, secondary } = await setup()
  const task = s.tasks.create({
    title: 'Links',
    agentId: 'agent',
    repositoryId: 'repo',
    objective: 'Work',
  })
  const links = [
    {
      id: 'backend-link',
      repositoryId: 'backend',
      execution: 'main' as const,
      access: 'read-only' as const,
    },
  ]
  expect(() =>
    s.checkouts.linked.save(task.id, [], [{ ...links[0], repositoryId: 'another-host' }]),
  ).toThrow('this computer')
  expect(() => s.checkouts.linked.save(task.id, [], [links[0], links[0]])).toThrow('unique')
  s.checkouts.linked.save(task.id, [], links)
  expect(() => s.checkouts.linked.save(task.id, [], [])).toThrow('Reload')
  s.store.updateTask(task.id, (current) => ({ ...current, status: 'running' }))
  expect(() => s.checkouts.linked.save(task.id, links, [])).toThrow('pending work')
  s.store.updateTask(task.id, (current) => ({
    ...current,
    status: 'draft',
    linkedCheckouts: [
      { ...links[0], execution: 'worktree', existingWorktreePath: secondary.directory },
    ],
  }))
  await expect(s.checkouts.linked.resolve(task.id)).rejects.toThrow('no longer available')
})

it('gives each automation run its own linked worktree and uses generated titles', async () => {
  const { s } = await setup()
  const flow: Automation = {
    id: 'flow',
    name: 'Linked automation',
    nodes: ['trigger', 'task'].map((id, index) => ({
      id,
      type: 'automation',
      position: { x: index * 100, y: 0 },
      data: {
        kind: id === 'trigger' ? 'trigger' : 'task',
        label: id,
        trigger: 'manual',
        schedule: '',
        timezone: 'UTC',
        objective: 'Update backend',
        agentId: 'agent',
        repositoryId: 'repo',
        linkedCheckouts:
          id === 'task'
            ? [
                {
                  id: 'backend-link',
                  repositoryId: 'backend',
                  execution: 'worktree',
                  branch: 'feature/backend',
                  access: 'edit',
                },
              ]
            : undefined,
      },
    })),
    edges: [{ id: 'edge', source: 'trigger', target: 'task' }],
  }
  s.store.update((workspace) => ({ ...workspace, automations: [flow] }))
  const titles = vi
    .spyOn(s.titles, 'generate')
    .mockResolvedValue({ title: 'Generated backend task' })
  const directories: string[] = []
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      expect(s.store.task(run.taskId ?? '').title).toBe('Generated backend task')
      const directory = run.linkedDirectories?.[0].path
      if (!directory) throw new Error('Missing linked directory')
      directories.push(directory)
      cleanups.push(() => rm(directory, { recursive: true, force: true }))
      run.onText('Done')
    },
  })
  for (let index = 0; index < 2; index++) {
    const id = s.jobs.start('flow')
    await waitForRuntime(() =>
      expect(s.jobs.list().find((run) => run.id === id)?.status).toBe('completed'),
    )
  }
  expect(titles).toHaveBeenCalledTimes(2)
  expect(new Set(directories).size).toBe(2)
})

it('continues automation execution when the title generator fails', async () => {
  const { s } = await setup()
  const flow: Automation = {
    id: 'fallback',
    name: 'Fallback',
    nodes: ['trigger', 'task'].map((id, index) => ({
      id,
      type: 'automation',
      position: { x: index * 100, y: 0 },
      data: {
        kind: id === 'trigger' ? 'trigger' : 'task',
        label: 'Step name',
        trigger: 'manual',
        schedule: '',
        timezone: 'UTC',
        objective: 'Work',
        agentId: 'agent',
        repositoryId: 'repo',
      },
    })),
    edges: [{ id: 'edge', source: 'trigger', target: 'task' }],
  }
  s.store.update((workspace) => ({ ...workspace, automations: [flow] }))
  vi.spyOn(s.titles, 'generate').mockRejectedValue(new Error('No title model'))
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => run.onText('Done'),
  })
  const id = s.jobs.start('fallback')
  await waitForRuntime(() =>
    expect(s.jobs.list().find((run) => run.id === id)?.status).toBe('completed'),
  )
  expect(s.store.get().tasks[0].title).toBe('Step name')
})

it('starts a child in a linked checkout without granting edits to a reference-only link', async () => {
  const { s, secondary } = await setup()
  const directory = await realpath(secondary.directory)
  let childCwd = ''
  let childPermission = ''
  vi.spyOn(s.agents, 'get').mockImplementation(async (provider) => ({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      if (provider === 'claude') {
        childCwd = run.cwd
        childPermission = run.agent.permission
        run.onText('Read backend')
        return
      }
      const input = {
        taskId: run.taskId ?? '',
        key: 'backend-reader',
        name: 'Backend reader',
        prompt: 'Read backend',
        provider: 'claude' as const,
        permission: 'full-access' as const,
        checkoutId: 'backend-link',
      }
      const child = s.tasks.subagentSpawn(input)
      expect(() => s.tasks.subagentSpawn({ ...input, checkoutId: 'different-link' })).toThrow(
        'different request',
      )
      const result = await s.tasks.subagentWait(input.taskId, child.id, 10000)
      expect(result.status).toBe('review')
      expect(() =>
        s.store.updateTask(child.id, (task) => ({
          ...task,
          agentOverrides: { permission: 'workspace-write' },
        })),
      ).toThrow('cannot exceed')
      expect(() =>
        s.store.patch({
          collection: 'tasks',
          id: child.id,
          changes: {
            harness: {
              before: s.store.task(child.id).harness,
              after: { ...s.store.task(child.id).harness, permission: 'ask' },
            },
          },
        }),
      ).toThrow('cannot exceed')
      await (
        await s.tasks.start(child.id)
      ).done
      expect(s.store.task(child.id).harness?.permission).toBe('read-only')
      run.onText(result.result ?? '')
    },
  }))
  const task = s.tasks.create({
    title: 'Read linked project',
    agentId: 'agent',
    repositoryId: 'repo',
    objective: 'Read backend',
    linkedCheckouts: [
      { id: 'backend-link', repositoryId: 'backend', execution: 'main', access: 'read-only' },
    ],
  })
  await (
    await s.tasks.start(task.id)
  ).done
  expect(childCwd).toBe(directory)
  expect(childPermission).toBe('read-only')
})

it('retries failed worktree setup instead of silently using an unprepared checkout', async () => {
  const { s } = await setup()
  const defaults = s.store.taskDefaults.bind(s.store)
  vi.spyOn(s.store, 'taskDefaults').mockImplementation((id) => ({
    ...defaults(id),
    ...(id === 'backend' ? { setupCommand: 'install-dependencies' } : {}),
  }))
  const setupWorktree = vi
    .spyOn(s.git, 'setupWorktree')
    .mockRejectedValueOnce(new Error('Install failed'))
    .mockResolvedValue('')
  const task = s.tasks.create({
    title: 'Setup retry',
    agentId: 'agent',
    repositoryId: 'repo',
    objective: 'Work',
    linkedCheckouts: [
      { id: 'backend-link', repositoryId: 'backend', execution: 'worktree', access: 'edit' },
    ],
  })
  await expect(s.checkouts.linked.resolve(task.id)).rejects.toThrow('Install failed')
  const [link] = await s.checkouts.linked.resolve(task.id)
  cleanups.push(() => rm(link.directory, { recursive: true, force: true }))
  await s.checkouts.linked.resolve(task.id)
  expect(setupWorktree).toHaveBeenCalledTimes(2)
  expect(() =>
    s.checkouts.linked.save(task.id, task.linkedCheckouts, [
      {
        ...task.linkedCheckouts?.[0],
        id: 'backend-link',
        repositoryId: 'backend',
        execution: 'worktree',
        access: 'edit',
        branch: 'replacement',
      },
    ]),
  ).toThrow('already exists')
})

it('stops linked preparation before the next project and retains ownership through setup cleanup', async () => {
  const { s } = await setup()
  const defaults = s.store.taskDefaults.bind(s.store)
  vi.spyOn(s.store, 'taskDefaults').mockImplementation((id) => ({
    ...defaults(id),
    setupCommand: 'install',
  }))
  const entered = barrier()
  const release = barrier()
  let setupSignal: AbortSignal | undefined
  const setupSpy = vi
    .spyOn(s.git, 'setupWorktree')
    .mockImplementation(async (directory, _command, signal) => {
      cleanups.push(() => rm(directory, { recursive: true, force: true }))
      setupSignal = signal
      entered.resolve()
      await release.promise
      return ''
    })
  const task = s.tasks.create({
    title: 'Cancel linked setup',
    agentId: 'agent',
    repositoryId: 'repo',
    objective: 'Work',
    linkedCheckouts: [
      { id: 'first', repositoryId: 'backend', execution: 'worktree', access: 'edit' },
      { id: 'second', repositoryId: 'backend', execution: 'worktree', access: 'edit' },
    ],
  })
  const starting = s.tasks.start(task.id)
  void starting.catch(() => {})
  try {
    await entered.promise
    s.tasks.cancel(task.id)
    expect(setupSignal?.aborted).toBe(true)
    await expect(s.tasks.start(task.id)).rejects.toThrow('already running')
    release.resolve()
    await expect(starting).rejects.toThrow('Cancelled by user')
    expect(setupSpy).toHaveBeenCalledTimes(1)
    expect(s.store.task(task.id).linkedCheckoutSetup ?? []).toEqual([])
  } finally {
    release.resolve()
  }
})

it('cancels and drains the owned setup shell and its background process', async () => {
  const { s, primary } = await setup()
  const controller = new AbortController()
  const running = s.git.setupWorktree(
    primary.directory,
    'sleep 30 & echo $! > setup-child.pid; wait',
    controller.signal,
  )
  void running.catch(() => {})
  let pid = 0
  await waitForRuntime(async () => {
    pid = Number(await readFile(join(primary.directory, 'setup-child.pid'), 'utf8'))
    expect(pid).toBeGreaterThan(0)
  })
  controller.abort()
  await expect(running).rejects.toThrow('setup cancelled')
  expect(() => process.kill(pid, 0)).toThrow('ESRCH')
})
