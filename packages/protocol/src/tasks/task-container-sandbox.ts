import { canChangeTaskCheckout, type Repository, type Task } from '../workspace.js'
import type { RuntimeDefaults } from '../runtime/connection/runtime-setup.js'
import { resolveScopedSettings } from '../runtime/connection/scoped-settings.js'
import type { TaskSummary } from './task-summary.js'
import { effectiveContainerSandbox } from './container-sandbox.js'

/** The sandbox a client shows for a thread: its own choice, or the project default while the
 * thread can still change its checkout. The runtime records the default on the first run. */
export function taskContainerSandbox(
  task: Task | TaskSummary,
  defaults: RuntimeDefaults | undefined,
  repository: Repository | undefined,
) {
  return effectiveContainerSandbox(
    task.containerSandbox,
    resolveScopedSettings(defaults, repository).taskDefaults?.containerSandbox,
    !canChangeTaskCheckout(task),
  )
}
