import { decode, defaultTaskHarness } from '@dovo/protocol'
import { expect, it, vi } from 'vitest'
import { taskHarnessSchema, type Task, type Workspace, type WorkspacePatch } from '@dovo/protocol'
import { openDatabase } from './database'
import { WorkspaceStore } from './workspace'

it('retains ended children when parent access narrows and accepts old over-cap children on restart', () => {
  const db = openDatabase(':memory:')
  try {
    const parent: Task = {
      id: 'parent',
      title: 'Parent',
      agentId: '',
      repositoryId: '',
      status: 'review',
      createdAt: '',
      draft: '',
      messages: [],
      files: [],
      example: false,
      harness: { ...defaultTaskHarness('codex'), permission: 'workspace-write' },
    }
    const child: Task = {
      ...parent,
      id: 'child',
      title: 'Child',
      delegation: { parentTaskId: parent.id, parentRunId: 'ended-run', key: 'child' },
    }
    const store = new WorkspaceStore(db)
    store.update((workspace) => ({ ...workspace, tasks: [parent, child] }))
    const narrowed = { ...parent.harness!, permission: 'read-only' as const }
    store.patch({
      collection: 'tasks',
      id: parent.id,
      changes: { harness: { before: parent.harness, after: narrowed } },
    })
    expect(store.task(parent.id).harness?.permission).toBe('read-only')
    const reopened = new WorkspaceStore(db)
    expect(reopened.task(child.id).harness?.permission).toBe('workspace-write')
    reopened.updateTask(parent.id, (task) => ({ ...task, title: 'Renamed' }))
    expect(() =>
      reopened.updateTask(child.id, (task) => ({
        ...task,
        agentOverrides: { permission: 'full-access' },
      })),
    ).toThrow('cannot exceed')
  } finally {
    db.close()
  }
})
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
    store.patch({
      collection: 'agents',
      id: agent.id,
      changes: {},
      create: agent,
    })
    expect(new WorkspaceStore(db).get().agents[0]?.icon).toBeUndefined()
    const patch: WorkspacePatch = {
      collection: 'agents',
      id: agent.id,
      changes: {
        icon: {
          before: null,
          after: 'shield',
        },
      },
    }
    store.patch(patch)
    store.patch(patch)
    const saved = new WorkspaceStore(db).get().agents[0]
    expect(saved).toEqual({
      ...agent,
      icon: 'shield',
    })
    expect(decode(taskHarnessSchema, saved)).not.toHaveProperty('icon')
    expect(() =>
      store.patch({
        ...patch,
        changes: {
          icon: {
            before: 'shield',
            after: 'not-an-icon',
          },
        },
      }),
    ).toThrow(/Expected/)
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
      messages: [
        {
          id: 'message',
          role: 'user',
          text: 'Keep this',
        },
      ],
      files: [],
      example: false,
    }
    const workspace: Workspace = {
      version: 1,
      runtimeAddress: '',
      agents: [],
      repositories: [],
      automations: [],
      tasks: [
        task,
        {
          ...task,
          id: 'welcome',
          example: true,
        },
      ],
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
      changes: {
        snoozedUntil: {
          before: null,
          after: '2026-09-12T12:00:00Z',
        },
      },
    })
    expect(new WorkspaceStore(db).task('task').snoozedUntil).toBe('2026-09-12T12:00:00Z')
    expect(() =>
      store.patch({
        collection: 'tasks',
        id: 'task',
        changes: {
          snoozedUntil: {
            before: '2026-09-12T12:00:00Z',
            after: 'invalid',
          },
        },
      }),
    ).toThrow(/Invalid ISO datetime/)
    store.patch({
      collection: 'tasks',
      id: 'task',
      changes: {
        snoozedUntil: {
          before: '2026-09-12T12:00:00Z',
          after: null,
        },
      },
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
    store.update((w) => ({
      ...w,
      tasks: [draft],
    }))
    const change = () =>
      store.patch({
        collection: 'tasks',
        id: draft.id,
        changes: {
          execution: {
            before: 'main',
            after: 'worktree',
          },
        },
      })
    change()
    expect(new WorkspaceStore(db).task(draft.id).execution).toBe('worktree')
    store.patch({
      collection: 'tasks',
      id: draft.id,
      changes: {
        repositoryId: {
          before: 'repo',
          after: 'other-repo',
        },
      },
    })
    expect(new WorkspaceStore(db).task(draft.id).repositoryId).toBe('other-repo')
    for (const started of [
      {
        ...draft,
        messages: [
          {
            id: 'first',
            role: 'user' as const,
            text: 'Do this',
          },
        ],
      },
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
      {
        ...draft,
        status: 'running' as const,
      },
      {
        ...draft,
        checkoutBranch: 'task/existing',
      },
      {
        ...draft,
        sessionId: 'existing-session',
      },
      {
        ...draft,
        consumedMessageIds: ['accepted-input'],
      },
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
      store.update((w) => ({
        ...w,
        tasks: [started],
      }))
      expect(change).toThrow('before sending the first message')
      expect(() =>
        store.patch({
          collection: 'tasks',
          id: draft.id,
          changes: { worktreeBaseBranch: { before: null, after: 'refs/remotes/origin/main' } },
        }),
      ).toThrow('before sending the first message')
      expect(store.task(draft.id).execution).toBe('main')
      expect(() =>
        store.patch({
          collection: 'tasks',
          id: draft.id,
          changes: {
            repositoryId: {
              before: 'repo',
              after: 'other-repo',
            },
          },
        }),
      ).toThrow('before sending the first message')
      expect(store.task(draft.id).repositoryId).toBe('repo')
      store.update((w) => ({
        ...w,
        tasks: [
          {
            ...started,
            execution: 'worktree',
          },
        ],
      }))
      expect(() =>
        store.patch({
          collection: 'tasks',
          id: draft.id,
          changes: {
            execution: {
              before: 'worktree',
              after: 'main',
            },
          },
        }),
      ).toThrow('before sending the first message')
      expect(store.task(draft.id).execution).toBe('worktree')
    }

    // A lost-response retry of an already applied choice is still idempotent after sending.
    const version = store.version()
    store.patch({
      collection: 'tasks',
      id: draft.id,
      changes: {
        execution: {
          before: 'main',
          after: 'worktree',
        },
      },
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
      repositories: [
        {
          id: 'repo',
          name: 'Before',
          path: '/repo',
          branch: 'main',
        },
      ],
    }))
    const patch: WorkspacePatch = {
      collection: 'repositories',
      id: 'repo',
      changes: {
        name: {
          before: 'Before',
          after: 'After',
        },
      },
    }
    store.patch(patch)
    const version = store.version()
    store.patch(patch)
    expect(store.version()).toBe(version)
    expect(store.get().repositories[0].name).toBe('After')
    store.patch({
      ...patch,
      changes: {
        name: {
          before: 'After',
          after: 'Someone else',
        },
      },
    })
    expect(() => store.patch(patch)).toThrow('Another client changed name')
    expect(store.get().repositories[0].name).toBe('Someone else')
    expect(() =>
      store.patch({
        ...patch,
        changes: {
          name: {
            before: 'Someone else',
            after: 'Unsaved',
          },
          branch: {
            before: 'old-branch',
            after: 'new-branch',
          },
        },
      }),
    ).toThrow('Another client changed branch')
    expect(store.get().repositories[0]).toMatchObject({
      name: 'Someone else',
      branch: 'main',
    })
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
    const create: WorkspacePatch = {
      collection: 'tasks',
      id: draft.id,
      create: draft,
      changes: {},
    }
    store.patch(create)
    const version = store.version()
    store.patch(create)
    expect(store.version()).toBe(version)
    expect(store.get().tasks).toEqual([draft])
    expect(() =>
      store.patch({
        ...create,
        create: {
          ...draft,
          title: 'Different',
        },
      }),
    ).toThrow('already exists')
    expect(() =>
      store.patch({
        ...create,
        create: {
          ...draft,
          status: 'running',
        },
      }),
    ).toThrow('must be drafts')
    expect(() =>
      store.patch({
        collection: 'tasks',
        id: draft.id,
        changes: {
          status: {
            before: 'draft',
            after: 'draft',
          },
        },
      }),
    ).toThrow('Cannot edit status')
    const append: WorkspacePatch = {
      collection: 'tasks',
      id: draft.id,
      changes: {
        messages: {
          before: [],
          after: [
            {
              id: 'input',
              role: 'user',
              text: 'Run once',
            },
          ],
        },
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
      changes: {
        linkedPullRequests: {
          before: null,
          after: links,
        },
      },
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
            after: [
              {
                ...links[0],
                url: 'javascript:alert(1)',
              },
            ],
          },
        },
      }),
    ).toThrow(/Invalid URL/)
    expect(store.task('linked').linkedPullRequests).toEqual(links)
    store.patch({
      ...patch,
      changes: {
        linkedPullRequests: {
          before: links,
          after: [],
        },
      },
    })
    expect(new WorkspaceStore(db).task('linked').linkedPullRequests).toEqual([])
    expect(store.task('linked').pullRequest).toEqual(source)
  } finally {
    db.close()
  }
})
it('loads the valid entries of a stored workspace that no longer validates and keeps a copy', () => {
  const db = openDatabase(':memory:')
  try {
    const store = new WorkspaceStore(db)
    store.patch({
      collection: 'agents',
      id: 'kept',
      changes: {},
      create: {
        id: 'kept',
        name: 'Reviewer',
        provider: 'opencode',
        model: '',
        instructions: '',
        permission: 'ask',
        endpoint: '',
      },
    })
    const stored = JSON.parse(
      String(
        (db.prepare("SELECT value FROM documents WHERE id='workspace'").get() as { value: string })
          .value,
      ),
    )
    stored.workspace.agents.push({ id: 'broken', name: '', provider: 'not-a-provider' })
    const raw = JSON.stringify(stored)
    db.prepare("UPDATE documents SET value=? WHERE id='workspace'").run(raw)
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const reopened = new WorkspaceStore(db)
    expect(reopened.get().agents.map((agent) => agent.id)).toEqual(['kept'])
    expect(error.mock.calls[0]?.[0]).toContain('agents[1]')
    const backups = db
      .prepare("SELECT value FROM documents WHERE id LIKE 'workspace-backup:%'")
      .all() as { value: string }[]
    expect(backups.map((row) => row.value)).toEqual([raw])
    error.mockRestore()
  } finally {
    db.close()
  }
})

