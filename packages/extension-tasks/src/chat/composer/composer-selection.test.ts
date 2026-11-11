import { expect, it } from 'vite-plus/test'
import { decode, snapshotSchema } from '@dovo/protocol'
import { selectComposerWorkspace, sameComposerWorkspace } from './composer-selection'
import { Effect } from 'effect'

it('ignores streamed workspace content but observes defaults, questions and connection changes', () => {
  const snapshot = decode(snapshotSchema, {
    revision: 1,
    owner: false,
    workspace: {
      version: 1,
      runtimeAddress: '',
      agents: [],
      repositories: [],
      tasks: [],
      automations: [],
    },
    approvals: [],
    questions: [],
    terminals: [],
    runs: [],
    devices: [],
    pendingDevices: [],
  })
  const value: Parameters<typeof selectComposerWorkspace>[0] = {
    workspace: snapshot.workspace,
    snapshot,
    setWorkspace: () => {},
    request: async () => {
      throw new Error('Not called')
    },
    requestEffect: () => Effect.fail(new Error('Not called')),
    connected: true,
    connection: null,
    flush: async () => {},
    activeRuntimeId: null,
    runtimeRegistry: { version: 1, activeId: null, profiles: [] },
    refreshRuntime: async () => {},
  }
  const first = selectComposerWorkspace(value)
  expect(
    sameComposerWorkspace(
      first,
      selectComposerWorkspace({
        ...value,
        workspace: { ...value.workspace, tasks: [...value.workspace.tasks] },
        snapshot: { ...snapshot, revision: 2 },
      }),
    ),
  ).toBe(true)
  expect(
    sameComposerWorkspace(first, selectComposerWorkspace({ ...value, connected: false })),
  ).toBe(false)
  expect(
    sameComposerWorkspace(
      first,
      selectComposerWorkspace({
        ...value,
        snapshot: { ...snapshot, fullTurnSettingsSupported: true },
      }),
    ),
  ).toBe(false)
  expect(
    sameComposerWorkspace(
      first,
      selectComposerWorkspace({
        ...value,
        snapshot: { ...snapshot, questions: [...snapshot.questions] },
      }),
    ),
  ).toBe(false)
  expect(
    sameComposerWorkspace(
      first,
      selectComposerWorkspace({
        ...value,
        workspace: { ...value.workspace, agents: [...value.workspace.agents] },
      }),
    ),
  ).toBe(false)
})
