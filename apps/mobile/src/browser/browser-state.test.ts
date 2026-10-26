import { expect, it } from 'vite-plus/test'
import {
  initialBrowserState,
  parseBrowserState,
  browserAddress,
  addTab,
  adoptNativeTab,
  closeTab,
  recordPage,
  toggleBookmark,
  togglePinnedTab,
  persistableBrowserState,
  appendBrowserDraft,
  pageKey,
  recentTabs,
  visitTab,
  type BrowserTab,
} from './browser-state'
const remote: BrowserTab = {
  id: 'remote',
  kind: 'remote',
  runtimeId: 'mac',
  profileId: 'work',
  url: 'http://localhost:3000/',
  title: 'Dev',
  visitedAt: 20,
}
it('round trips owners and native or remote profiles', () => {
  const state = addTab(initialBrowserState('device'), remote)
  expect(parseBrowserState(JSON.stringify(state))).toEqual(state)
  expect(() =>
    parseBrowserState(
      JSON.stringify({ ...state, tabs: [{ ...state.tabs[0], profileId: '../unsafe' }, remote] }),
    ),
  ).toThrow(/.+/)
  expect(() =>
    parseBrowserState(JSON.stringify({ ...state, tabs: [{ ...remote, runtimeId: '' }] })),
  ).toThrow(/.+/)
  expect(pageKey(remote)).not.toBe(pageKey({ ...remote, runtimeId: 'other' }))
  expect(pageKey(remote)).not.toBe(pageKey({ ...remote, profileId: 'personal' }))
})

it('persists pinned local and remote tabs, keeps them first and protects them from close', () => {
  let state = addTab(initialBrowserState('device'), remote)
  state = togglePinnedTab(state, 'remote')
  state = recordPage(state, 'device', { url: 'https://recent.example/', title: 'Recent' })
  expect(recentTabs(state.tabs)[0]).toMatchObject({ ...remote, pinned: true })
  expect(parseBrowserState(JSON.stringify(state))).toEqual(state)
  expect(closeTab(state, 'remote', 'unused')).toBe(state)
  state = togglePinnedTab(state, 'remote')
  expect(closeTab(state, 'remote', 'unused').tabs.map((tab) => tab.id)).toEqual(['device'])
})
it('never persists private tabs or adds their pages to history, bookmarks or recently closed', () => {
  const privateTab = { ...remote, profileId: 'private-11111111-1111-4111-8111-111111111111' }
  let state = addTab(initialBrowserState('public'), privateTab)
  state = recordPage(state, 'remote', { url: 'https://private.example/secret', title: 'Private' })
  expect(state.history).toEqual([])
  expect(toggleBookmark(state, state.tabs[1]!)).toBe(state)
  const saved = persistableBrowserState(state, 'fallback')
  expect(JSON.stringify(saved)).not.toContain('private.example')
  expect(saved.active).toBe('public')
  expect(closeTab(state, 'remote', 'fallback').closed).toEqual([])
  const onlyPrivate = { ...state, tabs: [state.tabs[1]!], active: 'remote' }
  expect(
    parseBrowserState(JSON.stringify(persistableBrowserState(onlyPrivate, 'fallback'))).active,
  ).toBe('fallback')
})
it('rejects invalid saved state and bounded collections before restoring', () => {
  const state = initialBrowserState('one')
  for (const corrupt of [
    { ...state, active: 'absent' },
    { ...state, tabs: [] },
    { ...state, tabs: [...state.tabs, ...state.tabs] },
    { ...state, tabs: [{ ...state.tabs[0], url: 'javascript:alert(1)' }] },
    { ...state, bookmarks: Array(101).fill(remote) },
    { ...state, history: Array(201).fill(remote) },
    { ...state, closed: Array(21).fill(remote) },
    { ...state, tabs: [{ ...state.tabs[0], visitedAt: Infinity }] },
  ])
    expect(() => parseBrowserState(JSON.stringify(corrupt))).toThrow(/.+/)
})
it('preserves HTTP and selected-computer localhost meaning while resolving search', () => {
  expect(browserAddress('http://dev.netbird.local:3000/path')).toBe(
    'http://dev.netbird.local:3000/path',
  )
  expect(browserAddress('localhost:3000')).toBe('http://localhost:3000/')
  expect(browserAddress('192.168.1.2:8080')).toBe('http://192.168.1.2:8080/')
  expect(browserAddress('[::1]:3000')).toBe('http://[::1]:3000/')
  expect(browserAddress('example.com/docs')).toBe('https://example.com/docs')
  expect(browserAddress(' react hooks ')).toBe('https://www.google.com/search?q=react%20hooks')
  for (const address of [
    'javascript:alert(1)',
    'file:///private',
    'https://user:secret@example.com',
    'data:text/html,foo',
    'intent:foo',
    '',
    '字'.repeat(2000),
  ])
    expect(() => browserAddress(address)).toThrow(/.+/)
})
it('caps tabs and retains the exact source when a closed tab is reopened', () => {
  let state = addTab(initialBrowserState('device'), remote)
  state = closeTab(state, remote.id, 'fallback')
  expect(state.active).toBe('device')
  const reopened = { ...state.closed[0], id: 'reopened' }
  state = addTab(state, reopened)
  expect(state.tabs[1]).toMatchObject({ ...remote, id: 'reopened', visitedAt: expect.any(Number) })
  while (state.tabs.length < 100)
    state = addTab(state, { ...remote, id: String(state.tabs.length) })
  expect(() => addTab(state, { ...remote, id: 'over-cap' })).toThrow(/100/)
  expect(recentTabs([{ ...remote, id: 'older', visitedAt: 1 }, remote])[0].id).toBe('remote')
  const last = closeTab(initialBrowserState('only'), 'only', 'replacement')
  expect(last.active).toBe('replacement')
  expect(last.tabs).toHaveLength(1)
})
it('deduplicates bounded history by source and toggles exact bookmarks', () => {
  let state = addTab(initialBrowserState('device'), remote)
  for (let index = 0; index < 205; index++)
    state = recordPage(state, remote.id, { url: `http://localhost:3000/${index}`, title: 'Dev' })
  expect(state.history).toHaveLength(200)
  state = recordPage(state, remote.id, { url: 'http://localhost:3000/204', title: 'Updated' })
  expect(state.history).toHaveLength(200)
  expect(state.history[0].title).toBe('Updated')
  state = toggleBookmark(state, remote)
  expect(state.bookmarks[0]).toEqual(remote)
  state = toggleBookmark(state, remote)
  expect(state.bookmarks).toHaveLength(0)
  expect(() =>
    toggleBookmark(
      {
        ...state,
        bookmarks: Array.from({ length: 100 }, (_, index) => ({
          ...remote,
          url: `http://localhost/${index}`,
        })),
      },
      remote,
    ),
  ).toThrow(/100/)
})
it('appends literal selections and page sources without replacing draft text', () => {
  expect(
    appendBrowserDraft('Existing', {
      title: 'Page',
      url: remote.url,
      text: ' Keep  spaces\n<tag>',
    }),
  ).toBe('Existing\n\nPage\nhttp://localhost:3000/\n\n>  Keep  spaces\n> <tag>')
  expect(appendBrowserDraft('Existing', { title: 'Page', url: remote.url, text: '' })).toBe(
    'Existing\n\nPage\nhttp://localhost:3000/',
  )
})

