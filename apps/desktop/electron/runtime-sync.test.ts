import { EventEmitter } from 'node:events'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import type { IpcMainInvokeEvent } from 'electron'
const f = vi.hoisted(() => ({
  handlers: new Map<
    string,
    (event: IpcMainInvokeEvent, value: unknown, retry?: unknown) => unknown
  >(),
  subscribe: vi.fn<(id: string, input: unknown, publish: (event: unknown) => void) => void>(),
  unsubscribe: vi.fn<(id: string) => void>(),
  refresh: vi.fn<(id: string, retry: boolean) => void>(),
  dispose: vi.fn<() => void>(),
}))
vi.mock('electron', () => ({
  ipcMain: {
    handle: (
      name: string,
      handler: (event: IpcMainInvokeEvent, value: unknown, retry?: unknown) => unknown,
    ) => f.handlers.set(name, handler),
  },
}))
vi.mock('./runtime-connections.js', () => ({
  RuntimeConnections: class {
    subscribe = f.subscribe
    unsubscribe = f.unsubscribe
    refresh = f.refresh
    dispose = f.dispose
  },
}))
import { registerRuntimeSync } from './runtime-sync.js'
afterEach(() => {
  vi.clearAllMocks()
  f.handlers.clear()
})
function event(id: number, url = 'file:///app/index.html') {
  const frame = { url }
  const sender = Object.assign(new EventEmitter(), {
    id,
    mainFrame: frame,
    isDestroyed: () => false,
    send: vi.fn<(channel: string, id: string, event: unknown) => void>(),
  })
  return { sender, event: { sender, senderFrame: frame } as unknown as IpcMainInvokeEvent }
}
const input = {
  id: 'subscription',
  connection: {
    address: 'http://paired.lan:8787',
    token: 'paired-runtime-token-at-least-20-characters',
  },
  tasks: ['thread'],
  scopes: [],
  detailScopes: [],
}
it('routes events only to the owning window and releases its subscriptions on navigation and closure', () => {
  const manager = registerRuntimeSync('/app/index.html')
  const main = event(1),
    popout = event(2, 'file:///app/index.html#thread=target')
  f.handlers.get('runtime:sync-watch')?.(main.event, input)
  f.handlers.get('runtime:sync-watch')?.(popout.event, input)
  expect(f.subscribe.mock.calls.map((call) => call[0])).toEqual([
    '1:subscription',
    '2:subscription',
  ])
  f.subscribe.mock.calls[1][2]({ type: 'status', status: 'live', online: true })
  expect(popout.sender.send).toHaveBeenCalledOnce()
  expect(main.sender.send).not.toHaveBeenCalled()
  main.sender.emit('did-start-navigation', {}, 'file:///app/index.html', false, true)
  expect(f.unsubscribe).toHaveBeenCalledWith('1:subscription')
  expect(f.unsubscribe).not.toHaveBeenCalledWith('2:subscription')
  f.handlers.get('runtime:sync-watch')?.(main.event, input)
  expect(main.sender.listenerCount('did-start-navigation')).toBe(1)
  popout.sender.emit('destroyed')
  expect(f.unsubscribe).toHaveBeenCalledWith('2:subscription')
  manager.dispose()
  expect(f.dispose).toHaveBeenCalledOnce()
})
it('rejects foreign and child frames before they access runtime connections', () => {
  registerRuntimeSync('/app/index.html')
  const foreign = event(3, 'https://foreign.test/')
  expect(() => f.handlers.get('runtime:sync-watch')?.(foreign.event, input)).toThrow('Untrusted')
  const main = event(1)
  expect(() =>
    f.handlers.get('runtime:sync-watch')?.(
      { ...main.event, senderFrame: foreign.event.senderFrame },
      input,
    ),
  ).toThrow('Untrusted')
  expect(f.subscribe).not.toHaveBeenCalled()
})
it('validates subscriptions and scopes refresh/unwatch by window identity', () => {
  registerRuntimeSync('/app/index.html')
  const main = event(1)
  expect(() =>
    f.handlers.get('runtime:sync-watch')?.(main.event, {
      ...input,
      connection: { ...input.connection, address: 'file:///secret' },
    }),
  ).toThrow(/connection/)
  f.handlers.get('runtime:sync-refresh')?.(main.event, 'subscription', true)
  f.handlers.get('runtime:sync-unwatch')?.(main.event, 'subscription')
  expect(f.refresh).toHaveBeenCalledWith('1:subscription', true)
  expect(f.unsubscribe).toHaveBeenCalledWith('1:subscription')
})