it('deletes a configuration while preserving existing thread settings and templates', () => {
  const db = openDatabase(':memory:')
  try {
    const store = new WorkspaceStore(db)
    const agent = {
      id: 'saved',
      name: 'Codex review',
      provider: 'codex' as const,
      model: 'model',
      instructions: 'Review',
      permission: 'ask' as const,
      endpoint: '',
      resources: {
        hooks: [
          {
            name: 'format',
            enabled: true,
            event: 'after-turn',
            command: 'pnpm fmt',
            timeoutSeconds: 60,
          },
        ],
      },
    }
    store.patch({ collection: 'agents', id: agent.id, changes: {}, create: agent })
    store.update((workspace) => ({
      ...workspace,
      tasks: [
        {
          id: 'thread',
          title: 'Existing',
          agentId: agent.id,
          repositoryId: '',
          status: 'review',
          createdAt: '',
          draft: '',
          messages: [{ id: 'sent', role: 'user', text: 'Review' }],
          files: [],
          example: false,
          agentOverrides: { model: 'override' },
        },
      ],
    }))
    store.update((workspace) => ({
      ...workspace,
      repositories: [
        {
          id: 'repo',
          name: 'Repo',
          path: '/tmp/repo',
          branch: 'main',
          templates: [{ id: 'template', name: 'Review', objective: '', agentId: agent.id }],
        },
      ],
    }))
    store.removeAgent(agent.id)
    expect(store.get().repositories[0]?.templates?.[0]).toMatchObject({
      harness: { provider: 'codex', model: 'model' },
    })
    expect(store.get().repositories[0]?.templates?.[0]?.agentId).toBeUndefined()
    expect(store.get().agents).toEqual([])
    expect(store.get().tasks[0]?.harness).toMatchObject({
      resources: { hooks: [{ name: 'format' }] },
      provider: 'codex',
      instructions: 'Review',
    })
    expect(store.get().tasks[0]?.agentOverrides?.model).toBe('override')
    expect(new WorkspaceStore(db).get().tasks[0]?.harness).toEqual(store.get().tasks[0]?.harness)
    expect(() => store.removeAgent(agent.id)).not.toThrow()
  } finally {
    db.close()
  }
})

