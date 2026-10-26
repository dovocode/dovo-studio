import { afterEach, expect, it, vi } from 'vite-plus/test'
import {
  readSharedBrowserLibrary,
  saveSharedBrowserLibrary,
  SHARED_BROWSER_LIBRARY_KEY,
  browserQuote,
  browserAddress,
  browserPageKey,
  rememberBrowserVisit,
  readSharedBrowserTabs,
  recentBrowserTabs,
  saveSharedBrowserTabs,
  visitBrowserTab,
  type BrowserTab,
} from './shared-browser-tabs'
afterEach(() => vi.unstubAllGlobals())
const local: BrowserTab = {
  id: 'local',
  kind: 'web',
  url: 'http://localhost:3000/',
  title: 'Local',
  profileId: 'work',
  visitedAt: 10,
}
const remote: BrowserTab = {
  id: 'remote',
  kind: 'remote',
  url: 'http://vpn.local/',
  title: 'Remote',
  profileId: 'personal',
  runtimeId: 'mac',
  visitedAt: 20,
}
it('orders by visits without changing session IDs, computer/profile ownership or the source list', () => {
  const tabs = [local, remote]
  const visited = visitBrowserTab(tabs, 'local', 20)
  expect(recentBrowserTabs(visited).map((tab) => tab.id)).toEqual(['local', 'remote'])
  expect(visited[0]).toEqual({ ...local, visitedAt: 21 })
  expect(visited[1]).toBe(remote)
  expect(tabs).toEqual([local, remote])
})
it('restores local and remote tabs with their profiles without storing runtime credentials', () => {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key),
    setItem: (key: string, value: string) => values.set(key, value),
  })
  saveSharedBrowserTabs({ tabs: [local, remote], active: 'remote' })
  expect(readSharedBrowserTabs()).toEqual({ state: { tabs: [local, remote], active: 'remote' } })
  expect([...values.values()][0]).not.toContain('token')
})
it('rejects malformed, duplicate or stale active-tab storage instead of reassigning ownership', () => {
  for (const value of [
    'bad json',
    JSON.stringify({ tabs: [local, local], active: local.id }),
    JSON.stringify({ tabs: [remote], active: 'missing' }),
  ]) {
    vi.stubGlobal('localStorage', { getItem: () => value })
    expect(readSharedBrowserTabs().error).toBeTruthy()
    expect(readSharedBrowserTabs().state).toBeUndefined()
  }
})
it('preserves literal multiline selections and source context in the draft quote', () => {
  expect(
    browserQuote({
      text: 'Keep  spaces\r\n\r\n<script>literal</script>',
      title: 'A page',
      url: 'http://vpn.local/',
    }),
  ).toBe('A page\nhttp://vpn.local/\n\n> Keep  spaces\n> \n> <script>literal</script>')
})

