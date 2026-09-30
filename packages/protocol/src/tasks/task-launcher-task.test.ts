import { expect, it } from 'vite-plus/test'
import { decode } from '../shared/schema'
import { snapshotSchema } from '../runtime/connection/runtime'
import { createLauncherTask } from './task-launcher-task'
import { defaultTaskHarness, type Repository } from '../workspace'
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