it('does not delete a configuration used by an automation', () => {
  const db = openDatabase(':memory:')
  try {
    const store = new WorkspaceStore(db)
    store.patch({
      collection: 'agents',
      id: 'used',
      changes: {},
      create: {
        id: 'used',
        name: 'Used',
        provider: 'claude',
        model: '',
        instructions: '',
        permission: 'ask',
        endpoint: '',
      },
    })
    store.update((workspace) => ({
      ...workspace,
      automations: [
        {
          id: 'flow',
          name: 'Review',
          edges: [],
          nodes: [
            {
              id: 'node',
              type: 'automation',
              position: { x: 0, y: 0 },
              data: {
                kind: 'task',
                label: 'Review',
                trigger: 'manual',
                schedule: '',
                timezone: '',
                objective: '',
                agentId: 'used',
                repositoryId: '',
              },
            },
          ],
        },
      ],
    }))
    expect(() => store.removeAgent('used')).toThrow(/automations/)
    expect(store.get().agents).toHaveLength(1)
  } finally {
    db.close()
  }
})

it('accepts the next draft after sending consumed its baseline, but protects competing unsent edits', () => {
  const db = openDatabase(':memory:')
  try {
    const store = new WorkspaceStore(db)
    const task: Task = {
      id: 'sent-draft',
      title: 'Draft race',
      agentId: '',
      repositoryId: '',
      status: 'review',
      createdAt: '',
      draft: '',
      files: [],
      example: false,
      messages: [{ id: 'sent', role: 'user', text: 'Already sent' }],
    }
    store.update((w) => ({ ...w, tasks: [task] }))
    const edit = (before: string, after: string) =>
      store.patch({
        collection: 'tasks',
        id: task.id,
        changes: { draft: { before, after } },
      })
    edit('  Already sent  ', 'Next message')
    expect(store.task(task.id).draft).toBe('Next message')
    expect(() => edit('Already sent', 'Competing edit')).toThrow('Another client changed draft')
    edit('Next message', '')
    expect(() => edit('Unsent elsewhere', 'Do not overwrite')).toThrow(
      'Another client changed draft',
    )
    store.update((w) => ({
      ...w,
      tasks: [{ ...task, queue: [{ id: 'queued', role: 'user', text: 'Queued', createdAt: '' }] }],
    }))
    edit('Queued', 'Following queued message')
    expect(store.task(task.id).draft).toBe('Following queued message')
  } finally {
    db.close()
  }
})

