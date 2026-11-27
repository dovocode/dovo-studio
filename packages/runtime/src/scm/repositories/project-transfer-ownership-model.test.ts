import { readFileSync } from 'node:fs'
import type { Task } from '@dovo/protocol'
import { expect, it } from 'vite-plus/test'
import { openDatabase } from '../../storage/database.js'
import { WorkspaceStore } from '../../storage/workspace.js'
import {
  carryTransferOwnership,
  createFenceTable,
  reconcileTransferOwnership,
  recordFence,
} from './project-transfer-fences.js'

type SourceProjection = 'owned' | 'blocked' | { moved: { transfer: number } }
type Receipt = 'discarded' | { staged: { task: number } } | { activated: { task: number } }
type Staged = { staged: { transfer: number; task: number } }
type DestinationProjection = Staged | { active: { task: number } }
type SourceCase = {
  source: { name: string; currentFence: number | null; backup: SourceProjection | null }
  restored: SourceProjection | null
}
type DestinationCase = {
  destination: {
    name: string
    transfer: number
    current: Receipt | null
    backupReceipt: Receipt | null
    backupTask: DestinationProjection | null
  }
  receipt: Receipt | null
  restored: DestinationProjection | null
}

const cases = readFileSync(
  new URL('../../../../../verification/thread-handoff-cases.jsonl', import.meta.url),
  'utf8',
)
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line) as SourceCase | DestinationCase)

type Database = ReturnType<typeof openDatabase>
type Handoff = NonNullable<Task['machineHandoff']>
const taskId = (task: number) => `thread-${task}`
const transferId = (transfer: number) => `transfer-${transfer}`
const handoff = <State extends Handoff['state']>(transfer: number, state: State) => ({
  id: transferId(transfer),
  targetRuntimeId: 'other-computer',
  state,
})

function sourceHandoff(projection: SourceProjection): Handoff | undefined {
  if (projection === 'owned') return undefined
  if (projection === 'blocked') return handoff(0, 'preparing')
  return handoff(projection.moved.transfer, 'moved')
}

function destinationThread(projection: DestinationProjection) {
  if ('active' in projection) return { task: projection.active.task, machineHandoff: undefined }
  return {
    task: projection.staged.task,
    machineHandoff: handoff(projection.staged.transfer, 'staged'),
  }
}

function seedThread(db: Database, task: number, machineHandoff: Handoff | undefined) {
  const store = new WorkspaceStore(db)
  const thread: Task = {
    id: taskId(task),
    title: 'Saved thread',
    agentId: '',
    repositoryId: '',
    status: 'draft',
    messages: [],
    draft: '',
    files: [],
    createdAt: '',
    example: false,
    machineHandoff,
  }
  store.update((workspace) => ({ ...workspace, tasks: [thread] }))
}

function storedReceipt(transfer: number, receipt: Receipt) {
  const base = { id: transferId(transfer), device: 'owner' }
  if (receipt === 'discarded') return { ...base, discarded: true }
  const task = 'activated' in receipt ? receipt.activated.task : receipt.staged.task
  return {
    ...base,
    result: { taskId: taskId(task), repositoryId: 'repository', path: '/project' },
    ...('activated' in receipt ? { activated: true } : {}),
  }
}

function seedReceipt(db: Database, transfer: number, receipt: Receipt | null) {
  db.exec('CREATE TABLE project_transfer_receipts (id TEXT PRIMARY KEY, value TEXT NOT NULL)')
  if (receipt)
    db.prepare('INSERT INTO project_transfer_receipts VALUES (?,?)').run(
      transferId(transfer),
      JSON.stringify(storedReceipt(transfer, receipt)),
    )
}

function restoreAndStart(
  seed: (current: Database, backup: Database) => void,
  verify: (store: WorkspaceStore, db: Database) => void,
) {
  const current = openDatabase(':memory:')
  const backup = openDatabase(':memory:')
  try {
    reconcileTransferOwnership(current, new WorkspaceStore(current))
    seed(current, backup)
    backup.transaction(() => carryTransferOwnership(backup, current))()
    for (let startup = 0; startup < 2; startup++) {
      const store = new WorkspaceStore(backup)
      reconcileTransferOwnership(backup, store)
      verify(store, backup)
    }
  } finally {
    backup.close()
    current.close()
  }
}

it.each(cases.filter((row) => 'source' in row))(
  'matches the Lean source restore model when $source.name',
  ({ source: { currentFence, backup }, restored }) => {
    restoreAndStart(
      (current, staged) => {
        if (currentFence !== null) recordFence(current, taskId(1), handoff(currentFence, 'moved'))
        if (backup !== null) seedThread(staged, 1, sourceHandoff(backup))
        if (backup && typeof backup === 'object') {
          createFenceTable(staged)
          recordFence(staged, taskId(1), handoff(backup.moved.transfer, 'moved'))
        }
      },
      (store, db) => {
        expect(store.get().tasks.map(({ id, machineHandoff }) => ({ id, machineHandoff }))).toEqual(
          restored === null ? [] : [{ id: taskId(1), machineHandoff: sourceHandoff(restored) }],
        )
        const fence = db
          .prepare('SELECT value FROM project_transfer_fences WHERE task_id=?')
          .pluck()
          .get(taskId(1))
        expect(typeof fence === 'string' ? JSON.parse(fence) : fence).toEqual(
          currentFence === null ? undefined : handoff(currentFence, 'moved'),
        )
      },
    )
  },
)

it.each(cases.filter((row) => 'destination' in row))(
  'matches the Lean destination restore model when $destination.name',
  ({ destination: { transfer, current, backupReceipt, backupTask }, receipt, restored }) => {
    restoreAndStart(
      (live, staged) => {
        seedReceipt(live, transfer, current)
        seedReceipt(staged, transfer, backupReceipt)
        if (backupTask) {
          const { task, machineHandoff } = destinationThread(backupTask)
          seedThread(staged, task, machineHandoff)
        }
      },
      (store, db) => {
        const stored = db
          .prepare('SELECT value FROM project_transfer_receipts WHERE id=?')
          .pluck()
          .get(transferId(transfer))
        expect(typeof stored === 'string' ? JSON.parse(stored) : stored).toEqual(
          receipt === null ? undefined : storedReceipt(transfer, receipt),
        )
        const expected = restored === null ? [] : [destinationThread(restored)]
        expect(store.get().tasks.map(({ id, machineHandoff }) => ({ id, machineHandoff }))).toEqual(
          expected.map(({ task, machineHandoff }) => ({ id: taskId(task), machineHandoff })),
        )
      },
    )
  },
)
