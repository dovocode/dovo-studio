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
    'thread',
    'terminal',
    'thread',
    'terminal',
    'browser',
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
    'same',
    'assistant',
  ])
})
