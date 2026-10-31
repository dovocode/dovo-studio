import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test'
import type { AccountStorage } from '@dovo/protocol'
import { useAccount } from './use-account'

const fixture = vi.hoisted(() => ({
  effects: [] as Array<() => void | (() => void)>,
  loaded: true,
  stop: vi.fn<() => void>(),
  startSync: vi.fn<(active: () => boolean) => () => void>(),
  refreshSync: vi.fn<() => void>(),
}))

// Run the account's effects without a browser renderer, matching native's missing DOM.
vi.mock('react', () => ({
  useMemo: (factory: () => unknown) => factory(),
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
  useEffect: (effect: () => void | (() => void)) => fixture.effects.push(effect),
}))
vi.mock('@dovo/protocol', async (original) => ({
  ...(await original<typeof import('@dovo/protocol')>()),
  AccountClient: class {
    subscribe = () => () => {}
    snapshot = () => ({ loaded: fixture.loaded, directory: { user: { id: 'user' } } })
    sessionId = () => 'session'
    sharing = { startSync: fixture.startSync, refreshSync: fixture.refreshSync }
  },
}))

const storage: AccountStorage = { read: async () => null, write: async () => {} }
const open = async () => {}
beforeEach(() => {
  vi.clearAllMocks()
  fixture.effects = []
  fixture.loaded = true
  fixture.startSync.mockReturnValue(fixture.stop)
})
afterEach(() => vi.unstubAllGlobals())

it('starts and stops account sharing on native without accessing document', () => {
  expect(typeof document).toBe('undefined')
  useAccount(storage, open)
  const cleanup = fixture.effects[0]()
  expect(fixture.startSync).toHaveBeenCalledOnce()
  expect(fixture.startSync.mock.calls[0][0]()).toBe(true)
  cleanup?.()
  expect(fixture.stop).toHaveBeenCalledOnce()
})

it('pauses native sharing in the background and restarts on foreground', () => {
  useAccount(storage, open, undefined, false)
  expect(fixture.effects[0]()).toBeUndefined()
  expect(fixture.startSync).not.toHaveBeenCalled()
  fixture.effects = []
  useAccount(storage, open, undefined, true)
  const cleanup = fixture.effects[0]()
  expect(fixture.startSync).toHaveBeenCalledOnce()
  cleanup?.()
  expect(fixture.stop).toHaveBeenCalledOnce()
})

it('preserves browser visibility refresh and removes its listener on cleanup', () => {
  const browser = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  const remove = vi.spyOn(browser, 'removeEventListener')
  vi.stubGlobal('document', browser)
  useAccount(storage, open)
  const cleanup = fixture.effects[0]()
  const active = fixture.startSync.mock.calls[0][0]
  expect(active()).toBe(true)
  browser.visibilityState = 'hidden'
  expect(active()).toBe(false)
  browser.visibilityState = 'visible'
  browser.dispatchEvent(new Event('visibilitychange'))
  expect(fixture.refreshSync).toHaveBeenCalledOnce()
  cleanup?.()
  expect(remove).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
  browser.dispatchEvent(new Event('visibilitychange'))
  expect(fixture.refreshSync).toHaveBeenCalledOnce()
  expect(fixture.stop).toHaveBeenCalledOnce()
})

it('waits for the account and service preferences before starting sync', () => {
  fixture.loaded = false
  useAccount(storage, open)
  expect(fixture.effects[0]()).toBeUndefined()
  fixture.loaded = true
  fixture.effects = []
  useAccount(storage, open, { ready: false })
  expect(fixture.effects[0]()).toBeUndefined()
  expect(fixture.startSync).not.toHaveBeenCalled()
})
