import { expect, it } from 'vite-plus/test'
import { taskWorkflows, workflowState } from './workflows'
import { decode } from '../../shared/schema'
import { workflowCommandSchema } from '../../tasks/workflow-tools'
import { defaultTaskHarness, type Task } from '../../workspace'

const task = (id: string): Task => ({
  id,
  title: id,
  repositoryId: '',
  agentId: '',
  status: 'draft',
  createdAt: '',
  messages: [],
  files: [],
  draft: '',
  example: false,
})

it('derives phase progress from mixed-agent children without copying their status into the plan', () => {
  const parent: Task = {
    ...task('parent'),
    workflows: [
      {
        id: 'build',
        name: 'Build',
        phases: [
          { id: 'inspect', title: 'Inspect' },
          { id: 'test', title: 'Test' },
        ],
        members: [
          { id: 'codex', taskId: 'codex', phaseId: 'inspect' },
          { id: 'claude', taskId: 'claude', phaseId: 'test' },
        ],
      },
    ],
  }
  const codex: Task = { ...task('codex'), harness: defaultTaskHarness('codex'), status: 'review' }
  const claude: Task = {
    ...task('claude'),
    harness: defaultTaskHarness('claude'),
    status: 'running',
  }
  const plan = JSON.stringify(parent.workflows)
  expect(taskWorkflows(parent, [parent, codex, claude])[0]).toMatchObject({
    state: 'working',
    phases: [
      { state: 'completed', members: [{ provider: 'codex' }] },
      { state: 'working', members: [{ provider: 'claude' }] },
    ],
  })
  expect(taskWorkflows(parent, [parent, codex, { ...claude, status: 'failed' }])[0]?.state).toBe(
    'failed',
  )
  expect(taskWorkflows(parent, [parent, codex, { ...claude, status: 'review' }])[0]?.state).toBe(
    'completed',
  )
  expect(taskWorkflows(parent, [parent, codex])[0]?.state).toBe('unknown')
  expect(JSON.stringify(parent.workflows)).toBe(plan)
})

it('shows offline remote members as unknown and keeps same IDs on other computers separate', () => {
  const parent: Task = {
    ...task('parent'),
    workflows: [
      {
        id: 'remote',
        name: 'Remote',
        phases: [{ id: 'review', title: 'Review' }],
        members: [{ id: 'remote-child', runtimeId: 'mac', taskId: 'child', phaseId: 'review' }],
      },
    ],
    threadWatches: [
      {
        runtimeId: 'mac',
        threadId: 'child',
        computerName: 'Mac',
        relation: 'spawned',
        status: 'completed',
        delegated: true,
        offline: false,
        snapshot: {
          title: 'Remote review',
          phase: 'completed',
          revision: '1',
          attention: [],
          watches: { pipelines: 0, pullRequests: 0, failures: 0 },
          result: 'Reviewed',
        },
      },
    ],
  }
  expect(taskWorkflows(parent, [parent, { ...task('child'), status: 'failed' }])[0]).toMatchObject({
    state: 'completed',
    phases: [{ members: [{ name: 'Remote review', result: 'Reviewed', runtimeId: 'mac' }] }],
  })
  if (parent.threadWatches?.[0]) parent.threadWatches[0].offline = true
  expect(taskWorkflows(parent, [parent])[0]?.state).toBe('unknown')
})

it('keeps queued and empty phases pending and rejects extra workflow command fields', () => {
  expect(workflowState([])).toBe('queued')
  expect(workflowState(['completed', 'queued'])).toBe('queued')
  expect(workflowState(['stopped', 'completed'])).toBe('stopped')
  expect(() =>
    decode(workflowCommandSchema, { action: 'create', id: 'flow', name: 'Flow', phases: [] }),
  ).toThrow(/phases/)
  expect(() =>
    decode(workflowCommandSchema, {
      action: 'attach',
      id: 'flow',
      phaseId: 'one',
      childId: 'child',
      permission: 'full-access',
    }),
  ).toThrow(/permission/)
})
