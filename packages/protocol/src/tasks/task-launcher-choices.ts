import type { Task, TaskHarness } from '../workspace.js'
export type LauncherAgent = {
  modelSelectionDifficulty?: Task['modelSelectionDifficulty']
  modelSelection?: 'inherit' | 'auto' | 'smart'
  key: string
  name: string
  agentId?: string
  provider: TaskHarness['provider']
  model?: string
  acpInstallationId?: string
  harness?: TaskHarness
}
