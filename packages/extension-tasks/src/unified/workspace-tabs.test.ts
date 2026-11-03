import { afterEach, expect, it, vi } from 'vite-plus/test'
import {
  closeWorkspaceTab,
  openWorkspaceTab,
  workspaceTabKey,
  showWorkspaceOverview,
  readWorkspaceTabs,
  saveWorkspaceTabs,
  reconcileWorkspaceTabs,
  type WorkspaceTabs,
} from './workspace-tabs'
afterEach(() => vi.unstubAllGlobals())

it('keeps different kinds and computers separate even when resource IDs collide', () => {
  let state: WorkspaceTabs = { tabs: [], active: '' }
  for (const tab of [
    { kind: 'thread', runtimeId: 'local', id: 'one' },
    { kind: 'terminal', runtimeId: 'local', id: 'one' },
    { kind: 'thread', runtimeId: 'remote', id: 'one' },
    { kind: 'browser', runtimeId: '', id: 'one' },
  ] as const)
    state = openWorkspaceTab(state, tab)
  expect(state.tabs).toHaveLength(4)
  state = openWorkspaceTab(state, state.tabs[0])
  expect(state.tabs).toHaveLength(4)
  expect(state.active).toBe(workspaceTabKey(state.tabs[0]))
})
it('selects the neighboring tab when closing the active tab and preserves other selections', () => {
  let state: WorkspaceTabs = { tabs: [], active: '' }
  for (const id of ['one', 'two', 'three'])
    state = openWorkspaceTab(state, { kind: 'terminal', runtimeId: 'remote', id })
  const active = state.active
  state = closeWorkspaceTab(state, workspaceTabKey(state.tabs[0]))
  expect(state.active).toBe(active)
  state = closeWorkspaceTab(state, active)
  expect(state.tabs.map((tab) => tab.id)).toEqual(['two'])
  expect(state.active).toBe(workspaceTabKey(state.tabs[0]))
  expect(closeWorkspaceTab(state, state.active)).toEqual({ tabs: [], active: '' })
})

const mixed = () => {
  let state: WorkspaceTabs = { tabs: [], active: '' }
  for (const tab of [
    { kind: 'terminal', runtimeId: 'mac', id: 'shell' },
    { kind: 'browser', runtimeId: '', id: 'page' },
    { kind: 'thread', runtimeId: 'linux', id: 'thread' },
  ] as const)
    state = openWorkspaceTab(state, tab)
  return state
}
function storage() {
  const values = new Map<string, string>()
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  })
  return values
}
it('retains mixed mounted tabs on Home and restores deliberate overview selection on reload', () => {
  storage()
  const state = mixed()
  const overview = showWorkspaceOverview(state)
  expect(overview.tabs).toBe(state.tabs)
  expect(overview.active).toBe('')
  expect(showWorkspaceOverview(overview)).toBe(overview)
  saveWorkspaceTabs(overview)
  expect(readWorkspaceTabs()).toEqual({ state: overview })
  expect(closeWorkspaceTab(overview, workspaceTabKey(state.tabs[1]))).toEqual({
    tabs: [state.tabs[0], state.tabs[2]],
    active: '',
  })
})
it('restores valid tabs individually without selecting a different item for a corrupt active key', () => {
  const values = storage()
  const state = mixed()
  values.set(
    'dovo.unified-workspace.v1',
    JSON.stringify({
      tabs: [
        ...state.tabs,
        state.tabs[0],
        { kind: 'unknown', id: 'bad', runtimeId: '' },
        { kind: 'terminal', id: '', runtimeId: 'mac' },
        { kind: 'thread', id: 'orphan', runtimeId: '' },
        { kind: 'browser', id: 'bad-owner', runtimeId: 'mac' },
      ],
      active: 'obsolete-key',
    }),
  )
  const restored = readWorkspaceTabs()
  expect(restored.state).toEqual({ tabs: state.tabs, active: '' })
  expect(restored.error).toContain('Some saved workspace tabs')
})
it('reports unusable saved data without throwing', () => {
  const values = storage()
  values.set('dovo.unified-workspace.v1', '{broken')
  expect(readWorkspaceTabs()).toMatchObject({
    state: { tabs: [], active: '' },
    error: expect.any(String),
  })
})
it('keeps pending/offline tabs and removes confirmed missing tabs without grouping by type', () => {
  const state = mixed()
  expect(reconcileWorkspaceTabs(state, () => 'unknown')).toBe(state)
  const next = reconcileWorkspaceTabs(state, (tab) =>
    tab.kind === 'thread' ? 'missing' : 'present',
  )
  expect(next.tabs).toEqual(state.tabs.slice(0, 2))
  expect(next.active).toBe(workspaceTabKey(state.tabs[1]))
  expect(
    reconcileWorkspaceTabs(showWorkspaceOverview(state), (tab) =>
      tab.kind === 'terminal' ? 'missing' : 'unknown',
    ),
  ).toEqual({ tabs: state.tabs.slice(1), active: '' })
  expect(reconcileWorkspaceTabs(state, () => 'missing')).toEqual({ tabs: [], active: '' })
})
it('selects the surviving neighbor when several resources disappear together', () => {
  const state = mixed()
  expect(
    reconcileWorkspaceTabs(state, (tab) => (tab.kind === 'terminal' ? 'present' : 'missing')),
  ).toEqual({ tabs: [state.tabs[0]], active: workspaceTabKey(state.tabs[0]) })
  const firstActive = { ...state, active: workspaceTabKey(state.tabs[0]) }
  expect(closeWorkspaceTab(firstActive, firstActive.active).active).toBe(
    workspaceTabKey(state.tabs[1]),
  )
  expect(closeWorkspaceTab(state, 'unknown-key')).toBe(state)
})
it('supports new thread placeholders but refuses ownerless shell and thread tabs', () => {
  const state = mixed()
  expect(openWorkspaceTab(state, { kind: 'thread', runtimeId: 'mac', id: '' }).tabs).toHaveLength(4)
  expect(openWorkspaceTab(state, { kind: 'terminal', runtimeId: 'mac', id: '' })).toBe(state)
  expect(openWorkspaceTab(state, { kind: 'thread', runtimeId: '', id: 'thread' })).toBe(state)
})

it('does not restore an unfinished browser creation request after a reload', () => {
  storage()
  const state = openWorkspaceTab(mixed(), { kind: 'browser', runtimeId: '', id: 'new' })
  saveWorkspaceTabs(state)
  expect(readWorkspaceTabs().state).toEqual({ tabs: mixed().tabs, active: '' })
  expect(state.tabs.at(-1)?.id).toBe('new')
})
