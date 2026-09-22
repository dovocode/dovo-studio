import { expect, it } from 'vitest'
import { taskHarnessSchema, type Task, type Workspace, type WorkspacePatch } from '@dovo/protocol'
import { openDatabase } from './database'
import { WorkspaceStore } from './workspace'
it('persists custom agent icons without adding presentation metadata to task harnesses', () => {
  const db = openDatabase(':memory:')
  try {
    const store = new WorkspaceStore(db)
    const agent = {
      id: 'custom',
      name: 'Reviewer',
      provider: 'opencode' as const,
      model: '',
      instructions: 'Review changes',
      permission: 'ask' as const,
      endpoint: '',
    }
    store.patch({ collection: 'agents', id: agent.id, changes: {}, create: agent })
    expect(new WorkspaceStore(db).get().agents[0]?.icon).toBeUndefined()
    const patch: WorkspacePatch = {
      collection: 'agents',
      id: agent.id,
      changes: { icon: { before: null, after: 'shield' } },
    }
    store.patch(patch)
    store.patch(patch)
    const saved = new WorkspaceStore(db).get().agents[0]
    expect(saved).toEqual({ ...agent, icon: 'shield' })
    expect(taskHarnessSchema.parse(saved)).not.toHaveProperty('icon')
    expect(() =>
      store.patch({
        ...patch,
        changes: { icon: { before: 'shield', after: 'not-an-icon' } },
      }),
    ).toThrow(/Invalid option/)
    expect(new WorkspaceStore(db).get().agents[0]).toEqual(saved)
  } finally {
    db.close()
  }
})

it('removes legacy examples from storage while preserving real conversations and preventing reimport', () => {
  const db = openDatabase(':memory:')
  try {
    const task: Task = {
      id: 'real',
      title: 'Real conversation',
      agentId: 'agent',
      repositoryId: 'repo',
      status: 'review',
      createdAt: '',
      draft: 'My draft',
      messages: [{ id: 'message', role: 'user', text: 'Keep this' }],
      files: [],
      example: false,
    }
    const workspace: Workspace = {
      version: 1,
      runtimeAddress: '',
      agents: [],
      repositories: [],
      automations: [],
      tasks: [task, { ...task, id: 'welcome', example: true }],
    }
    db.prepare('INSERT INTO documents VALUES (?, ?)').run('workspace', JSON.stringify(workspace))
    const store = new WorkspaceStore(db)
    expect(store.get().tasks).toEqual([task])
    expect(new WorkspaceStore(db).get().tasks).toEqual([task])
    store.update(() => workspace)
    expect(new WorkspaceStore(db).get().tasks).toEqual([task])
  } finally {
    db.close()
  }
})
it('persists snooze deadlines through patching and restart and rejects invalid dates', () => {
  const db = openDatabase(':memory:')
  try {
    const store = new WorkspaceStore(db)
    store.update((w) => ({
      ...w,
      tasks: [
        {
          id: 'task',
          title: 'Later',
          agentId: 'agent',
          repositoryId: 'repo',
          status: 'review',
          createdAt: '2026-09-12T10:00:00Z',
          draft: '',
          messages: [],
          files: [],
          example: false,
        },
      ],
    }))
    store.patch({
      collection: 'tasks',
      id: 'task',
      changes: { snoozedUntil: { before: null, after: '2026-09-12T12:00:00Z' } },
    })
    expect(new WorkspaceStore(db).task('task').snoozedUntil).toBe('2026-09-12T12:00:00Z')
    expect(() =>
      store.patch({
        collection: 'tasks',
        id: 'task',
        changes: { snoozedUntil: { before: '2026-09-12T12:00:00Z', after: 'invalid' } },
      }),
    ).toThrow(/Invalid ISO datetime/)
    store.patch({
      collection: 'tasks',
      id: 'task',
      changes: { snoozedUntil: { before: '2026-09-12T12:00:00Z', after: null } },
    })
    expect(new WorkspaceStore(db).task('task').snoozedUntil).toBeUndefined()
  } finally {
    db.close()
  }
})

