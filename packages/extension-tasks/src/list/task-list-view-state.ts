import type { StudioHostApi } from '@dovo/studio-core'

type TaskListViewState = {
  environment: string
  projectId: string
  query: string
  expanded: Record<string, boolean>
  scrollTop: number
}
// Keep presentation state across extension navigation without retaining a running
// thread's renderer or subscriptions. Each workbench owns its own state.
const views = new WeakMap<StudioHostApi, Partial<TaskListViewState>>()
export function readTaskListViewState(host: StudioHostApi) {
  return views.get(host) ?? {}
}
export function saveTaskListViewState(host: StudioHostApi, state: Partial<TaskListViewState>) {
  views.set(host, { ...views.get(host), ...state })
}
