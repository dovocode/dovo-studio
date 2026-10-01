import { expect, it } from 'vite-plus/test'
import { decode } from '../shared/schema'
import { snapshotSchema } from '../runtime/connection/runtime'
import { createLauncherTask, launcherDefaultAgent } from './task-launcher-task'
import { defaultTaskHarness, resolveTaskAgent, type Repository } from '../workspace'
function fixture() {
  return decode(snapshotSchema, {
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
      repositories: [],
      tasks: [],
      automations: [],
    },
    defaults: {
      harness: {
        ...defaultTaskHarness('acp'),
        acpInstallationId: 'old',
        acpConfig: { mode: 'old-value' },
      },
      execution: 'main',
    },
  })
}
const repository: Repository = {
  id: 'repo',
  name: 'Project',
  path: '/repo',
  branch: 'main',
  taskDefaults: { execution: 'worktree', setupCommand: 'pnpm install' },
}
it('uses project checkout defaults and the chosen provider without inheriting another ACP installation config', () => {
  const task = createLauncherTask(
    fixture(),
    repository,
    {
      key: 'acp:new:model',
      name: 'Agent',
      provider: 'acp',
      model: 'model',
      acpInstallationId: 'new',
    },
    'Fix login\nMore context',
    'task',
  )
  expect(task).toMatchObject({
    id: 'task',
    title: 'Fix login',
    repositoryId: 'repo',
    execution: 'worktree',
    setupCommand: 'pnpm install',
    harness: { provider: 'acp', model: 'model', acpInstallationId: 'new' },
  })
  expect(task.harness?.acpConfig).not.toEqual({ mode: 'old-value' })
})
it('selects a favorite configuration by ID rather than overriding its launch settings', () => {
  const task = createLauncherTask(
    fixture(),
    repository,
    { key: 'agent:favorite', name: 'Favorite', provider: 'claude', agentId: 'favorite' },
    'Fix login',
    'task',
  )
  expect(task.agentId).toBe('favorite')
  expect(task.harness).toBeUndefined()
})

it('keeps the selected provider configuration and per-task tuning when dispatching', () => {
  const harness = {
    ...defaultTaskHarness('codex'),
    model: 'chosen-model',
    reasoning: 'high',
    permission: 'workspace-write' as const,
    serviceTier: 'priority',
    executablePath: '/custom/codex',
    configDirectory: '/profiles/work',
    args: ['--test'],
    env: { TEST: 'value' },
  }
  const task = createLauncherTask(
    fixture(),
    repository,
    { key: 'harness:codex', name: 'Codex', provider: 'codex', harness },
    'Run checks',
    'task',
  )
  expect(task.harness).toEqual(harness)
})

it('applies model and reasoning changes to a saved agent without replacing its configuration', () => {
  const snapshot = fixture()
  const saved = {
    ...defaultTaskHarness('claude'),
    id: 'configured',
    name: 'Work Claude',
    model: 'original',
    instructions: 'Use project conventions',
    executablePath: '/custom/claude',
    env: { TEST: 'saved' },
  }
  snapshot.workspace.agents.push(saved)
  const task = createLauncherTask(
    snapshot,
    repository,
    {
      key: 'agent:configured',
      name: saved.name,
      provider: 'claude',
      agentId: saved.id,
      harness: { ...saved, model: 'chosen', reasoning: 'high', permission: 'ask' },
    },
    'Run checks',
    'task',
  )
  expect(task.agentId).toBe(saved.id)
  expect(task.harness).toBeUndefined()
  expect(task.agentOverrides).toMatchObject({
    model: 'chosen',
    reasoning: 'high',
    permission: 'ask',
  })
  expect(resolveTaskAgent(task, snapshot.workspace.agents)).toMatchObject({
    model: 'chosen',
    reasoning: 'high',
    permission: 'ask',
    instructions: saved.instructions,
    executablePath: saved.executablePath,
    env: saved.env,
  })
  expect(snapshot.workspace.agents[0]).toEqual(saved)
})

it('starts from project defaults without requiring a favorite', () => {
  const project = {
    ...repository,
    taskDefaults: {
      ...repository.taskDefaults,
      harness: { ...defaultTaskHarness('claude'), model: 'project-model', reasoning: 'high' },
      permission: 'ask' as const,
    },
  }
  const selected = launcherDefaultAgent(fixture(), project)
  expect(selected).toMatchObject({
    provider: 'claude',
    model: 'project-model',
    harness: { reasoning: 'high', permission: 'ask' },
  })
})
