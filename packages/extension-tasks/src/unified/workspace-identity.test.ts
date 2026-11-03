import { expect, it } from 'vite-plus/test'
import { decode, runtimeProfile, STUDIO_TERMINAL_SCOPE, taskSchema } from '@dovo/protocol'
import {
  workspaceIdentity,
  standaloneTerminalTabAvailability,
  type WorkspaceIdentityComputer,
  type WorkspaceIdentitySources,
} from './workspace-identity'
import {
  openWorkspaceTab,
  reconcileWorkspaceTabs,
  workspaceTabKey,
  type WorkspaceTabs,
} from './workspace-tabs'
import type { BrowserTab } from '../browser/shared-browser-tabs'

const task = decode(taskSchema, {
  id: 'same',
  title: 'Ship release',
  repositoryId: 'project',
  agentId: '',
  status: 'review',
  createdAt: '2026-11-03T10:00:00Z',
  messages: [],
  files: [],
  draft: '',
  example: false,
})
const owner: WorkspaceIdentityComputer = {
  profile: {
    ...runtimeProfile(
      { address: 'http://mac.local:51464', token: 'test-token-for-identity-fixture' },
      'Build Mac',
    ),
    id: 'mac',
  },
  connected: true,
  snapshot: {
    runtimeHost: 'mac-host',
    workspace: {
      tasks: [task],
      repositories: [{ id: 'project', name: 'App', path: '/app', branch: 'main' }],
    },
    terminals: [
      {
        id: 'same',
        taskId: STUDIO_TERMINAL_SCOPE,
        repositoryId: 'project',
        title: 'Dev server',
        shellId: 'bash',
        directory: '/worktrees/app',
        execution: 'worktree',
        exited: true,
        exitCode: 7,
        pinned: true,
        settledAt: '2026-11-03T10:00:00Z',
      },
    ],
  },
}
const page: BrowserTab = {
  id: 'same',
  kind: 'remote',
  runtimeId: 'mac',
  title: 'Dashboard',
  url: 'http://vpn.local:3000/app',
  profileId: 'private-00000000-0000-4000-8000-000000000001',
}
const sources: WorkspaceIdentitySources = { computers: [owner], browserTabs: [page] }
it('identifies colliding thread/page/terminal IDs with actual context instead of generic type names', () => {
  const thread = workspaceIdentity({ kind: 'thread', runtimeId: 'mac', id: 'same' }, sources)
  expect(thread).toMatchObject({
    kindLabel: 'Thread',
    title: 'Ship release',
    project: 'App',
    computer: 'Build Mac',
    status: 'Review',
    availability: 'present',
  })
  const terminal = workspaceIdentity({ kind: 'terminal', runtimeId: 'mac', id: 'same' }, sources)
  expect(terminal).toMatchObject({
    kindLabel: 'Terminal',
    title: 'Dev server',
    project: 'App',
    computer: 'Build Mac',
    shell: 'Bash',
    directory: '/worktrees/app',
    status: 'Exited (7)',
    availability: 'present',
  })
  const browser = workspaceIdentity({ kind: 'browser', runtimeId: '', id: 'same' }, sources)
  expect(browser).toMatchObject({
    kindLabel: 'Page',
    title: 'Dashboard',
    host: 'vpn.local:3000',
    private: true,
    computer: 'Build Mac',
    availability: 'present',
  })
  expect(browser.detail).toContain('Private')
  expect(terminal.detail).toContain('/worktrees/app')
  expect(page.url).toBe('http://vpn.local:3000/app')
})
it('keeps settled/exited resources identifiable without changing lifecycle fields or snapshot state', () => {
  const before = JSON.stringify(sources)
  const settledOwner = {
    ...owner,
    snapshot: {
      ...owner.snapshot!,
      workspace: { ...owner.snapshot!.workspace, tasks: [{ ...task, archived: true }] },
    },
  }
  expect(
    workspaceIdentity(
      { kind: 'thread', runtimeId: 'mac', id: 'same' },
      { ...sources, computers: [settledOwner] },
    ).status,
  ).toBe('Settled')
  expect(
    workspaceIdentity({ kind: 'terminal', runtimeId: 'mac', id: 'same' }, sources).availability,
  ).toBe('present')
  expect(JSON.stringify(sources)).toBe(before)
})
it('preserves known identity from offline snapshots and distinguishes missing owners from unhydrated items', () => {
  const offline = { ...sources, computers: [{ ...owner, connected: false }] }
  expect(
    workspaceIdentity({ kind: 'terminal', runtimeId: 'mac', id: 'same' }, offline),
  ).toMatchObject({ title: 'Dev server', offline: true, availability: 'present' })
  expect(
    workspaceIdentity({ kind: 'thread', runtimeId: 'mac', id: 'not-in-overview' }, sources)
      .availability,
  ).toBe('unknown')
  expect(
    workspaceIdentity({ kind: 'terminal', runtimeId: 'mac', id: 'new-shell' }, sources)
      .availability,
  ).toBe('unknown')
  expect(
    workspaceIdentity(
      { kind: 'terminal', runtimeId: 'mac', id: 'same' },
      { ...sources, computers: [{ ...owner, snapshot: null }] },
    ).availability,
  ).toBe('unknown')
  expect(
    workspaceIdentity({ kind: 'thread', runtimeId: 'removed-owner', id: 'same' }, sources),
  ).toMatchObject({ availability: 'unknown', status: 'Computer unavailable' })
  expect(
    workspaceIdentity(
      { kind: 'browser', runtimeId: '', id: 'same' },
      { ...sources, computers: [] },
    ),
  ).toMatchObject({ availability: 'unknown', computer: 'Unavailable computer' })
})
it('keeps missing browser pages recoverable during hydration and delayed create snapshots', () => {
  const tab = { kind: 'browser', runtimeId: '', id: 'closed' } as const
  expect(workspaceIdentity(tab, { ...sources, browserTabs: undefined }).availability).toBe(
    'unknown',
  )
  expect(workspaceIdentity(tab, { ...sources, browserTabs: [] })).toMatchObject({
    availability: 'unknown',
    status: 'Page unavailable',
  })
  expect(workspaceIdentity({ ...tab, id: 'new' }, { ...sources, browserTabs: [] })).toMatchObject({
    availability: 'present',
    title: 'New page',
  })
  const blank = { ...page, runtimeId: undefined, url: '', title: '', profileId: 'work' }
  expect(
    workspaceIdentity({ ...tab, id: 'same' }, { ...sources, browserTabs: [blank] }),
  ).toMatchObject({ computer: 'Local browser', private: false, host: undefined, title: 'New page' })
})
it('identifies home shells but withholds thread shell identity from global workspaces', () => {
  const terminals = [
    { id: 'home', taskId: STUDIO_TERMINAL_SCOPE, title: '', exited: false },
    { id: 'thread-shell', taskId: task.id, title: 'Tests', exited: false },
  ]
  const computers = [{ ...owner, snapshot: { ...owner.snapshot!, terminals } }]
  expect(
    workspaceIdentity(
      { kind: 'terminal', runtimeId: 'mac', id: 'home' },
      { ...sources, computers },
    ),
  ).toMatchObject({ project: 'Home folder', shell: 'Shell', status: 'Running' })
  expect(
    workspaceIdentity(
      { kind: 'terminal', runtimeId: 'mac', id: 'thread-shell' },
      { ...sources, computers },
    ),
  ).toMatchObject({
    availability: 'missing',
    title: 'Terminal session',
    status: 'Not a standalone terminal',
  })
  const identity = workspaceIdentity(
    { kind: 'terminal', runtimeId: 'mac', id: 'thread-shell' },
    { ...sources, computers },
  )
  expect(identity.project).toBeUndefined()
  expect(identity.shell).toBeUndefined()
  expect(identity.directory).toBeUndefined()
})

