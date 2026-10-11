import { decode, snapshotSchema } from '@dovo/protocol'
import { expect, it } from 'vite-plus/test'
import { createTask } from './actions'
import { createWorkspace } from './seed'
import {
  previewWorkspace,
  withTaskPreview,
  taskPreviewConfirmed,
  type TaskPreview,
} from './task-previews'

const connection = { address: 'http://mac.local:51464', token: 'device-token' }
const task = createTask({ title: 'Task', repositoryId: 'repo', agentId: '', objective: '' })
const workspace = { ...createWorkspace(), tasks: [task] }
const preview = (): TaskPreview => ({
  id: Symbol(),
  connection,
  taskId: task.id,
  changes: { pinned: true },
})

it('updates immediately over stale snapshots without mutating the workspace or another host', async () => {
  let pending: TaskPreview[] = []
  let complete = () => {}
  const response = new Promise<{ revision: number }>((resolve) => {
    complete = () => resolve({ revision: 2 })
  })
  const operation = withTaskPreview(
    preview(),
    (update) => {
      pending = update(pending)
    },
    () => response,
  )
  expect(previewWorkspace(workspace, connection, pending).tasks[0]?.pinned).toBe(true)
  expect(previewWorkspace(workspace, { ...connection }, pending).tasks[0]?.pinned).toBe(true)
  expect(workspace.tasks[0]?.pinned).not.toBe(true)
  expect(
    previewWorkspace(workspace, { ...connection, address: 'http://other.local' }, pending),
  ).toBe(workspace)
  expect(previewWorkspace(workspace, { ...connection, token: 'replacement' }, pending)).toBe(
    workspace,
  )
  complete()
  await operation
  expect(pending[0]?.acknowledged).toEqual({ revision: 2 })
})

it('rolls back only the failed action and preserves newer server data and concurrent previews', async () => {
  let pending: TaskPreview[] = []
  const second = { ...preview(), changes: { title: 'New title' } }
  const operation = withTaskPreview(
    preview(),
    (update) => {
      pending = update(pending)
    },
    async () => {
      pending.push(second)
      throw new Error('Conflict')
    },
  )
  await expect(operation).rejects.toThrow('Conflict')
  expect(pending).toEqual([second])
  const latest = { ...workspace, tasks: [{ ...task, status: 'running' as const }] }
  const visible = previewWorkspace(latest, connection, pending)
  expect(visible.tasks[0]?.pinned).not.toBe(true)
  expect(visible.tasks[0]?.title).toBe('New title')
  expect(visible.tasks[0]?.status).toBe('running')
})

it('cleans up synchronous errors and leaves unchanged workspaces referentially stable', async () => {
  let pending: TaskPreview[] = []
  await expect(
    withTaskPreview(
      preview(),
      (update) => {
        pending = update(pending)
      },
      () => {
        throw new Error('Offline')
      },
    ),
  ).rejects.toThrow('Offline')
  expect(pending).toEqual([])
  expect(previewWorkspace(workspace, connection, pending)).toBe(workspace)
  expect(previewWorkspace(workspace, null, [preview()])).toBe(workspace)
  expect(previewWorkspace(workspace, connection, [{ ...preview(), taskId: 'missing' }])).toBe(
    workspace,
  )
  expect(
    previewWorkspace(workspace, connection, [{ ...preview(), changes: { pinned: task.pinned } }]),
  ).toBe(workspace)
  const other = createTask({ title: 'Other', repositoryId: 'repo', agentId: '', objective: '' })
  const withOther = { ...workspace, tasks: [task, other] }
  expect(previewWorkspace(withOther, connection, [preview()]).tasks[1]).toBe(other)
})

it('keeps an acknowledged preview over old snapshots until its commit is visible', () => {
  const snapshot = decode(snapshotSchema, {
    revision: 1,
    runtimeInstanceId: 'original',
    workspace,
    approvals: [],
    questions: [],
    terminals: [],
    runs: [],
    devices: [],
    pendingDevices: [],
    owner: false,
  })
  const committed: TaskPreview = {
    ...preview(),
    runtimeInstanceId: 'original',
    acknowledged: { revision: 2, runtimeInstanceId: 'original' },
  }
  expect(taskPreviewConfirmed(committed, snapshot)).toBe(false)
  expect(previewWorkspace(snapshot.workspace, connection, [committed]).tasks[0]?.pinned).toBe(true)
  expect(taskPreviewConfirmed(committed, { ...snapshot, revision: 2 })).toBe(true)
  // A restarted runtime's authoritative state wins even if its revision is lower.
  expect(
    taskPreviewConfirmed(committed, { ...snapshot, revision: 0, runtimeInstanceId: 'restarted' }),
  ).toBe(true)
  // An old cached instance is not confirmation of a write to the new instance.
  expect(
    taskPreviewConfirmed(
      { ...committed, acknowledged: { revision: 0, runtimeInstanceId: 'restarted' } },
      snapshot,
    ),
  ).toBe(false)
})
it('keeps a later confirmed edit covering an older request until that request settles', () => {
  const snapshot = decode(snapshotSchema, {
    revision: 3,
    workspace,
    approvals: [],
    questions: [],
    terminals: [],
    runs: [],
    devices: [],
    pendingDevices: [],
    owner: false,
  })
  const first = preview()
  const second = { ...preview(), changes: { pinned: false }, acknowledged: { revision: 3 } }
  const items = [first, second]
  expect(taskPreviewConfirmed(second, snapshot, items)).toBe(false)
  expect(previewWorkspace(workspace, connection, items).tasks[0]?.pinned).toBe(false)
  expect(taskPreviewConfirmed(second, snapshot, [second])).toBe(true)
  expect(
    taskPreviewConfirmed(second, snapshot, [{ ...first, acknowledged: { revision: 2 } }, second]),
  ).toBe(true)
})
