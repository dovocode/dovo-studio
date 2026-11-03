import { Schema } from 'effect'
import { decodeResult } from '@dovo/protocol'

const tabSchema = Schema.Struct({
  kind: Schema.Literals(['thread', 'browser', 'terminal']),
  runtimeId: Schema.String,
  id: Schema.String,
})
const stateSchema = Schema.Struct({ tabs: Schema.Array(tabSchema), active: Schema.String })
export type WorkspaceTab = Schema.Schema.Type<typeof tabSchema>
export type WorkspaceTabs = { tabs: WorkspaceTab[]; active: string }
export const workspaceTabKey = (tab: WorkspaceTab) =>
  JSON.stringify([tab.kind, tab.runtimeId, tab.id])
export function openWorkspaceTab(state: WorkspaceTabs, tab: WorkspaceTab): WorkspaceTabs {
  const active = workspaceTabKey(tab)
  if (state.active === active && state.tabs.some((item) => workspaceTabKey(item) === active))
    return state
  return {
    tabs: state.tabs.some((item) => workspaceTabKey(item) === active)
      ? state.tabs
      : [...state.tabs, tab],
    active,
  }
}
export function closeWorkspaceTab(state: WorkspaceTabs, key: string): WorkspaceTabs {
  const index = state.tabs.findIndex((tab) => workspaceTabKey(tab) === key)
  const tabs = state.tabs.filter((tab) => workspaceTabKey(tab) !== key)
  return {
    tabs,
    active:
      state.active === key
        ? tabs[Math.max(0, index - 1)]
          ? workspaceTabKey(tabs[Math.max(0, index - 1)])
          : ''
        : state.active,
  }
}
const storageKey = 'dovo.unified-workspace.v1'
export function readWorkspaceTabs(): { state: WorkspaceTabs; error?: string } {
  const empty: WorkspaceTabs = { tabs: [], active: '' }
  try {
    const raw = sessionStorage.getItem(storageKey)
    if (!raw) return { state: empty }
    const result = decodeResult(stateSchema, JSON.parse(raw))
    if (!result.success) throw new Error('Invalid saved workspace tabs')
    const tabs = [...new Map(result.data.tabs.map((tab) => [workspaceTabKey(tab), tab])).values()]
    return {
      state: {
        tabs,
        active: tabs.some((tab) => workspaceTabKey(tab) === result.data.active)
          ? result.data.active
          : tabs[0]
            ? workspaceTabKey(tabs[0])
            : '',
      },
    }
  } catch {
    return {
      state: empty,
      error: 'Saved workspace tabs could not be restored. Open items from the sidebar to continue.',
    }
  }
}
export function saveWorkspaceTabs(state: WorkspaceTabs) {
  sessionStorage.setItem(storageKey, JSON.stringify(state))
}
