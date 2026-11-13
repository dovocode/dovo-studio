import { expect, it } from 'vite-plus/test'
import {
  decode,
  runtimeProfile,
  snapshotSchema,
  STUDIO_TERMINAL_SCOPE,
  taskSchema,
  type RuntimeOverview,
  type TerminalInfo,
} from '@dovo/protocol'
import { workspaceItems } from './workspace-items'
import type { BrowserTab } from '../browser/browser-state'

const now = Date.parse('2026-11-03T12:00:00Z')
const task = decode(taskSchema, {
  id: 'same',
  title: 'Thread',
  repositoryId: 'project',
  agentId: '',
  status: 'running',
  createdAt: new Date(now).toISOString(),
  messages: [],
  files: [],
  draft: '',
  example: false,
})
const terminal: TerminalInfo = {
  id: 'same',
  taskId: STUDIO_TERMINAL_SCOPE,
  title: 'Shell',
  exited: false,
  repositoryId: 'project',
}
function computer(host = 'mac'): RuntimeOverview {
  return {
    profile: runtimeProfile(
      { address: `http://${host}.lan:8787`, token: 'private-device-token-at-least-32-characters' },
      host,
    ),
    connected: true,
    lastSeen: null,
    error: null,
    pulls: null,
    pullError: null,
    snapshot: decode(snapshotSchema, {
      revision: 1,
      owner: false,
      workspace: {
        version: 1,
        runtimeAddress: '',
        repositories: [{ id: 'project', name: 'Project', path: '/project', branch: 'main' }],
        agents: [],
        automations: [],
        tasks: [task],
      },
      approvals: [],
      questions: [],
      terminals: [terminal, { ...terminal, id: 'thread-shell', taskId: task.id }],
      runs: [],
      devices: [],
      pendingDevices: [],
    }),
  }
}
const page: BrowserTab = {
  id: 'same',
  kind: 'local',
  url: 'http://app.lan:3000',
  title: 'Page',
  profileId: 'device',
  visitedAt: now,
}

it('mixes resources while separating thread PTYs and namespacing identities by type and computer', () => {
  const items = workspaceItems([computer(), computer('linux')], [page], now)
  expect(items.map((item) => item.kind)).toEqual([
    'browser',
    'thread',
    'thread',
    'terminal',
    'terminal',
  ])
  expect(new Set(items.map((item) => item.key)).size).toBe(5)
  expect(items.find((item) => item.kind === 'browser')?.detail).toContain('app.lan:3000')
})

it('keeps pinned browser tiles above pinned threads and terminals', () => {
  const owner = computer()
  owner.snapshot!.workspace.tasks[0] = { ...task, pinned: true }
  owner.snapshot!.terminals[0] = { ...terminal, pinned: true }
  const items = workspaceItems([owner], [{ ...page, pinned: true }], now)
  expect(items.map((item) => [item.kind, item.section])).toEqual([
    ['browser', 'pinned'],
    ['thread', 'pinned'],
    ['terminal', 'pinned'],
  ])
})

it('includes an archived parent only when the thread tree needs it as context', () => {
  const owner = computer()
  owner.snapshot!.workspace.tasks = [
    { ...task, archivedAt: '2026-11-09T09:00:00Z' },
    { ...task, id: 'unrelated', archivedAt: '2026-11-09T09:00:00Z' },
  ]
  expect(workspaceItems([owner], [], now).filter((item) => item.kind === 'thread')).toEqual([])
  const items = workspaceItems(
    [owner],
    [],
    now,
    new Set([JSON.stringify([owner.profile.id, task.id])]),
  )
  expect(items.filter((item) => item.kind === 'thread').map((item) => item.task.id)).toEqual([
    task.id,
  ])
})

it('handles sleeping sessions, explicit terminal activity, waiting threads and expired snoozes', () => {
  const owner = computer()
  owner.snapshot!.workspace.tasks = [{ ...task, status: 'done', waitingForFeedback: true }]
  owner.snapshot!.terminals = [
    { ...terminal, id: 'sleeping', dormant: true, settledAt: new Date(now - 1000).toISOString() },
    { ...terminal, id: 'working', activity: { state: 'working', progress: 45 } },
    { ...terminal, id: 'blocked', activity: { state: 'blocked' } },
    { ...terminal, id: 'expired', snoozedUntil: new Date(now - 1000).toISOString() },
    { ...terminal, id: 'snoozed', snoozedUntil: new Date(now + 1000).toISOString() },
  ]
  const items = workspaceItems([owner], [], now)
  expect(items.map((item) => [item.title, item.section, item.status])).toEqual([
    ['Thread', 'waiting', 'Waiting'],
    ['Shell', 'settled', 'Sleeping'],
    ['Shell', 'working', 'Working 45%'],
    ['Shell', 'needs-input', 'Needs input'],
    ['Shell', 'active', 'Live session'],
    ['Shell', 'snoozed', 'Live session'],
  ])
})