it('allows draft worktree selection and keeps setup state runtime-owned', () => {
  const db = openDatabase(':memory:')
  try {
    const store = new WorkspaceStore(db)
    const draft: Task = {
      id: 'worktree-draft',
      title: 'New task',
      agentId: '',
      repositoryId: 'repo',
      status: 'draft',
      createdAt: '',
      messages: [],
      files: [],
      draft: '',
      example: false,
      execution: 'main',
    }
    store.update((w) => ({ ...w, tasks: [draft] }))
    store.patch({
      collection: 'tasks',
      id: draft.id,
      changes: {
        execution: { before: 'main', after: 'worktree' },
        existingWorktreePath: { before: null, after: '/repo/existing' },
      },
    })
    expect(new WorkspaceStore(db).task(draft.id)).toMatchObject({
      existingWorktreePath: '/repo/existing',
      worktreeSetupComplete: true,
    })
    expect(() =>
      store.patch({
        collection: 'tasks',
        id: draft.id,
        changes: { worktreeSetupComplete: { before: true, after: false } },
      }),
    ).toThrow('Cannot edit worktreeSetupComplete')
    store.patch({
      collection: 'tasks',
      id: draft.id,
      changes: {
        execution: { before: 'worktree', after: 'main' },
        existingWorktreePath: { before: '/repo/existing', after: null },
      },
    })
    expect(store.task(draft.id).worktreeSetupComplete).toBeUndefined()
    expect(store.task(draft.id).existingWorktreePath).toBeUndefined()
    store.updateTask(draft.id, (task) => ({
      ...task,
      messages: [{ id: 'message', role: 'user', text: 'Start' }],
    }))
    expect(() =>
      store.patch({
        collection: 'tasks',
        id: draft.id,
        changes: { existingWorktreePath: { before: null, after: '/repo/other' } },
      }),
    ).toThrow('before sending the first message')
    expect(store.task(draft.id).existingWorktreePath).toBeUndefined()
  } finally {
    db.close()
  }
})

