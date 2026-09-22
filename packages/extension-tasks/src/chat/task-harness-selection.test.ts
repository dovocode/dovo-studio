import { expect, it } from 'vite-plus/test'
import {
  createTask,
  defaultTaskHarness,
  resolveTaskAgent,
  taskHarnessSchema,
  taskSchema,
  type Agent,
} from '@dovo/studio-core'
import { changeTaskHarness, chooseTaskAgent } from './task-harness-selection'

const custom: Agent = {
  ...defaultTaskHarness('codex'),
  id: 'reviewer',
  name: 'Reviewer',
  icon: 'shield',
  instructions: 'Review changes against our project standards.',
  model: 'custom-model',
  reasoning: 'high',
  serviceTier: 'priority',
  cyberAccessProgram: 'daybreakBlue',
  permission: 'read-only',
  endpoint: 'custom-codex',
  args: ['--profile', 'review'],
  resources: {
    mcpServers: [],
    skills: [
      { name: 'review', description: 'Review', content: 'Custom review skill', enabled: true },
    ],
  },
}
const claude: Agent = {
  ...defaultTaskHarness('claude'),
  id: 'builder',
  name: 'Builder',
  instructions: 'Implement the requested change.',
}
const agents = [custom, claude]
const draft = createTask({
  title: 'New task',
  repositoryId: 'repo',
  agentId: '',
  objective: '',
  harness: defaultTaskHarness('codex'),
})

it('switches freely between built-in providers and custom agents before sending input', () => {
  const selected = chooseTaskAgent(draft, agents, claude.id)
  expect(selected.agentId).toBe(claude.id)
  expect(selected.harness).toBeNull()
  expect(resolveTaskAgent(selected, agents)).toEqual(claude)
  const builtin = changeTaskHarness(selected, agents, defaultTaskHarness('opencode'), true)
  expect(builtin.agentId).toBe('')
  expect(builtin.agentOverrides).toBeUndefined()
  expect(resolveTaskAgent(builtin, agents)).toMatchObject({
    provider: 'opencode',
    instructions: '',
    endpoint: '',
  })
  expect(chooseTaskAgent(builtin, agents, custom.id).agentId).toBe(custom.id)
})

it('keeps the saved custom agent identity and configuration when changing model settings', () => {
  const template = structuredClone(custom)
  const selected = chooseTaskAgent(draft, agents, custom.id)
  const changed = changeTaskHarness(selected, agents, {
    ...taskHarnessSchema.parse(custom),
    model: 'another-model',
    reasoning: 'low',
    permission: 'workspace-write',
    serviceTier: 'default',
    cyberAccessProgram: 'standard',
    instructions: 'Must not replace the custom instructions',
    endpoint: 'must-not-replace',
    args: [],
    resources: { skills: [], mcpServers: [] },
  })
  expect(changed.agentId).toBe(custom.id)
  expect(changed.harness).toBeNull()
  expect(resolveTaskAgent(changed, agents)).toEqual({
    ...custom,
    model: 'another-model',
    reasoning: 'low',
    permission: 'workspace-write',
    serviceTier: 'default',
    cyberAccessProgram: 'standard',
  })
  expect(custom).toEqual(template)
})

it('clears custom modes explicitly so JSON persistence does not restore inherited defaults', () => {
  const selected = chooseTaskAgent(draft, agents, custom.id)
  const changed = changeTaskHarness(selected, agents, {
    ...taskHarnessSchema.parse(custom),
    reasoning: undefined,
    serviceTier: undefined,
    cyberAccessProgram: undefined,
  })
  const restored = taskSchema.parse(JSON.parse(JSON.stringify(changed)))
  expect(restored.agentOverrides).toMatchObject({
    reasoning: '',
    serviceTier: null,
    cyberAccessProgram: null,
  })
  expect(resolveTaskAgent(restored, agents)).toMatchObject({
    reasoning: '',
    serviceTier: undefined,
    cyberAccessProgram: undefined,
  })
})

it('drops custom template configuration when explicitly choosing the built-in provider', () => {
  const selected = chooseTaskAgent(draft, agents, custom.id)
  const changed = changeTaskHarness(selected, agents, defaultTaskHarness('codex'), true)
  expect(changed.agentId).toBe('')
  expect(changed.agentOverrides).toBeUndefined()
  expect(resolveTaskAgent(changed, agents)).toEqual({
    ...defaultTaskHarness('codex'),
    id: `task:${draft.id}`,
    name: 'codex',
    serviceTier: undefined,
    cyberAccessProgram: undefined,
  })
})

it('discards old model overrides when another saved custom agent is selected', () => {
  const selected = {
    ...chooseTaskAgent(draft, agents, custom.id),
    agentOverrides: { model: 'old-model', permission: 'full-access' as const },
  }
  const changed = chooseTaskAgent(selected, agents, claude.id)
  expect(changed.agentOverrides).toBeUndefined()
  expect(resolveTaskAgent(changed, agents)).toEqual(claude)
})

it('preserves per-task settings when reselecting the current custom agent', () => {
  const selected = {
    ...chooseTaskAgent(draft, agents, custom.id),
    agentOverrides: { model: 'selected-model', reasoning: 'low' },
  }
  expect(chooseTaskAgent(selected, agents, custom.id)).toBe(selected)
})

it('allows custom agents and model settings within the provider after the first input', () => {
  const submitted = {
    ...draft,
    messages: [{ id: 'first', role: 'user' as const, text: 'Start' }],
  }
  const selected = chooseTaskAgent(submitted, agents, custom.id)
  expect(selected.agentId).toBe(custom.id)
  const changed = changeTaskHarness(selected, agents, {
    ...taskHarnessSchema.parse(custom),
    model: 'another-model',
  })
  expect(resolveTaskAgent(changed, agents)?.model).toBe('another-model')
  expect(() => chooseTaskAgent(submitted, agents, claude.id)).toThrow('another provider')
  expect(() => changeTaskHarness(submitted, agents, defaultTaskHarness('claude'), true)).toThrow(
    'another provider',
  )
})

it.each([
  { ...draft, status: 'running' as const },
  { ...draft, archived: true },
])('rejects both selection paths while the task cannot be configured', (task) => {
  const message = task.status === 'running' ? 'Stop the current turn' : 'Reopen this task'
  expect(() => chooseTaskAgent(task, agents, custom.id)).toThrow(message)
  expect(() => changeTaskHarness(task, agents, defaultTaskHarness('codex'))).toThrow(message)
})

it('rejects a custom agent removed since the picker opened', () => {
  expect(() => chooseTaskAgent(draft, agents, 'removed')).toThrow('no longer available')
})