it('retains offline sessions, excludes private/preview pages, and keeps pages with companion threads', () => {
  const owner = { ...computer(), connected: false }
  const items = workspaceItems(
    [owner],
    [
      page,
      { ...page, id: 'private', profileId: 'private-11111111-2222-3333-4444-555555555555' },
      { ...page, id: 'preview', previewOf: page.id },
      { ...page, id: 'assistant', thread: { id: task.id, runtimeId: owner.profile.id } },
    ],
    now,
  )
  expect(items.filter((item) => item.kind === 'terminal')).toMatchObject([
    { offline: true, status: 'Offline' },
  ])
  expect(items.filter((item) => item.kind === 'browser').map((item) => item.tab.id)).toEqual([
    'assistant',
    'same',
  ])
})

it('mixes page visits and latest prompts across computers, without moving on streamed output', () => {
  const owner = (id: string, prompt: string): RuntimeOverview => ({
    profile: {
      ...runtimeProfile(
        { address: 'http://' + id + '.lan', token: 'private-device-token-at-least-32-characters' },
        id,
      ),
      id,
    },
    connected: true,
    lastSeen: null,
    error: null,
    pulls: null,
    pullError: null,
    snapshot: decode(snapshotSchema, {
      revision: 1,
      owner: false,
      workspace: {
        version: 1,
        runtimeAddress: '',
        repositories: [],
        agents: [],
        automations: [],
        tasks: [
          decode(taskSchema, {
            id: 'same',
            repositoryId: '',
            title: id,
            lastPromptAt: prompt,
            agentId: '',
            messages: [],
            files: [],
            draft: '',
            example: false,
            createdAt: '2026-11-01T00:00:00Z',
            updatedAt: '2026-11-09T00:00:00Z',
            status: 'done',
          }),
        ],
      },
      terminals: [{ id: 'shell', taskId: 'studio:terminals', title: id + ' shell', exited: false }],
      questions: [],
      approvals: [],
      runs: [],
      devices: [],
      pendingDevices: [],
    }),
  })
  const owners = [owner('new', '2026-11-05T00:00:00Z'), owner('old', '2026-11-03T00:00:00Z')]
  const tab: BrowserTab = {
    kind: 'local',
    id: 'page',
    profileId: 'device',
    title: 'page',
    url: 'http://app.lan',
    visitedAt: Date.parse('2026-11-04T00:00:00Z'),
  }
  const titles = () => workspaceItems(owners, [tab], Date.now()).map((item) => item.title)
  expect(titles()).toEqual(['new', 'page', 'old', 'new shell', 'old shell'])
  owners[1].snapshot!.workspace.tasks[0].updatedAt = '2026-11-10T00:00:00Z'
  expect(titles()).toEqual(['new', 'page', 'old', 'new shell', 'old shell'])
})

it('keeps each Bot as one persistent thread row with its identity and paused state', () => {
  const owner = computer()
  const bot = decode(taskSchema, {
    ...task,
    status: 'done',
    title: 'Release assistant',
    bot: {
      role: 'Release lead',
      responsibilities: 'Check releases',
      state: 'paused',
      revision: '11111111-1111-4111-8111-111111111111',
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
    },
  })
  owner.snapshot!.workspace.tasks = [bot]
  owner.snapshot!.runs = []
  const threads = workspaceItems([owner], [], now).filter((item) => item.kind === 'thread')
  expect(threads).toHaveLength(1)
  expect(threads[0]).toMatchObject({
    title: 'Release assistant',
    status: 'Paused',
    runtimeId: owner.profile.id,
    key: JSON.stringify(['thread', owner.profile.id, bot.id]),
  })
  expect(threads[0].detail).toContain('Bot · Release lead')
  expect(threads[0].detail).not.toContain('Project')
})
