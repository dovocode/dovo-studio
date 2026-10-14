import { expect, it, vi } from 'vite-plus/test'
import { defaultTaskHarness, resolveTaskAgent, type Task } from '@dovo/protocol'
import { openDatabase } from '../../storage/database.js'
import { WorkspaceStore } from '../../storage/workspace.js'

function task(id: string, parentTaskId?: string): Task {
  return {
    id,
    title: id,
    agentId: '',
    repositoryId: '',
    status: 'done',
    createdAt: '',
    draft: '',
    files: [],
    messages: [],
    example: false,
    harness: defaultTaskHarness('codex'),
    ...(parentTaskId ? { delegation: { parentTaskId, parentRunId: 'old', key: id } } : {}),
  }
}

it('persists inherited family policy in ancestor order while retaining deliberately narrower children across widening and restarts', () => {
  const db = openDatabase(':memory:')
  try {
    let store = new WorkspaceStore(db)
    const parent = task('parent')
    const child = task('child', parent.id)
    const nested = task('nested', child.id)
    const restricted = {
      ...task('restricted', parent.id),
      harness: { ...defaultTaskHarness('codex'), permission: 'read-only' as const },
    }
    store.update((workspace) => ({ ...workspace, tasks: [nested, restricted, child, parent] }))
    const policy = (id: string) => resolveTaskAgent(store.taskSummary(id), store.get().agents)
    store.updateTask(parent.id, (task) => ({
      ...task,
      harness: { ...task.harness!, permission: 'ask' },
    }))
    for (const id of ['parent', 'child', 'nested']) expect(policy(id)?.permission).toBe('ask')
    expect(policy('restricted')?.permission).toBe('read-only')
    store = new WorkspaceStore(db)
    store.updateTask(parent.id, (task) => ({
      ...task,
      harness: { ...task.harness!, permission: 'full-access' },
    }))
    for (const id of ['parent', 'child', 'nested'])
      expect(policy(id)?.permission).toBe('full-access')
    expect(policy('restricted')?.permission).toBe('read-only')
    // A deliberate child reset removes the narrower intent, so later changes follow again.
    store.updateTask('restricted', (task) => ({
      ...task,
      agentOverrides: { permission: 'full-access', approvalPolicy: null, sandboxMode: null },
    }))
    store.updateTask(parent.id, (task) => ({
      ...task,
      harness: { ...task.harness!, permission: 'workspace-write' },
    }))
    expect(policy('restricted')?.permission).toBe('workspace-write')
  } finally {
    db.close()
  }
})

it('retains requested advanced restrictions and read-only checkouts while updating other dimensions', () => {
  const db = openDatabase(':memory:')
  try {
    const store = new WorkspaceStore(db)
    const parent = {
      ...task('parent'),
      linkedCheckouts: [
        {
          id: 'link',
          repositoryId: 'linked',
          execution: 'main' as const,
          access: 'read-only' as const,
        },
      ],
    }
    const restricted = {
      ...task('restricted', parent.id),
      harness: {
        ...defaultTaskHarness('codex'),
        approvalPolicy: 'untrusted' as const,
        sandboxMode: 'workspace-write' as const,
      },
      delegation: {
        ...task('restricted', parent.id).delegation!,
        permissionLimits: {
          approvalPolicy: 'untrusted' as const,
          sandboxMode: 'workspace-write' as const,
        },
      },
    }
    const linked = {
      ...task('linked', parent.id),
      harness: { ...defaultTaskHarness('codex'), permission: 'read-only' as const },
      delegation: { ...task('linked', parent.id).delegation!, checkoutId: 'link' },
    }
    store.update((workspace) => ({ ...workspace, tasks: [parent, restricted, linked] }))
    store.updateTask('parent', (task) => ({
      ...task,
      harness: { ...task.harness!, permission: 'ask' },
    }))
    expect(resolveTaskAgent(store.taskSummary('restricted'), [])).toMatchObject({
      permission: 'ask',
      approvalPolicy: 'untrusted',
    })
    store.updateTask('parent', (task) => ({
      ...task,
      harness: { ...task.harness!, permission: 'full-access' },
    }))
    expect(resolveTaskAgent(store.taskSummary('restricted'), [])).toMatchObject({
      permission: 'full-access',
      approvalPolicy: 'untrusted',
      sandboxMode: 'workspace-write',
    })
    expect(resolveTaskAgent(store.taskSummary('linked'), [])?.permission).toBe('read-only')
  } finally {
    db.close()
  }
})

