import { decode } from '@dovo/protocol'
import { describe, expect, it } from 'vite-plus/test'
import {
  runtimeProfile,
  snapshotSchema,
  type JobRun,
  type RuntimeOverview,
} from '@dovo/studio-core'
import { createWorkspace } from '../../studio-core/src/workspace/seed'
import { aggregateAutomations } from './fleet'
const workspace = createWorkspace()
const flow = workspace.automations[0]
const run: JobRun = {
  id: 'shared-run',
  automationId: flow.id,
  status: 'running',
  createdAt: '2026-09-19T10:00:00Z',
  taskIds: ['same-task'],
  completedNodes: [],
  steps: [
    {
      nodeId: 'task',
      label: 'Implement',
      kind: 'task',
      status: 'running',
      taskId: 'same-task',
      attempt: 1,
    },
  ],
}
function runtime(host: string, overrides: Partial<RuntimeOverview> = {}): RuntimeOverview {
  return {
    profile: runtimeProfile({
      address: `http://${host}:51464`,
      token: 'test-credential-1234567890',
    }),
    snapshot: decode(snapshotSchema, {
      runtimeHost: host,
      revision: 1,
      owner: true,
      workspace: {
        ...workspace,
        automations: [flow],
      },
      approvals: [],
      questions: [],
      runs: [run],
      terminals: [],
      devices: [],
      pendingDevices: [],
    }),
    connected: true,
    lastSeen: null,
    error: null,
    pulls: null,
    pullError: null,
    ...overrides,
  }
}
describe('unified automation collection', () => {
  it('keeps matching automation, run, task and project IDs isolated by computer', () => {
    const first = runtime('first')
    const second = runtime('second', {
      connected: false,
    })
    second.snapshot = decode(snapshotSchema, {
      ...second.snapshot,
      approvals: [
        {
          id: 'approval',
          taskId: 'same-task',
          title: 'Approve edit',
          detail: '',
          createdAt: '2026-09-19T10:00:00Z',
        },
      ],
      workspace: {
        ...workspace,
        automations: [flow],
        repositories: workspace.repositories.map((repo) => ({
          ...repo,
          name: 'Other project',
        })),
      },
    })
    const rows = aggregateAutomations([first, second])
    expect(rows).toHaveLength(2)
    expect(new Set(rows.map((row) => row.key)).size).toBe(2)
    expect(rows[0]).toMatchObject({
      runtimeName: 'second',
      needsInput: true,
      status: 'Needs input',
      projects: ['Other project'],
    })
    expect(rows[0].runtime.connected).toBe(false)
    expect(rows[1]).toMatchObject({
      runtimeName: 'first',
      needsInput: false,
      status: 'Working',
    })
    expect(rows[0].runs).toEqual([run])
  })
  it('retains active runs before newer completed history and puts review before failures', () => {
    const working = runtime('working')
    working.snapshot = decode(snapshotSchema, {
      ...working.snapshot,
      runs: [
        run,
        {
          ...run,
          id: 'completed',
          status: 'completed',
          createdAt: '2026-09-20T10:00:00Z',
        },
      ],
    })
    const review = runtime('review')
    review.snapshot = decode(snapshotSchema, {
      ...review.snapshot,
      runs: [
        {
          ...run,
          status: 'waiting',
        },
      ],
    })
    const failed = runtime('failed')
    failed.snapshot = decode(snapshotSchema, {
      ...failed.snapshot,
      runs: [
        {
          ...run,
          status: 'failed',
        },
      ],
    })
    const rows = aggregateAutomations([working, failed, review])
    expect(rows.map((row) => row.runtimeName)).toEqual(['review', 'failed', 'working'])
    expect(rows[2].latest?.id).toBe(run.id)
    expect(rows[2].runs.map((item) => item.id)).toEqual(['completed', run.id])
  })
  it('retains saved offline automations and ignores hosts without snapshots', () => {
    const saved = runtime('saved', {
      connected: false,
      error: 'Offline',
    })
    const rows = aggregateAutomations([
      saved,
      runtime('missing', {
        snapshot: null,
      }),
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].flow).toEqual(flow)
    expect(rows[0].latest).toEqual(run)
    expect(saved.snapshot?.runs).toEqual([run])
  })
})