it('reconciles only confirmed online thread-shell references and never changes shell snapshots', () => {
  const threadShell = {
    id: 'thread-shell',
    taskId: task.id,
    title: 'Thread-only tests',
    exited: false,
    shellId: 'bash',
    directory: '/thread-private-folder',
    repositoryId: 'project',
  }
  const computers = [
    {
      ...owner,
      snapshot: {
        ...owner.snapshot!,
        terminals: [...owner.snapshot!.terminals, threadShell],
      },
    },
  ]
  let state: WorkspaceTabs = { tabs: [], active: '' }
  for (const tab of [
    { kind: 'terminal', runtimeId: 'mac', id: 'same' },
    { kind: 'browser', runtimeId: '', id: 'same' },
    { kind: 'terminal', runtimeId: 'other-computer', id: 'thread-shell' },
    { kind: 'terminal', runtimeId: 'mac', id: 'thread-shell' },
  ] as const)
    state = openWorkspaceTab(state, tab)
  const before = JSON.stringify(computers)
  const reconciled = reconcileWorkspaceTabs(state, (tab) =>
    standaloneTerminalTabAvailability(tab, computers),
  )
  expect(reconciled.tabs).toEqual(state.tabs.slice(0, -1))
  expect(reconciled.active).toBe(workspaceTabKey(state.tabs[2]))
  expect(JSON.stringify(computers)).toBe(before)
  expect(threadShell.exited).toBe(false)
  expect(standaloneTerminalTabAvailability(state.tabs[0], computers)).toBe('present')
  expect(
    standaloneTerminalTabAvailability(
      { kind: 'terminal', runtimeId: 'mac', id: 'not-yet-snapshotted' },
      computers,
    ),
  ).toBe('unknown')

  for (const unavailable of [
    [],
    [{ ...computers[0], connected: false }],
    [{ ...computers[0], snapshot: null }],
  ]) {
    expect(
      reconcileWorkspaceTabs(state, (tab) => standaloneTerminalTabAvailability(tab, unavailable)),
    ).toBe(state)
  }
  const offlineIdentity = workspaceIdentity(state.tabs[3], {
    ...sources,
    computers: [{ ...computers[0], connected: false }],
  })
  expect(offlineIdentity).toMatchObject({
    availability: 'unknown',
    offline: true,
    title: 'Terminal session',
  })
  expect(offlineIdentity.detail).not.toContain('Thread-only tests')
  expect(offlineIdentity.detail).not.toContain('/thread-private-folder')
})