it('resolves searches and web addresses while preserving HTTP development connections', () => {
  expect(browserAddress('  react hooks  ')).toBe('https://www.google.com/search?q=react%20hooks')
  expect(browserAddress('example.com/docs')).toBe('https://example.com/docs')
  for (const value of ['http://tailscale-host:8080/', 'http://100.64.0.1/', 'http://[::1]:3000/'])
    expect(browserAddress(value)).toBe(value)
  expect(browserAddress('localhost:3000')).toBe('http://localhost:3000/')
  expect(browserAddress('192.168.1.2:8080')).toBe('http://192.168.1.2:8080/')
  expect(browserAddress('[::1]:3000')).toBe('http://[::1]:3000/')
  expect(browserAddress('')).toBe('')
  for (const value of [
    'javascript:alert(1)',
    'data:text/html,hi',
    'file:///etc/passwd',
    'ftp://example.com',
    'JaVaScRiPt:123',
  ])
    expect(() => browserAddress(value)).toThrow('Only HTTP and HTTPS addresses are supported.')
})
it('deduplicates visits by page and source, keeps latest metadata, and bounds immutable MRU history', () => {
  const previous = [local, remote]
  const update = { ...local, id: 'new-session', title: 'Updated', visitedAt: 30 }
  const result = rememberBrowserVisit(previous, update)
  expect(result).toEqual([update, remote])
  expect(previous).toEqual([local, remote])
  expect(rememberBrowserVisit([remote, remote, local], update)).toEqual([update, remote])
  expect(browserPageKey({ ...local, runtimeId: 'ignored' })).toBe(browserPageKey(local))
  expect(browserPageKey({ ...remote, runtimeId: 'other' })).not.toBe(browserPageKey(remote))
  expect(browserPageKey({ ...remote, profileId: 'other' })).not.toBe(browserPageKey(remote))
  expect(
    rememberBrowserVisit(
      Array.from({ length: 220 }, (_, i) => ({ ...local, url: `http://localhost/${i}` })),
      remote,
    ),
  ).toHaveLength(200)
  expect(rememberBrowserVisit(previous, { ...local, url: '' })).toEqual(previous)
})
function storage(name = 'localStorage') {
  const values = new Map<string, string>()
  vi.stubGlobal(name, {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  })
  return values
}
it('validates bounds and shapes for shared libraries and per-window recently closed tabs', () => {
  const values = storage()
  for (const [field, limit] of [
    ['bookmarks', 100],
    ['visits', 200],
  ] as const) {
    const valid = { bookmarks: [], visits: [], [field]: Array.from({ length: limit }, () => local) }
    saveSharedBrowserLibrary(valid)
    expect(readSharedBrowserLibrary()).toEqual(valid)
    for (const invalid of [
      Array.from({ length: limit + 1 }, () => local),
      [{ ...local, kind: 'unknown' }],
    ]) {
      const state = { ...valid, [field]: invalid }
      values.set(SHARED_BROWSER_LIBRARY_KEY, JSON.stringify(state))
      expect(readSharedBrowserLibrary().error).toBeTruthy()
      expect(() =>
        saveSharedBrowserLibrary({
          ...valid,
          [field]: Array.from({ length: limit + 1 }, () => local),
        }),
      ).toThrow('Saved browser library could not be restored.')
    }
  }
  saveSharedBrowserTabs({
    tabs: [local],
    active: local.id,
    closed: Array.from({ length: 20 }, () => remote),
  })
  expect(readSharedBrowserTabs().state?.closed).toHaveLength(20)
  expect(() =>
    saveSharedBrowserTabs({
      tabs: [local],
      active: local.id,
      closed: Array.from({ length: 21 }, () => remote),
    }),
  ).toThrow('Saved browser tabs could not be restored.')
})
it('isolates windows and never lets unrelated tab saves overwrite the shared library', () => {
  const persistent = storage()
  const session = storage('sessionStorage')
  const windowId = '12345678-abcd-4321-abcd-123456789abc'
  const main = { tabs: [local], active: local.id, closed: [remote] }
  const second = { tabs: [remote], active: remote.id, closed: [local] }
  saveSharedBrowserTabs(main)
  saveSharedBrowserTabs(second, windowId)
  expect(readSharedBrowserTabs()).toEqual({ state: main })
  expect(readSharedBrowserTabs(windowId.toUpperCase())).toEqual({ state: second })
  const library = { bookmarks: [remote], visits: [local] }
  saveSharedBrowserLibrary(library)
  saveSharedBrowserTabs({ ...main, bookmarks: [], visits: [] })
  saveSharedBrowserTabs({ ...second, bookmarks: [], visits: [] }, windowId)
  expect(readSharedBrowserLibrary()).toEqual(library)
  expect([...persistent.keys()].sort()).toEqual(
    ['dovo.shared-browser-tabs.v1', SHARED_BROWSER_LIBRARY_KEY].sort(),
  )
  expect(session.size).toBe(1)
  // A fresh window session drops extra tabs while persistent main/library state remains.
  storage('sessionStorage')
  expect(readSharedBrowserTabs(windowId)).toEqual({})
  expect(readSharedBrowserTabs()).toEqual({ state: main })
  expect(readSharedBrowserLibrary()).toEqual(library)
  for (const invalid of ['', '../main', SHARED_BROWSER_LIBRARY_KEY, 'arbitrary', 'main.window']) {
    expect(() => saveSharedBrowserTabs(main, invalid)).toThrow('Invalid browser window ID')
    expect(readSharedBrowserTabs(invalid).error).toBeTruthy()
  }
})
it('migrates embedded main library once and preserves the original main key', () => {
  const values = storage()
  const legacyKey = 'dovo.shared-browser-tabs.v1'
  const legacy = {
    tabs: [local],
    active: local.id,
    bookmarks: [remote],
    visits: [local],
    closed: [remote],
  }
  values.set(legacyKey, JSON.stringify(legacy))
  expect(readSharedBrowserTabs()).toEqual({
    state: { tabs: [local], active: local.id, closed: [remote] },
  })
  expect(readSharedBrowserLibrary()).toEqual({ bookmarks: [remote], visits: [local] })
  saveSharedBrowserLibrary({ bookmarks: [], visits: [] })
  readSharedBrowserTabs()
  expect(readSharedBrowserLibrary()).toEqual({ bookmarks: [], visits: [] })
  saveSharedBrowserTabs(legacy)
  expect(JSON.parse(values.get(legacyKey)!)).toEqual({
    tabs: [local],
    active: local.id,
    closed: [remote],
  })
  expect(readSharedBrowserLibrary()).toEqual({ bookmarks: [], visits: [] })
})
it('can migrate before reading tabs and surfaces inaccessible or malformed library storage', () => {
  const values = storage()
  values.set(
    'dovo.shared-browser-tabs.v1',
    JSON.stringify({ tabs: [local], active: local.id, bookmarks: [remote] }),
  )
  expect(readSharedBrowserLibrary()).toEqual({ bookmarks: [remote], visits: [] })
  values.set(SHARED_BROWSER_LIBRARY_KEY, 'bad json')
  expect(readSharedBrowserLibrary().error).toBeTruthy()
  expect(readSharedBrowserTabs().state?.tabs).toEqual([local])
  expect(values.get(SHARED_BROWSER_LIBRARY_KEY)).toBe('bad json')
  vi.stubGlobal('localStorage', {
    getItem: () => {
      throw new Error('Storage blocked')
    },
  })
  expect(readSharedBrowserLibrary().error).toBeTruthy()
})

