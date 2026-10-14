import { expect, it } from 'vite-plus/test'
import {
  decode,
  runtimeProfile,
  snapshotSchema,
  taskSchema,
  type RuntimeOverview,
  type Subagent,
} from '@dovo/protocol'
import { taskListProjection } from './task-list-projection'

it('retains mobile pill data across native agent payload updates but refreshes visible activity', () => {
  const source = overview()
  const snapshot = source.snapshot!
  const native: Subagent = {
    id: 'native',
    provider: 'codex',
    name: 'Native agent',
    status: 'working' as const,
    sessionLive: true,
    startedAt: '',
    updatedAt: '',
    activity: 'Reading',
  }
  const publish = (record: Subagent) => ({
    ...source,
    snapshot: {
      ...snapshot,
      workspace: {
        ...snapshot.workspace,
        tasks: snapshot.workspace.tasks.map((task) =>
          task.id === 'running' ? { ...task, subagents: [record] } : task,
        ),
      },
    },
  })
  const key = JSON.stringify([source.profile.id, 'running'])
  const initial = taskListProjection([publish(native)], now)
  const payload = { ...native, updatedAt: 'later', result: 'large result'.repeat(10000) }
  const next = taskListProjection([publish(payload)], now, initial)
  expect(next.get(key)?.subagents).toBe(initial.get(key)?.subagents)
  expect(next.get(key)?.subagents[0]).not.toHaveProperty('result')
  const visible = taskListProjection([publish({ ...payload, activity: 'Testing' })], now, next)
  expect(visible.get(key)?.subagents).not.toBe(next.get(key)?.subagents)
  expect(visible.get(key)?.subagents[0]?.activity).toBe('Testing')
  const finished = taskListProjection([publish({ ...native, status: 'completed' })], now, visible)
  expect(finished.get(key)?.subagents).toEqual([])
})

const task = (id: string) =>
  decode(taskSchema, {
    id,
    title: id,
    repositoryId: 'repo',
    agentId: '',
    status: 'running',
    createdAt: '2026-10-13T12:00:00Z',
    messages: [],
    files: [],
    draft: '',
    example: false,
  })
function overview(): RuntimeOverview {
  return {
    profile: runtimeProfile(
      { address: 'http://owner.lan:8787', token: 'owner-private-token-at-least-32-characters' },
      'Owner',
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
        repositories: [{ id: 'repo', name: 'Project', path: '/project', branch: 'main' }],
        agents: [],
        automations: [],
        tasks: [task('running'), task('untouched')],
      },
      questions: [],
      approvals: [],
      terminals: [],
      runs: [],
      devices: [],
      pendingDevices: [],
      acpInstallations: [],
    }),
  }
}
const now = Date.parse('2026-10-13T12:00:01Z')
it('retains unrelated rows and owner facts across streamed snapshots', () => {
  const source = overview()
  const initial = taskListProjection([source], now)
  const snapshot = source.snapshot!
  const next = taskListProjection(
    [
      {
        ...source,
        snapshot: {
          ...snapshot,
          revision: 2,
          acpInstallations: [],
          workspace: {
            ...snapshot.workspace,
            tasks: snapshot.workspace.tasks.map((task) =>
              task.id === 'running'
                ? { ...task, messages: [{ id: 'reply', role: 'assistant', text: 'chunk' }] }
                : task,
            ),
          },
        },
      },
    ],
    now,
    initial,
  )
  const key = (id: string) => JSON.stringify([source.profile.id, id])
  expect(next.get(key('untouched'))).toBe(initial.get(key('untouched')))
  expect(next.get(key('running'))?.row.task.messages[0].text).toBe('chunk')
  expect(next.get(key('running'))?.owner).toBe(initial.get(key('running'))?.owner)
})

it('updates owner metadata, input state and child pills without retaining removed tasks', () => {
  const source = overview(),
    snapshot = source.snapshot!
  const child = {
    ...task('child'),
    delegation: { parentTaskId: 'untouched', parentRunId: 'run', key: 'child' },
  }
  const record = {
    id: 'child',
    taskId: 'child',
    source: 'dovo' as const,
    name: 'Child',
    provider: 'codex' as const,
    status: 'working' as const,
    startedAt: '',
    updatedAt: '',
  }
  const tasks = snapshot.workspace.tasks.map((task) =>
    task.id === 'untouched' ? { ...task, subagents: [record] } : task,
  )
  const withChild = {
    ...source,
    snapshot: { ...snapshot, workspace: { ...snapshot.workspace, tasks: [...tasks, child] } },
  }
  const initial = taskListProjection([withChild], now)
  const next = taskListProjection(
    [
      {
        ...withChild,
        snapshot: {
          ...withChild.snapshot,
          approvals: [
            { id: 'approval', taskId: 'child', title: 'Allow', detail: '', createdAt: '' },
          ],
          workspace: {
            ...snapshot.workspace,
            repositories: [{ ...snapshot.workspace.repositories[0], branch: 'changed' }],
            tasks: [...tasks, child],
          },
        },
      },
    ],
    now,
    initial,
  )
  const key = JSON.stringify([source.profile.id, 'untouched'])
  expect(next.get(key)?.row.needsInput).toBe(true)
  expect(next.get(key)?.owner.repository?.branch).toBe('changed')
  expect(next.get(key)?.subagents).toBe(initial.get(key)?.subagents)
  const removed = taskListProjection([source], now, next)
  expect(removed.has(JSON.stringify([source.profile.id, 'child']))).toBe(false)
  expect(removed.get(key)?.subagents).toEqual([])
})
