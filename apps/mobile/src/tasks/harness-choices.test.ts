import { expect, it } from 'vite-plus/test'
import { defaultTaskHarness, resolveTaskAgent, taskSchema, type Agent } from '@dovo/protocol'
import {
  selectedTaskHarness,
  taskHarnessChanges,
  taskHarnessChoices,
  taskHarnessLabel,
  taskHarnessSelection,
} from './harness-choices'

const agents: Agent[] = [
  { ...defaultTaskHarness('codex'), id: 'builder', name: 'Builder' },
  { ...defaultTaskHarness('claude'), id: 'reviewer', name: 'Reviewer' },
]
const draft = taskSchema.parse({
  id: 'task',
  repositoryId: 'repo',
  agentId: '',
  title: 'Task',
  status: 'draft',
  createdAt: '2026-09-23T10:00:00Z',
  messages: [],
  files: [],
  draft: '',
  example: false,
  harness: defaultTaskHarness('codex'),
})
const sent = {
  ...draft,
  messages: [{ id: 'first', role: 'user' as const, text: 'Build a screen' }],
}

it('offers all providers and custom agents before the first input', () => {
  expect(taskHarnessChoices(draft, agents).map((choice) => choice.id)).toEqual([
    'harness:codex',
    'harness:claude',
    'harness:opencode',
    'harness:acp',
    'agent:builder',
    'agent:reviewer',
  ])
})
it('keeps same-provider custom agents available after the first message', () => {
  expect(taskHarnessChoices(sent, agents).map((choice) => choice.id)).toEqual([
    'harness:codex',
    'agent:builder',
  ])
})
it('uses the provider that ran the first turn for historical threads', () => {
  const task = {
    ...sent,
    turns: [
      {
        id: 'turn',
        assistantId: 'response',
        status: 'completed' as const,
        startedAt: draft.createdAt,
        provider: 'claude' as const,
        agentId: 'reviewer',
        model: 'model',
      },
    ],
  }
  expect(taskHarnessChoices(task, agents).map((choice) => choice.id)).toEqual([
    'harness:claude',
    'agent:reviewer',
  ])
})
it('locks a queued first input and preserves the lock after it is removed', () => {
  const queued = {
    ...draft,
    queue: [{ id: 'queue', role: 'user' as const, text: 'Build', createdAt: draft.createdAt }],
  }
  expect(taskHarnessChoices(queued, agents).every((choice) => choice.provider === 'codex')).toBe(
    true,
  )
  expect(
    taskHarnessChoices({ ...draft, providerLock: 'codex' }, agents).every(
      (choice) => choice.provider === 'codex',
    ),
  ).toBe(true)
})
it('removes a custom agent if its provider changes while a task editor is open', () => {
  const updated = agents.map((agent) =>
    agent.id === 'builder' ? { ...agent, provider: 'claude' as const } : agent,
  )
  expect(
    taskHarnessChoices({ ...sent, providerLock: 'codex' }, updated).map((choice) => choice.id),
  ).toEqual(['harness:codex'])
})
it('does not restrict same-provider model, speed, reasoning or access changes', () => {
  const configured = {
    ...sent,
    harness: {
      ...defaultTaskHarness('codex'),
      model: 'updated-model',
      reasoning: 'high',
      serviceTier: 'fast',
      permission: 'full-access' as const,
    },
  }
  expect(taskHarnessChoices(configured, agents)).toEqual(taskHarnessChoices(sent, agents))
})

it('shows the custom name alongside its provider and model', () => {
  expect(
    taskHarnessChoices(draft, agents).find((choice) => choice.id === 'agent:builder')?.name,
  ).toBe('Builder · Codex')
  const custom = { ...draft, harness: null, agentId: 'builder' }
  expect(taskHarnessLabel(custom, { ...agents[0], model: 'gpt-test' })).toBe('Builder · gpt-test')
  expect(taskHarnessLabel(draft, { ...agents[0], model: 'gpt-test' })).toBe('gpt-test')
  expect(taskHarnessLabel(draft, agents[0])).toBe('Codex')
})

it('re-selects the active custom agent without losing task model and access overrides', () => {
  const custom = taskSchema.parse({
    ...draft,
    harness: null,
    agentId: 'builder',
    agentOverrides: {
      model: 'task-model',
      permission: 'full-access',
      serviceTier: 'fast',
      cyberAccessProgram: null,
    },
  })
  expect(taskHarnessSelection(custom)).toBe('agent:builder')
  expect(selectedTaskHarness(custom, agents, 'agent:builder')).toMatchObject({
    id: 'builder',
    model: 'task-model',
    permission: 'full-access',
    serviceTier: 'fast',
  })
})

it('keeps custom instructions and resources when applying task-specific model settings', () => {
  const builder: Agent = {
    ...agents[0],
    instructions: 'Use the project conventions.',
    model: 'saved-model',
    permission: 'ask',
    resources: {
      mcpServers: [],
      skills: [
        { name: 'review', description: 'Review work', content: 'Review the diff.', enabled: true },
      ],
    },
  }
  const chosen = selectedTaskHarness(draft, [builder], 'agent:builder')!
  const changes = taskHarnessChanges(draft, 'agent:builder', {
    ...chosen,
    model: 'task-model',
    reasoning: 'high',
    permission: 'workspace-write',
  })
  const updated = taskSchema.parse({
    ...draft,
    agentId: changes.agentId.after,
    harness: changes.harness.after,
    agentOverrides: changes.agentOverrides.after,
  })
  expect(updated.harness).toBeNull()
  expect(updated.agentId).toBe(builder.id)
  expect(resolveTaskAgent(updated, [builder])).toMatchObject({
    model: 'task-model',
    reasoning: 'high',
    permission: 'workspace-write',
    instructions: builder.instructions,
    resources: builder.resources,
  })
  expect(builder.model).toBe('saved-model')
  expect(builder.permission).toBe('ask')
})

it('clears the custom binding and overrides when selecting a built-in agent', () => {
  const custom = taskSchema.parse({
    ...draft,
    harness: null,
    agentId: 'builder',
    agentOverrides: { model: 'task-model', serviceTier: null, cyberAccessProgram: null },
  })
  const claude = selectedTaskHarness(custom, agents, 'harness:claude')!
  const changes = taskHarnessChanges(custom, 'harness:claude', claude)
  expect(changes.agentId.after).toBe('')
  expect(changes.agentOverrides.after).toBeNull()
  expect(changes.harness.after).toEqual(defaultTaskHarness('claude'))
  expect(
    selectedTaskHarness({ ...custom, messages: sent.messages }, agents, 'harness:claude'),
  ).toBeUndefined()
})
