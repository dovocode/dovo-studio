import { expect, it } from 'vite-plus/test'
import {
  closeWorkspaceTab,
  openWorkspaceTab,
  workspaceTabKey,
  type WorkspaceTabs,
} from './workspace-tabs'

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