it('persists a history revision for removals while appends and streaming keep it stable', () => {
  const db = openDatabase(':memory:')
  try {
    const store = new WorkspaceStore(db)
    const message = (id: string) => ({ id, role: 'assistant' as const, text: id })
    store.update((workspace) => ({
      ...workspace,
      tasks: [
        {
          id: 'history',
          title: 'History',
          repositoryId: '',
          agentId: '',
          status: 'done',
          createdAt: new Date().toISOString(),
          messages: [message('a'), message('b')],
          files: [],
          draft: '',
          example: false,
        },
      ],
    }))
    store.updateTask('history', (task) => ({ ...task, messages: [...task.messages, message('c')] }))
    expect(store.task('history').historyRevision).toBeUndefined()
    store.updateTask('history', (task) => ({
      ...task,
      messages: task.messages.map((entry) => ({ ...entry, text: 'Streaming' })),
    }))
    expect(store.task('history').historyRevision).toBeUndefined()
    store.updateTask('history', (task) => ({
      ...task,
      messages: task.messages.filter((entry) => entry.id !== 'b'),
    }))
    expect(store.task('history').historyRevision).toBe(1)
    expect(new WorkspaceStore(db).task('history').historyRevision).toBe(1)
    store.updateTask('history', (task) => ({ ...task, messages: task.messages.slice(0, 1) }))
    expect(store.task('history').historyRevision).toBe(2)
  } finally {
    db.close()
  }
})

it.each([
  'agents',
  'repositories',
  'tasks',
  'automations',
  'jiraSources',
  'jiraIssueLinks',
] as const)(
  'rejects duplicate %s identities without changing live state or persisted history',
  (collection) => {
    const db = openDatabase(':memory:')
    try {
      const store = new WorkspaceStore(db)
      const task: Task = {
        id: 'task',
        title: 'Saved conversation',
        agentId: '',
        repositoryId: 'repo',
        status: 'review',
        createdAt: '',
        draft: '',
        messages: [{ id: 'saved', role: 'user', text: 'Preserve this history' }],
        files: [],
        example: false,
      }
      const workspace: Workspace = {
        version: 1,
        runtimeAddress: '',
        agents: [{ ...defaultTaskHarness('codex'), id: 'agent', name: 'Agent' }],
        repositories: [{ id: 'repo', name: 'Repository', path: '/repo', branch: 'main' }],
        tasks: [task],
        automations: [{ id: 'flow', name: 'Automation', nodes: [], edges: [] }],
        jiraSources: [{ id: 'jira', site: 'https://team.atlassian.net', project: 'TEAM' }],
        jiraIssueLinks: [{ sourceId: 'jira', issueId: 'TEAM-1', repositoryId: 'repo' }],
      }
      store.update(() => workspace)
      const before = store.get()
      const revision = store.version()
      const document = db.prepare('SELECT value FROM documents WHERE id=?').get('workspace')
      const history = db.prepare('SELECT * FROM conversation_items').all()
      const duplicate =
        collection === 'tasks'
          ? {
              ...task,
              messages: [{ id: 'other', role: 'user' as const, text: 'Different history' }],
            }
          : collection === 'jiraIssueLinks'
            ? { sourceId: 'jira', issueId: 'TEAM-1', repositoryId: 'other-repo' }
            : workspace[collection]?.[0]
      expect(() =>
        store.update((current) => ({
          ...current,
          [collection]: [...(current[collection] ?? []), duplicate],
        })),
      ).toThrow(/Duplicate/)
      expect(store.get()).toBe(before)
      expect(store.version()).toBe(revision)
      expect(db.prepare('SELECT value FROM documents WHERE id=?').get('workspace')).toEqual(
        document,
      )
      expect(db.prepare('SELECT * FROM conversation_items').all()).toEqual(history)
      expect(new WorkspaceStore(db).get()).toEqual(before)
    } finally {
      db.close()
    }
  },
)

