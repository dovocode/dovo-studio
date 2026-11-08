import { expect, it, vi } from 'vite-plus/test'
import { decode } from '../shared/schema.js'
import { snapshotSchema } from '../runtime/connection/runtime.js'
import { runtimeDefaultsSchema } from '../runtime/connection/runtime-setup.js'
import type { Agent } from '../workspace.js'
import type { ModelCatalog } from './models.js'
import type { BrowserProfile } from '../runtime/previews/browser-profiles.js'
import { defaultTaskHarness } from '../workspace.js'
import {
  suggestWorkspace,
  workspaceBrowserInput,
  workspaceModelChoices,
  type WorkspaceModelChoice,
} from './workspace-suggestions.js'
import {
  workspaceRouteRequestSchema,
  type WorkspaceRouteRequest,
  type WorkspaceRouteSuggestion,
} from './title-generation.js'

type Models = (runtimeId: string, repositoryId: string) => Promise<WorkspaceModelChoice[]>
type Profiles = (runtimeId: string, explicitlySelected: boolean) => Promise<BrowserProfile[]>
type Route = (
  runtimeId: string,
  request: WorkspaceRouteRequest,
) => Promise<WorkspaceRouteSuggestion>
type Cached = (agent: Agent) => Promise<ModelCatalog | null>

