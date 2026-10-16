import type { TaskHarness } from '../workspace.js'
export type LauncherAgent = {
  modelSelection?: 'inherit' | 'auto' | 'smart'
  key: string
  name: string
  agentId?: string
  provider: TaskHarness['provider']
  model?: string
  acpInstallationId?: string
  harness?: TaskHarness
}