it('removes duplicate legacy example IDs before validating real task identities', () => {
  const db = openDatabase(':memory:')
  try {
    const task: Task = {
      id: 'shared',
      title: 'Real conversation',
      agentId: '',
      repositoryId: '',
      status: 'review',
      createdAt: '',
      draft: '',
      messages: [{ id: 'saved', role: 'user', text: 'Real history' }],
      files: [],
      example: false,
    }
    const workspace: Workspace = {
      version: 1,
      runtimeAddress: '',
      agents: [],
      repositories: [],
      automations: [],
      tasks: [task, { ...task, example: true }],
    }
    db.prepare('INSERT INTO documents VALUES (?, ?)').run('workspace', JSON.stringify(workspace))
    const store = new WorkspaceStore(db)
    expect(store.get().tasks).toEqual([task])
    expect(new WorkspaceStore(db).get().tasks).toEqual([task])
  } finally {
    db.close()
  }
})

it('restores workspace caches and receipts after a failed enclosing transaction with nested updates', () => {
  const db = openDatabase(':memory:')
  try {
    const store = new WorkspaceStore(db)
    const task: Task = {
      id: 'transaction-task',
      title: 'Transaction',
      repositoryId: '',
      agentId: '',
      status: 'review',
      createdAt: '',
      messages: [{ id: 'saved', role: 'user', text: 'Saved' }],
      files: [],
      draft: '',
      example: false,
    }
    store.update((workspace) => ({ ...workspace, tasks: [task] }))
    const before = store.get()
    const projected = store.publicWorkspace()
    const revision = store.version()
    const history = db.prepare('SELECT * FROM conversation_items').all()
    const document = db.prepare('SELECT value FROM documents WHERE id=?').get('workspace')
    expect(() =>
      store.transaction(() => {
        store.updateTask(
          task.id,
          (current) => ({
            ...current,
            messages: [...current.messages, { id: 'temporary', role: 'user', text: 'Temporary' }],
          }),
          { id: 'submission', fingerprint: 'fingerprint' },
          {
            id: 'action',
            taskId: task.id,
            attemptId: 'run',
            kind: 'answer',
            state: 'pending',
          },
        )
        expect(store.task(task.id).messages).toHaveLength(2)
        store.transaction(() =>
          store.updateTask(task.id, (current) => ({ ...current, title: 'Tentative' })),
        )
        expect(store.publicWorkspace().tasks[0].title).toBe('Tentative')
        db.prepare('INSERT INTO documents VALUES (?, ?)').run('workspace', 'duplicate')
      }),
    ).toThrow(/UNIQUE constraint/)
    expect(store.get()).toBe(before)
    expect(store.publicWorkspace()).toBe(projected)
    expect(store.version()).toBe(revision)
    expect(store.taskSubmission(task.id, 'submission')).toBeUndefined()
    expect(store.providerActions.state('action')).toBeUndefined()
    expect(db.prepare('SELECT * FROM conversation_items').all()).toEqual(history)
    expect(db.prepare('SELECT value FROM documents WHERE id=?').get('workspace')).toEqual(document)
    expect(new WorkspaceStore(db).get()).toEqual(before)
  } finally {
    db.close()
  }
})