it('does not revoke running authority on rolled-back changes and publishes a family only after outer commit', () => {
  const db = openDatabase(':memory:')
  try {
    const store = new WorkspaceStore(db)
    store.update((workspace) => ({
      ...workspace,
      tasks: [task('parent'), task('child', 'parent')],
    }))
    const committed = vi.fn<Parameters<WorkspaceStore['onCommitted']>[0]>()
    store.onCommitted(committed)
    const narrow = () =>
      store.updateTask('parent', (task) => ({
        ...task,
        harness: { ...task.harness!, permission: 'ask' },
      }))
    expect(() =>
      store.transaction(() => {
        narrow()
        throw new Error('rollback')
      }),
    ).toThrow('rollback')
    expect(committed).not.toHaveBeenCalled()
    expect(resolveTaskAgent(store.taskSummary('child'), [])?.permission).toBe('full-access')
    store.transaction(() => {
      narrow()
      expect(committed).not.toHaveBeenCalled()
    })
    expect(committed).toHaveBeenCalledOnce()
    expect(resolveTaskAgent(new WorkspaceStore(db).taskSummary('child'), [])?.permission).toBe(
      'ask',
    )
  } finally {
    db.close()
  }
})

it('rejects a parent override unsupported by a child harness without partially changing the family', () => {
  const db = openDatabase(':memory:')
  try {
    const store = new WorkspaceStore(db)
    store.update((workspace) => ({
      ...workspace,
      tasks: [
        task('parent'),
        { ...task('child', 'parent'), harness: defaultTaskHarness('claude') },
      ],
    }))
    expect(() =>
      store.updateTask('parent', (task) => ({
        ...task,
        harness: { ...task.harness!, sandboxMode: 'workspace-write' },
      })),
    ).toThrow('does not support sandbox')
    expect(resolveTaskAgent(store.taskSummary('parent'), [])?.sandboxMode).toBeUndefined()
    expect(
      resolveTaskAgent(new WorkspaceStore(db).taskSummary('child'), [])?.sandboxMode,
    ).toBeUndefined()
  } finally {
    db.close()
  }
})

it('reconciles legacy children already above their parent ceiling without requiring another permission change', async () => {
  const { propagateDelegatedPermissions } = await import('./delegation-permissions.js')
  const { summarizeTask, decode, workspaceSchema } = await import('@dovo/protocol')
  const workspace = decode(workspaceSchema, {
    version: 1,
    runtimeAddress: 'http://localhost:0',
    agents: [],
    repositories: [],
    tasks: [],
    automations: [],
    skills: [],
    mcpServers: [],
  })
  const before = {
    ...workspace,
    tasks: [
      summarizeTask({
        ...task('parent'),
        harness: { ...defaultTaskHarness('codex'), permission: 'ask' },
      }),
      summarizeTask(task('child', 'parent')),
    ],
  }
  const tasks = propagateDelegatedPermissions(before, before)
  expect(resolveTaskAgent(tasks[1], [])?.permission).toBe('ask')
  expect(tasks[1].delegation?.permissionLimits).toEqual({})
  const unsupported = {
    ...before,
    tasks: [
      summarizeTask({
        ...task('parent'),
        harness: { ...defaultTaskHarness('codex'), permission: 'read-only' as const },
      }),
      summarizeTask({ ...task('child', 'parent'), harness: defaultTaskHarness('hermes') }),
    ],
  }
  // An older unsupported child remains available for history reads, with no new authority.
  expect(propagateDelegatedPermissions(unsupported, unsupported)[1]).toBe(unsupported.tasks[1])
})
