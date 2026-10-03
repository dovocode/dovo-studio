import { afterEach, expect, it, vi } from 'vitest'
import { readFile, writeFile, rm, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { runClientEffect } from '@dovo/client-runtime'
import { startRuntime } from '../../index.js'
import { fixture } from '../../testing/fixture.js'
import { runtimeIntegration, waitForRuntime } from '../../testing/integration.js'
import { listWorktreesEffect, removeWorktreeEffect } from '../git/worktrees.js'
import type { AgentAdapter } from '../../agents/execution/types.js'
import type { Automation } from '@dovo/protocol'

vi.setConfig(runtimeIntegration)
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