it('provides original repository icon metadata, branch and genuine age timestamps for familiar rows', () => {
  const repository = owner.snapshot!.workspace.repositories[0]
  const thread = workspaceIdentity({ kind: 'thread', runtimeId: 'mac', id: 'same' }, sources)
  expect(thread.repository).toBe(repository)
  expect(thread).toMatchObject({
    project: 'App',
    avatarLabel: 'App',
    branch: 'main',
    activityAt: new Date(task.createdAt).toISOString(),
  })
  const terminal = workspaceIdentity({ kind: 'terminal', runtimeId: 'mac', id: 'same' }, sources)
  expect(terminal.repository).toBe(repository)
  expect(terminal).toMatchObject({ avatarLabel: 'App', activityAt: '2026-11-03T10:00:00.000Z' })
  // A worktree without a reported branch must not borrow the main checkout's branch.
  expect(terminal.branch).toBeUndefined()
  const browser = workspaceIdentity(
    { kind: 'browser', runtimeId: '', id: 'same' },
    {
      ...sources,
      browserTabs: [{ ...page, visitedAt: 1000, lastActiveAt: 2000 }],
    },
  )
  expect(browser).toMatchObject({
    avatarLabel: 'vpn.local:3000',
    activityAt: '1970-01-01T00:00:02.000Z',
  })
  expect(browser.repository).toBeUndefined()
})

it('uses reported checkout branches and leaves absent or unusable ages unset', () => {
  const computers = [
    {
      ...owner,
      snapshot: {
        ...owner.snapshot!,
        workspace: {
          ...owner.snapshot!.workspace,
          tasks: [{ ...task, checkoutBranch: 'feature/thread' }],
        },
        terminals: [
          {
            ...owner.snapshot!.terminals[0],
            checkoutBranch: 'feature/shell',
            settledAt: undefined,
          },
        ],
      },
    },
  ]
  expect(
    workspaceIdentity({ kind: 'thread', runtimeId: 'mac', id: 'same' }, { ...sources, computers })
      .branch,
  ).toBe('feature/thread')
  const terminal = workspaceIdentity(
    { kind: 'terminal', runtimeId: 'mac', id: 'same' },
    { ...sources, computers },
  )
  expect(terminal.branch).toBe('feature/shell')
  expect(terminal.activityAt).toBeUndefined()
  expect(
    workspaceIdentity(
      { kind: 'browser', runtimeId: '', id: 'same' },
      {
        ...sources,
        browserTabs: [{ ...page, visitedAt: 1e20 }],
      },
    ).activityAt,
  ).toBeUndefined()
})

it('never prunes tabs or drafts merely because a fresh resource or computer is absent from current snapshots', () => {
  let state: WorkspaceTabs = { tabs: [], active: '' }
  for (const tab of [
    { kind: 'terminal', runtimeId: 'mac', id: 'fresh-shell' },
    { kind: 'browser', runtimeId: '', id: 'fresh-page' },
    { kind: 'thread', runtimeId: 'mac', id: '' },
    { kind: 'thread', runtimeId: 'restoring-owner', id: 'draft' },
  ] as const)
    state = openWorkspaceTab(state, tab)
  for (const snapshotSources of [
    { computers: [], browserTabs: undefined },
    { computers: [], browserTabs: [] },
    { ...sources, browserTabs: [] },
    { ...sources, computers: [{ ...owner, connected: false }], browserTabs: [] },
  ]) {
    expect(
      reconcileWorkspaceTabs(state, (tab) => workspaceIdentity(tab, snapshotSources).availability),
    ).toBe(state)
  }
})