it('formats a page without an empty quote and preserves whitespace-only selections', () => {
  expect(browserQuote({ text: '', title: 'A page', url: 'http://localhost/' })).toBe(
    'A page\nhttp://localhost/',
  )
  expect(browserQuote({ text: '  \n\n ', title: 'A page', url: 'http://localhost/' })).toBe(
    'A page\nhttp://localhost/\n\n>   \n> \n>  ',
  )
})

it('rejects embedded credentials, unsupported schemes and oversized final addresses', () => {
  for (const input of [
    'http://user:password@localhost:3000',
    'https://user@example.com',
    'user@example.com',
  ])
    expect(() => browserAddress(input)).toThrow('Use an HTTP or HTTPS address without credentials.')
  for (const input of ['user:password@example.com', 'custom-app://open/page', 'intent:123'])
    expect(() => browserAddress(input)).toThrow('Only HTTP and HTTPS addresses are supported.')
  for (const input of [`https://example.com/${'x'.repeat(4096)}`, '字'.repeat(1000)])
    expect(() => browserAddress(input)).toThrow(
      'Browser addresses must be at most 4096 characters.',
    )
  const maximum = `https://example.com/${'x'.repeat(4096 - 'https://example.com/'.length)}`
  expect(browserAddress(maximum)).toBe(maximum)
})
