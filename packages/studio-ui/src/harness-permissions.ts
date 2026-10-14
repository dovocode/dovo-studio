import { changeAgentProvider, defaultTaskHarness, type TaskHarness } from '@dovo/protocol'

/** Built-in choices reset profile settings while carrying conservative task permissions. */
export function changeHarnessProvider(value: TaskHarness, provider: TaskHarness['provider']) {
  const next = changeAgentProvider({ ...value, id: 'task', name: 'Task' }, provider)
  return {
    ...defaultTaskHarness(provider),
    permission: next.permission,
    ...(next.approvalPolicy ? { approvalPolicy: next.approvalPolicy } : {}),
    ...(next.sandboxMode ? { sandboxMode: next.sandboxMode } : {}),
  }
}
