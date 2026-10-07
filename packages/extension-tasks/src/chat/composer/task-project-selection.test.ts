import { expect, it } from 'vite-plus/test'
import {
  decode,
  defaultTaskHarness,
  resolveTaskDefaults,
  runtimeDefaultsSchema,
  taskSchema,
  type Repository,
  type Task,
} from '@dovo/protocol'
import { changeTaskHarness, chooseTaskAgent } from './task-harness-selection'
import { changeTaskProject } from './task-project-selection'

const harness = { ...defaultTaskHarness('claude'), model: 'default' }
const runtime = decode(runtimeDefaultsSchema, { harness })
const source: Repository = {
  id: 'scratch',
  kind: 'scratch',
  name: 'No project',
  path: '/scratch',
  branch: '',
}
const target: Repository = {
  id: 'project',
  name: 'Project',
  path: '/project',
  branch: 'main',
  taskDefaults: {
    harness: { ...harness, model: 'sonnet' },
    setupCommand: 'pnpm install',
    execution: 'worktree',
  },
}
const draft: Task = decode(taskSchema, {
  id: 'draft',
  title: 'New task',
  agentId: '',
  repositoryId: source.id,
  ...resolveTaskDefaults(runtime, source),
  status: 'draft',
  createdAt: '2026-10-07T00:00:00Z',
  messages: [],
  files: [],
  draft: 'Use Opus',
  example: false,
})

it('preserves explicit Opus settings while applying the target checkout defaults', () => {
  const selected = changeTaskHarness(draft, [], { ...harness, model: 'opus', reasoning: 'low' })
  const next = changeTaskProject(selected, source, target, runtime)
  expect(next).toMatchObject({
    repositoryId: target.id,
    harness: { provider: 'claude', model: 'opus', reasoning: 'low' },
    harnessCustomized: true,
    execution: 'worktree',
    setupCommand: 'pnpm install',
    draft: 'Use Opus',
  })
})

it('keeps a choice equal to the defaults across repeated projects and JSON persistence', () => {
  const selected = changeTaskHarness(draft, [], harness)
  const restored = decode(taskSchema, JSON.parse(JSON.stringify(selected)))
  const matching = { ...target, taskDefaults: { ...target.taskDefaults, harness } }
  const next = changeTaskProject(restored, source, matching, runtime)
  expect(changeTaskProject(next, matching, target, runtime).harness?.model).toBe('default')
})

it('applies project model defaults to an untouched draft and keeps older manual choices', () => {
  expect(changeTaskProject(draft, source, target, runtime)).toMatchObject({
    harness: { model: 'sonnet' },
    harnessCustomized: undefined,
  })
  const legacy = { ...draft, harness: { ...harness, model: 'opus' } }
  expect(changeTaskProject(legacy, source, target, runtime)).toMatchObject({
    harness: { model: 'opus' },
    harnessCustomized: true,
  })
})

it('keeps a saved agent and its model override instead of replacing it with project defaults', () => {
  const agent = {
    ...harness,
    id: 'custom',
    name: 'Custom Claude',
    instructions: 'Review carefully',
  }
  const selected = changeTaskHarness(chooseTaskAgent(draft, [agent], agent.id), [agent], {
    ...agent,
    model: 'opus',
  })
  const next = changeTaskProject(selected, source, target, runtime)
  expect(next.agentId).toBe(agent.id)
  expect(next.harness).toEqual(selected.harness)
  expect(next.agentOverrides).toEqual(selected.agentOverrides)
})

it('keeps a saved configuration without a stored harness while that configuration exists', () => {
  const agent = { ...harness, id: 'custom', name: 'Custom Claude' }
  const selected = changeTaskHarness({ ...draft, harness: undefined, agentId: agent.id }, [agent], {
    ...agent,
    model: 'opus',
  })
  expect(selected.harness).toBeNull()
  const next = changeTaskProject(selected, source, target, runtime, [agent])
  expect(next).toMatchObject({
    agentId: agent.id,
    harness: null,
    harnessCustomized: true,
    agentOverrides: selected.agentOverrides,
    execution: 'worktree',
  })
  expect(changeTaskProject(selected, source, target, runtime).agentId).toBe('')
})

it('clears a dangling agent reference without a stored harness when applying project defaults', () => {
  const next = changeTaskProject(
    { ...draft, harness: undefined, agentId: 'missing', harnessCustomized: true },
    source,
    target,
    runtime,
  )
  expect(next).toMatchObject({
    agentId: '',
    harness: { provider: 'claude', model: 'sonnet' },
    harnessCustomized: undefined,
    agentOverrides: undefined,
  })
})

it('refuses to change the project after input was submitted', () => {
  expect(() =>
    changeTaskProject(
      { ...draft, messages: [{ id: 'sent', role: 'user', text: 'Start' }] },
      source,
      target,
      runtime,
    ),
  ).toThrow('before sending input')
})