it('allows choosing a project and checkout only before the first submitted input', () => {
  const db = openDatabase(':memory:')
  try {
    const store = new WorkspaceStore(db)
    const draft: Task = {
      id: 'draft',
      title: 'New task',
      agentId: '',
      repositoryId: 'repo',
      status: 'draft',
      createdAt: new Date().toISOString(),
      messages: [],
      files: [],
      draft: 'Unsent text',
      example: false,
      execution: 'main',
    }
    store.update((w) => ({ ...w, tasks: [draft] }))
    const change = () =>
      store.patch({
        collection: 'tasks',
        id: draft.id,
        changes: { execution: { before: 'main', after: 'worktree' } },
      })
    change()
    expect(new WorkspaceStore(db).task(draft.id).execution).toBe('worktree')
    store.patch({
      collection: 'tasks',
      id: draft.id,
      changes: { repositoryId: { before: 'repo', after: 'other-repo' } },
    })
    expect(new WorkspaceStore(db).task(draft.id).repositoryId).toBe('other-repo')
    for (const started of [
      { ...draft, messages: [{ id: 'first', role: 'user' as const, text: 'Do this' }] },
      {
        ...draft,
        queue: [
          {
            id: 'queued',
            role: 'user' as const,
            text: 'Do this',
            createdAt: new Date().toISOString(),
          },
        ],
      },
      { ...draft, status: 'running' as const },
      { ...draft, checkoutBranch: 'task/existing' },
      { ...draft, sessionId: 'existing-session' },
      { ...draft, consumedMessageIds: ['accepted-input'] },
      {
        ...draft,
        turns: [
          {
            id: 'turn',
            assistantId: 'assistant',
            agentId: 'agent',
            provider: 'codex' as const,
            model: '',
            startedAt: new Date().toISOString(),
            status: 'failed' as const,
          },
        ],
      },
    ]) {
      store.update((w) => ({ ...w, tasks: [started] }))
      expect(change).toThrow('before sending the first message')
      expect(store.task(draft.id).execution).toBe('main')
      expect(() =>
        store.patch({
          collection: 'tasks',
          id: draft.id,
          changes: { repositoryId: { before: 'repo', after: 'other-repo' } },
        }),
      ).toThrow('before sending the first message')
      expect(store.task(draft.id).repositoryId).toBe('repo')

      store.update((w) => ({ ...w, tasks: [{ ...started, execution: 'worktree' }] }))
      expect(() =>
        store.patch({
          collection: 'tasks',
          id: draft.id,
          changes: { execution: { before: 'worktree', after: 'main' } },
        }),
      ).toThrow('before sending the first message')
      expect(store.task(draft.id).execution).toBe('worktree')
    }

    // A lost-response retry of an already applied choice is still idempotent after sending.
    const version = store.version()
    store.patch({
      collection: 'tasks',
      id: draft.id,
      changes: { execution: { before: 'main', after: 'worktree' } },
    })
    expect(store.version()).toBe(version)
  } finally {
    db.close()
  }
})

it('safely replays an applied patch after losing its response without duplicating writes', () => {
  const db = openDatabase(':memory:')
  try {
    const store = new WorkspaceStore(db)
    store.update((workspace) => ({
      ...workspace,
      repositories: [{ id: 'repo', name: 'Before', path: '/repo', branch: 'main' }],
    }))
    const patch: WorkspacePatch = {
      collection: 'repositories',
      id: 'repo',
      changes: { name: { before: 'Before', after: 'After' } },
    }
    store.patch(patch)
    const version = store.version()
    store.patch(patch)
    expect(store.version()).toBe(version)
    expect(store.get().repositories[0].name).toBe('After')
    store.patch({ ...patch, changes: { name: { before: 'After', after: 'Someone else' } } })
    expect(() => store.patch(patch)).toThrow('Another client changed name')
    expect(store.get().repositories[0].name).toBe('Someone else')
    expect(() =>
      store.patch({
        ...patch,
        changes: {
          name: { before: 'Someone else', after: 'Unsaved' },
          branch: { before: 'old-branch', after: 'new-branch' },
        },
      }),
    ).toThrow('Another client changed branch')
    expect(store.get().repositories[0]).toMatchObject({ name: 'Someone else', branch: 'main' })
  } finally {
    db.close()
  }
})

