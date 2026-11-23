import { readFileSync } from 'node:fs'
import { expect, it } from 'vite-plus/test'
import type { Task } from '@dovo/protocol'
import { openDatabase } from './database.js'
import type { ProviderAction } from './provider-actions.js'
import { WorkspaceStore } from './workspace.js'

type ModelAction = {
  task: number
  attempt: number
  kind: ProviderAction['kind']
  status: ProviderAction['state']
}

type ModelCase = {
  input: {
    name: string
    actions: ModelAction[]
    activeAttempt: number | null
    preparingQueuedWork: boolean
    paused: boolean
  }
  recovered: ModelAction[]
  automatic: boolean
}

const cases = readFileSync(
  new URL('../../../../verification/provider-recovery-cases.jsonl', import.meta.url),
  'utf8',
)
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line) as ModelCase)

const attemptId = (attempt: number) => `attempt-${attempt}`
const taskId = (task: number) => `thread-${task}`
const journalAction = (action: ModelAction, index: number): ProviderAction => ({
  id: `action-${index}`,
  taskId: taskId(action.task),
  attemptId: attemptId(action.attempt),
  kind: action.kind,
  state: action.status,
})
const queue: NonNullable<Task['queue']> = [
  { id: 'follow-up', role: 'user', text: 'Keep this work queued', createdAt: '' },
]

it.each(cases)(
  'matches the Lean startup model for $input.name',
  ({ input, recovered, automatic }) => {
    const db = openDatabase(':memory:')
    try {
      const starting = new WorkspaceStore(db)
      const task: Task = {
        id: taskId(0),
        title: input.name,
        agentId: '',
        repositoryId: '',
        status: 'running',
        activeRunId: input.activeAttempt === null ? undefined : attemptId(input.activeAttempt),
        runPhase: input.preparingQueuedWork ? 'preparing' : 'provider',
        queue,
        queuePaused: input.paused,
        messages: [],
        draft: '',
        files: [],
        createdAt: '',
        example: false,
      }
      starting.update((workspace) => ({ ...workspace, tasks: [task] }))
      for (const action of input.actions.map(journalAction)) starting.providerActions.record(action)

      const restarted = new WorkspaceStore(db)
      expect(restarted.task(task.id)).toMatchObject({
        status: 'failed',
        queue,
        queuePaused: true,
        restartRecovery: {
          kind: input.preparingQueuedWork ? 'queue' : 'turn',
          automatic,
        },
      })
      expect(restarted.task(task.id).activeRunId).toBeUndefined()
      const relatedThreads = new Set([
        task.id,
        ...input.actions.map((action) => taskId(action.task)),
      ])
      const journal = [...relatedThreads].flatMap((id) => restarted.providerActions.list(id))
      expect(journal).toHaveLength(recovered.length)
      expect(journal).toEqual(expect.arrayContaining(recovered.map(journalAction)))
    } finally {
      db.close()
    }
  },
)