function snapshot(supported = true) {
  return decode(snapshotSchema, {
    ...(supported ? { workspaceRoutingSelectionsSupported: true } : {}),
    revision: 0,
    owner: true,
    approvals: [],
    terminals: [],
    runs: [],
    devices: [],
    pendingDevices: [],
    workspace: {
      version: 1,
      runtimeAddress: '',
      agents: [],
      repositories: [{ id: 'repo', name: 'Remote App', path: '/repo', branch: 'main' }],
      tasks: [],
      automations: [],
    },
  })
}
it('resolves the owning computer and project before loading the available model choices', async () => {
  const calls: { id: string; input: WorkspaceRouteRequest }[] = []
  const models = vi.fn<Models>(async () => [
    {
      id: 'opus',
      name: 'Opus 5.5',
      harness: { ...defaultTaskHarness('claude'), model: 'claude-opus-5-5' },
    },
  ])
  const profiles = vi.fn<Profiles>(async () => [{ id: 'default', name: 'Default' }])
  const result = await suggestWorkspace({
    text: 'Use Opus on Mac Studio in Remote App to fix the build',
    runtimeId: 'local',
    repositoryId: 'old',
    computers: [
      { id: 'local', name: 'Local', snapshot: snapshot() },
      { id: 'remote', name: 'Mac Studio', snapshot: snapshot() },
    ],
    current: () => true,
    models,
    profiles,
    route: async (id, input) => {
      calls.push({ id, input })
      return {
        mode: 'thread',
        reason: 'GLiClass suggestion',
        selections: input.catalogs?.runtime
          ? { runtime: 'runtime:remote' }
          : input.catalogs?.project
            ? { project: 'project:repo' }
            : { model: 'opus' },
      }
    },
  })
  expect(calls.map((call) => call.id)).toEqual(['local', 'remote', 'remote'])
  expect(calls[1]?.input.mode).toBe('thread')
  expect(models).toHaveBeenCalledWith('remote', 'repo')
  expect(profiles).not.toHaveBeenCalled()
  expect(result).toMatchObject({
    mode: 'thread',
    runtimeId: 'remote',
    repositoryId: 'repo',
    model: { harness: { model: 'claude-opus-5-5' } },
  })
})
it('uses the selected browser computer catalog and keeps the default profile when unspecified', async () => {
  const profiles = vi.fn<Profiles>(async () => [
    { id: 'default', name: 'Default' },
    { id: 'work', name: 'Work' },
  ])
  const result = await suggestWorkspace({
    text: 'open dovocode.com',
    runtimeId: 'local',
    repositoryId: 'repo',
    computers: [{ id: 'local', name: 'Local', snapshot: snapshot() }],
    current: () => true,
    models: async () => [],
    profiles,
    route: async (_id, input) => ({
      mode: 'browser',
      reason: 'Suggestion',
      selections: input.catalogs?.runtime ? { runtime: 'keep' } : { profile: 'default' },
    }),
  })
  expect(result.profileId).toBe('default')
  expect(profiles).toHaveBeenCalledWith('local', false)
})
it('keeps legacy requests compatible and stops further catalog work for stale drafts or model failures', async () => {
  for (const kind of ['legacy', 'stale', 'failure'] as const) {
    const route = vi.fn<Route>(async () => ({
      mode: 'thread' as const,
      reason: 'Review',
      ...(kind === 'failure' ? {} : { selections: { runtime: 'keep' } }),
    }))
    const models = vi.fn<Models>(async () => [])
    await suggestWorkspace({
      text: 'fix the build',
      runtimeId: 'local',
      repositoryId: '',
      computers: [{ id: 'local', name: 'Local', snapshot: snapshot(kind !== 'legacy') }],
      current: () => kind !== 'stale',
      route,
      models,
      profiles: async () => [],
    })
    expect(route).toHaveBeenCalledTimes(1)
    expect(models).not.toHaveBeenCalled()
    const expectedKeys = kind === 'legacy' ? ['text'] : ['catalogs', 'text']
    expect(Object.keys(route.mock.calls[0]?.[1] ?? {}).sort()).toEqual(expectedKeys)
  }
})
it('uses cached named models without sending harness configuration as model labels', async () => {
  const state = snapshot()
  state.workspace.agents = [
    {
      ...defaultTaskHarness('claude'),
      id: 'claude',
      name: 'Claude',
      model: '',
      endpoint: 'http://lan:4000',
      env: { PRIVATE_VALUE: 'do-not-classify-this' },
    },
  ]
  const choices = await workspaceModelChoices(state, 'repo', async (agent) =>
    agent.provider === 'claude'
      ? { models: [{ id: 'claude-opus-5-5', name: 'Opus 5.5' }], reasoning: [] }
      : null,
  )
  expect(choices.length).toBeGreaterThan(0)
  expect(choices[0]?.name).toContain('Opus 5.5')
  expect(choices[0]?.harness.endpoint).toBe('http://lan:4000')
  expect(choices[0]?.harness.env).toEqual({ PRIVATE_VALUE: 'do-not-classify-this' })
  expect(
    JSON.stringify(choices.map((choice) => ({ id: choice.id, label: choice.name }))),
  ).not.toContain('do-not-classify-this')
})
it('rejects duplicate catalog IDs at the API boundary', () => {
  expect(() =>
    decode(workspaceRouteRequestSchema, {
      text: 'fix the build',
      catalogs: {
        project: [
          { id: 'same', label: 'One' },
          { id: 'same', label: 'Two' },
        ],
      },
    }),
  ).toThrow(/catalogs.project/)
})
it.each([
  ['open dovocode.com', 'dovocode.com'],
  ['open http://100.64.0.1:3000/?x=1 in Work', 'http://100.64.0.1:3000/?x=1'],
  ['dovocode.com/?lol=1', 'dovocode.com/?lol=1'],
  ['show "https://example.com/docs?q=one" in Work', 'https://example.com/docs?q=one'],
  ['open localhost:3000/docs', 'localhost:3000/docs'],
  ['compare one.example and two.example', 'compare one.example and two.example'],
  ['a web search without an address', 'a web search without an address'],
])('extracts accepted Browser input without changing its protocol: %s', (input, target) => {
  expect(workspaceBrowserInput(input)).toBe(target)
})
it('retains an explicitly selected thread context instead of proposing hidden new-thread pickers', async () => {
  const route = vi.fn<Route>(async () => ({
    mode: 'thread' as const,
    reason: 'Suggestion',
    selections: { runtime: 'keep' },
  }))
  const models = vi.fn<Models>(async () => [])
  const result = await suggestWorkspace({
    text: 'Continue the fix',
    runtimeId: 'local',
    repositoryId: 'repo',
    continueThread: true,
    computers: [{ id: 'local', name: 'Local', snapshot: snapshot() }],
    current: () => true,
    route,
    models,
    profiles: async () => [],
  })
  expect(route).toHaveBeenCalledTimes(1)
  expect(models).not.toHaveBeenCalled()
  expect(result.repositoryId).toBe('repo')
})
it('excludes unavailable harnesses and disabled model choices', async () => {
  const state = snapshot()
  const cached = vi.fn<Cached>(async () => ({
    models: [{ id: 'opus', name: 'Opus' }],
    reasoning: [],
  }))
  expect(await workspaceModelChoices(state, 'repo', cached, new Set())).toEqual([])
  expect(cached).not.toHaveBeenCalled()
  state.defaults = decode(runtimeDefaultsSchema, {
    harness: defaultTaskHarness('codex'),
    modelPreferences: { 'claude:opus': { favorite: false, disabled: true } },
  })
  expect(
    await workspaceModelChoices(state, 'repo', cached, new Set(['agent:dovo:claude'])),
  ).toEqual([])
})
it('preserves project access and instructions when inferring a model from a permissive preset', async () => {
  const state = snapshot()
  const project = state.workspace.repositories[0]
  if (!project) throw new Error('Missing fixture project')
  project.taskDefaults = {
    permission: 'ask',
    harness: { ...defaultTaskHarness('codex'), instructions: 'Project instructions' },
  }
  state.workspace.agents = [
    {
      ...defaultTaskHarness('claude'),
      id: 'permissive',
      name: 'Configured Claude',
      permission: 'full-access',
      instructions: 'Unrelated role',
      endpoint: 'http://model.lan',
    },
  ]
  const choices = await workspaceModelChoices(
    state,
    'repo',
    async () => ({ models: [{ id: 'opus', name: 'Opus' }], reasoning: [] }),
    new Set(['agent:permissive']),
  )
  expect(choices[0]?.harness).toMatchObject({
    permission: 'ask',
    instructions: 'Project instructions',
    endpoint: 'http://model.lan',
    provider: 'claude',
    model: 'opus',
  })
})
