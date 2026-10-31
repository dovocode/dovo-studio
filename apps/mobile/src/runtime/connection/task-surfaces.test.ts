import { expect, it } from 'vite-plus/test'
import {
  decode,
  snapshotSchema,
  taskSchema,
  runtimeProfile,
  type Task,
  type RuntimeOverview,
} from '@dovo/protocol'
import { Effect } from 'effect'
import type { Runtime } from './context'
import { sameTaskSurfaces } from './task-surfaces'

const read: Runtime['readRuntimeEffect'] = () => Effect.die('Not used')
const task = decode(taskSchema, {
  id: 'thread',
  title: 'Build',
  repositoryId: '',
  agentId: '',
  status: 'running',
  createdAt: '2026-10-30T12:00:00Z',
  messages: [],
  files: [],
  draft: '',
  example: false,
  turns: [
    {
      id: 'turn',
      assistantId: 'answer',
      agentId: '',
      provider: 'codex',
      model: '',
      status: 'running',
      startedAt: '2026-10-30T12:00:00Z',
    },
  ],
})
const snapshot = decode(snapshotSchema, {
  revision: 1,
  owner: false,
  workspace: {
    version: 1,
    runtimeAddress: '',
    repositories: [],
    agents: [],
    tasks: [task],
    automations: [],
  },
  approvals: [],
  questions: [],
  terminals: [],
  runs: [],
  devices: [],
  pendingDevices: [],
})
const overview: RuntimeOverview = {
  profile: runtimeProfile({
    address: 'http://computer.local:51464',
    token: 'device-token-for-memory-test',
  }),
  snapshot,
  connected: true,
  lastSeen: null,
  error: null,
  pulls: null,
  pullError: null,
}
const surface = (task: Task) => ({
  ready: true,
  readRuntimeEffect: read,
  overviews: [
    { ...overview, snapshot: { ...snapshot, workspace: { ...snapshot.workspace, tasks: [task] } } },
  ],
})
it('ignores text, token usage and streaming timestamps, while publishing native surface changes', () => {
  const before = surface(task)
  const streamed = surface({
    ...task,
    draft: 'streamed',
    updatedAt: 'later',
    messages: [{ id: 'answer', role: 'assistant', text: 'New text' }],
    turns: task.turns?.map((turn) => ({ ...turn, tokens: 1000 })),
  })
  expect(sameTaskSurfaces(before, streamed)).toBe(true)
  for (const change of [
    { title: 'Renamed' },
    { status: 'review' as const },
    { activity: 'Reading a file' },
    { archived: true },
    { error: 'Failed' },
    { pinned: true },
    { repositoryId: 'different' },
    { turns: task.turns?.map((turn) => ({ ...turn, id: 'next-turn' })) },
  ])
    expect(sameTaskSurfaces(before, surface({ ...task, ...change }))).toBe(false)
  expect(
    sameTaskSurfaces(before, { ...before, overviews: [{ ...overview, connected: false }] }),
  ).toBe(false)
  expect(sameTaskSurfaces(before, { ...before, ready: false })).toBe(false)
})