it('selection preserves order; navigation moves a tab up without title updates reordering it', () => {
  let state = addTab(initialBrowserState('device'), remote)
  const before = state.tabs
  state = visitTab(state, 'remote')
  expect(state.tabs).toBe(before)
  state = recordPage(state, 'remote', { url: 'http://localhost/new', title: 'New' })
  expect(recentTabs(state.tabs)[0].id).toBe('remote')
  const timestamp = state.tabs.find((tab) => tab.id === 'remote')?.visitedAt
  state = recordPage(state, 'remote', { url: 'http://localhost/new', title: 'Renamed' })
  expect(state.tabs.find((tab) => tab.id === 'remote')?.visitedAt).toBe(timestamp)
})

it('accepts legacy device and safe native profiles while retaining distinct bookmark keys', () => {
  const state = initialBrowserState('device')
  const native = { ...state.tabs[0], profileId: 'Work_1' }
  expect(parseBrowserState(JSON.stringify({ ...state, tabs: [native] })).tabs[0]).toEqual(native)
  expect(pageKey(native)).not.toBe(pageKey(state.tabs[0]))
  for (const profileId of ['', 'a'.repeat(65), 'work space', '../work'])
    expect(() =>
      parseBrowserState(JSON.stringify({ ...state, tabs: [{ ...native, profileId }] })),
    ).toThrow(/.+/)
})
it('adopts page-created native tabs in the background, bounds tabs and preserves profiles', () => {
  const state = initialBrowserState('device')
  const native = {
    tabId: 'popup',
    profileId: 'work',
    url: 'http://localhost:3000/',
    title: 'Popup',
  }
  const next = adoptNativeTab(state, native, 1)
  expect(next.active).toBe('device')
  expect(next.tabs[1]).toMatchObject({ id: 'popup', profileId: 'work', kind: 'local' })
  expect(adoptNativeTab(next, native)).toBe(next)
  expect(() => adoptNativeTab(next, { ...native, tabId: '../invalid' })).toThrow(/.+/)
  expect(() =>
    adoptNativeTab(
      {
        ...state,
        tabs: Array.from({ length: 100 }, (_, i) => ({ ...state.tabs[0], id: String(i) })),
      },
      native,
    ),
  ).toThrow(/100/)
})