it('recognizes an identical creation retry while rejecting changed entities and restricted fields', () => {
  const db = openDatabase(':memory:')
  try {
    const store = new WorkspaceStore(db)
    const draft: Task = {
      id: 'draft',
      title: 'New task',
      agentId: '',
      repositoryId: 'repo',
      status: 'draft',
      createdAt: '',
      messages: [],
      files: [],
      draft: '',
      example: false,
    }
    const create: WorkspacePatch = { collection: 'tasks', id: draft.id, create: draft, changes: {} }
    store.patch(create)
    const version = store.version()
    store.patch(create)
    expect(store.version()).toBe(version)
    expect(store.get().tasks).toEqual([draft])
    expect(() => store.patch({ ...create, create: { ...draft, title: 'Different' } })).toThrow(
      'already exists',
    )
    expect(() => store.patch({ ...create, create: { ...draft, status: 'running' } })).toThrow(
      'must be drafts',
    )
    expect(() =>
      store.patch({
        collection: 'tasks',
        id: draft.id,
        changes: { status: { before: 'draft', after: 'draft' } },
      }),
    ).toThrow('Cannot edit status')
    const append: WorkspacePatch = {
      collection: 'tasks',
      id: draft.id,
      changes: {
        messages: { before: [], after: [{ id: 'input', role: 'user', text: 'Run once' }] },
      },
    }
    store.patch(append)
    store.patch(append)
    expect(store.task(draft.id).messages).toHaveLength(1)
  } finally {
    db.close()
  }
})

it('persists manual PR links independently from execution checkout and rejects unsafe links', () => {
  const db = openDatabase(':memory:')
  try {
    const store = new WorkspaceStore(db)
    const source = {
      number: 7,
      url: 'https://github.com/org/repo/pull/7',
      repositoryUrl: 'https://github.com/org/repo',
      headSha: 'a'.repeat(40),
      baseSha: 'b'.repeat(40),
    }
    store.update((w) => ({
      ...w,
      tasks: [
        {
          id: 'linked',
          title: 'Task',
          agentId: '',
          repositoryId: 'repo',
          status: 'review',
          createdAt: '',
          draft: '',
          messages: [],
          files: [],
          example: false,
          execution: 'worktree',
          checkoutBranch: 'existing-branch',
          pullRequest: source,
        },
      ],
    }))
    const links = [
      {
        number: 8,
        url: 'https://github.com/org/repo/pull/8',
        repositoryUrl: source.repositoryUrl,
        title: 'Related PR',
      },
    ]
    const patch: WorkspacePatch = {
      collection: 'tasks',
      id: 'linked',
      changes: { linkedPullRequests: { before: null, after: links } },
    }
    store.patch(patch)
    store.patch(patch)
    const saved = new WorkspaceStore(db).task('linked')
    expect(saved.linkedPullRequests).toEqual(links)
    expect(saved.pullRequest).toEqual(source)
    expect(saved.checkoutBranch).toBe('existing-branch')
    expect(saved.execution).toBe('worktree')
    expect(() =>
      store.patch({
        ...patch,
        changes: {
          linkedPullRequests: {
            before: links,
            after: [{ ...links[0], url: 'javascript:alert(1)' }],
          },
        },
      }),
    ).toThrow(/Invalid URL/)
    expect(store.task('linked').linkedPullRequests).toEqual(links)
    store.patch({ ...patch, changes: { linkedPullRequests: { before: links, after: [] } } })
    expect(new WorkspaceStore(db).task('linked').linkedPullRequests).toEqual([])
    expect(store.task('linked').pullRequest).toEqual(source)
  } finally {
    db.close()
  }
})
