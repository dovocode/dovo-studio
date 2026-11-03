import { Schema } from 'effect'
import { decodeResult } from '@dovo/protocol'

const tabSchema = Schema.Struct({
  kind: Schema.Literals(['thread', 'browser', 'terminal']),
  runtimeId: Schema.String,
  id: Schema.String,
})
const stateSchema = Schema.Struct({ tabs: Schema.Array(Schema.Unknown), active: Schema.String })
export type WorkspaceTab = Schema.Schema.Type<typeof tabSchema>
export type WorkspaceTabs = { tabs: WorkspaceTab[]; active: string }
export const workspaceTabKey = (tab: WorkspaceTab) =>
  JSON.stringify([tab.kind, tab.runtimeId, tab.id])
function validWorkspaceTab(tab: WorkspaceTab) {
  return tab.kind === 'browser'
    ? tab.runtimeId === '' && !!tab.id
    : !!tab.runtimeId && (tab.kind === 'thread' || !!tab.id)
}
/** Home is a selection, not a request to discard mounted tabs. */
export function showWorkspaceOverview(state: WorkspaceTabs): WorkspaceTabs {
  return state.active === '' ? state : { ...state, active: '' }
}
export function openWorkspaceTab(state: WorkspaceTabs, tab: WorkspaceTab): WorkspaceTabs {
  if (!validWorkspaceTab(tab)) return state
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
  if (index === -1) return state
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
/** missing requires positive ineligibility or an explicit close event, never snapshot absence. */
export type WorkspaceTabAvailability = 'present' | 'missing' | 'unknown'
/** Retain unknown refs for recovery; callers must not infer missing from snapshot/list absence. */
export function reconcileWorkspaceTabs(
  state: WorkspaceTabs,
  availability: (tab: WorkspaceTab) => WorkspaceTabAvailability,
): WorkspaceTabs {
  const seen = new Set<string>()
  const tabs = state.tabs.filter((tab) => {
    const key = workspaceTabKey(tab)
    if (!validWorkspaceTab(tab) || seen.has(key) || availability(tab) === 'missing') return false
    seen.add(key)
    return true
  })
  let active = state.active
  if (active && !tabs.some((tab) => workspaceTabKey(tab) === active)) {
    // Use the same left-neighbor rule as explicit close, even when several tabs disappear.
    const index = state.tabs.findIndex((tab) => workspaceTabKey(tab) === active)
    const neighbor =
      index < 0
        ? undefined
        : ([...state.tabs.slice(0, index)].reverse().find((tab) => tabs.includes(tab)) ?? tabs[0])
    active = neighbor ? workspaceTabKey(neighbor) : ''
  }
  return tabs.length === state.tabs.length && active === state.active ? state : { tabs, active }
}
const storageKey = 'dovo.unified-workspace.v1'
export function readWorkspaceTabs(): { state: WorkspaceTabs; error?: string } {
  const empty: WorkspaceTabs = { tabs: [], active: '' }
  try {
    const raw = sessionStorage.getItem(storageKey)
    if (!raw) return { state: empty }
    const result = decodeResult(stateSchema, JSON.parse(raw))
    if (!result.success) throw new Error('Invalid saved workspace tabs')
    const restored = result.data.tabs.flatMap((value) => {
      const tab = decodeResult(tabSchema, value)
      return tab.success && validWorkspaceTab(tab.data) ? [tab.data] : []
    })
    const tabs = [...new Map(restored.map((tab) => [workspaceTabKey(tab), tab])).values()]
    return {
      ...(restored.length < result.data.tabs.length
        ? { error: 'Some saved workspace tabs were invalid and could not be restored.' }
        : {}),
      state: {
        tabs,
        active:
          result.data.active === '' ||
          tabs.some((tab) => workspaceTabKey(tab) === result.data.active)
            ? result.data.active
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
  // The browser owns creation; a reload must not restore an unfinished navigation request.
  const tabs = state.tabs.filter((tab) => tab.kind !== 'browser' || tab.id !== 'new')
  const active = tabs.some((tab) => workspaceTabKey(tab) === state.active) ? state.active : ''
  sessionStorage.setItem(storageKey, JSON.stringify({ tabs, active }))
}
