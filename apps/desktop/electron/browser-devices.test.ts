import { beforeEach, afterEach, expect, it, vi } from 'vite-plus/test'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserDeviceAnswer, BrowserDeviceChoice } from './browser-device-chooser'
const f = vi.hoisted(() => ({
  root: '',
  frames: new Map<unknown, unknown>(),
  choosers: [] as {
    devices: BrowserDeviceChoice[]
    update: ReturnType<typeof vi.fn>
    close: () => void
    resolve: (answer?: BrowserDeviceAnswer) => void
  }[],
}))
vi.mock('electron', () => ({
  app: { getPath: () => f.root },
  BrowserWindow: { fromId: () => undefined },
  webContents: { fromFrame: (frame: unknown) => f.frames.get(frame) },
  dialog: {
    showMessageBox: vi.fn<() => Promise<{ response: number }>>(async () => ({ response: 1 })),
  },
}))
vi.mock('./browser-device-chooser', () => ({
  openBrowserDeviceChooser: (options: { devices: BrowserDeviceChoice[] }) => {
    let resolve = (_answer?: BrowserDeviceAnswer) => {}
    const answer = new Promise<BrowserDeviceAnswer | undefined>((r) => {
      resolve = r
    })
    const chooser = {
      devices: options.devices,
      answer,
      update: vi.fn<(...args: unknown[]) => void>(),
      close: () => resolve(),
      resolve,
    }
    f.choosers.push(chooser)
    return chooser
  },
}))
import { createBrowserDevices } from './browser-devices'
import { browserPermissions } from './browser-permissions'
const origin = 'https://devices.example'
const usb = {
  deviceId: 'usb-1',
  vendorId: 10,
  productId: 20,
  serialNumber: 'stable',
  productName: 'USB device',
}
function fixture() {
  const contents = Object.assign(new EventEmitter(), {
    mainFrame: { url: origin },
    isDestroyed: () => false,
  })
  f.frames.set(contents.mainFrame, contents)
  const session = Object.assign(new EventEmitter(), {
    setDevicePermissionHandler: vi.fn<(handler: (details: unknown) => boolean) => void>(),
    setBluetoothPairingHandler: vi.fn<(...args: unknown[]) => void>(),
  })
  const tabs = [{ key: 'tab', profileId: 'work', windowId: 1, contents }]
  const manager = createBrowserDevices({
    tabs: () => tabs,
    tabFor: () => tabs[0],
    canFullscreen: () => true,
    prepareFullscreen: () => {},
  } as never)
  manager.attachSession(session as never, 'work')
  manager.attachTab(contents as never)
  const permitted = (device = usb) =>
    session.setDevicePermissionHandler.mock.calls[0]![0]({ deviceType: 'usb', origin, device })
  const choose = () => {
    const callback = vi.fn<(...args: unknown[]) => void>()
    session.emit(
      'select-usb-device',
      { preventDefault: vi.fn<(...args: unknown[]) => void>() },
      { frame: contents.mainFrame, deviceList: [usb] },
      callback,
    )
    return callback
  }
  return { contents, session, manager, permitted, choose }
}
beforeEach(async () => {
  f.root = await mkdtemp(join(tmpdir(), 'browser-devices-'))
  f.frames.clear()
  f.choosers.length = 0
})
afterEach(async () => {
  await rm(f.root, { recursive: true, force: true })
})
const flush = async () => {
  await new Promise((resolve) => setImmediate(resolve))
}
it('requires an exact chosen device; transient grants expire on navigation', async () => {
  const { contents, permitted, choose, session } = fixture()
  expect(permitted()).toBe(false)
  expect(browserPermissions('work').site(origin).requested).toEqual([])
  const callback = choose()
  expect(browserPermissions('work').site(origin).requested).toEqual(['usb'])
  f.choosers[0]!.resolve({ id: usb.deviceId, remember: false })
  await flush()
  expect(callback).toHaveBeenCalledExactlyOnceWith(usb.deviceId)
  expect(permitted()).toBe(true)
  expect(permitted({ ...usb, serialNumber: 'different' })).toBe(false)
  expect(session.listenerCount('usb-device-added')).toBe(0)
  contents.emit('did-navigate')
  expect(permitted()).toBe(false)
})
it('remembers stable devices only in their own profile and supports forget/revocation', async () => {
  const { choose, session, permitted } = fixture()
  choose()
  f.choosers[0]!.resolve({ id: usb.deviceId, remember: true })
  await flush()
  expect(permitted()).toBe(true)
  const second = fixture()
  expect(second.permitted()).toBe(true)
  session.emit('usb-device-revoked', {}, { origin, device: usb })
  expect(second.permitted()).toBe(false)
  expect(
    browserPermissions('personal').device(origin, 'usb:' + JSON.stringify([10, 20, 'stable', ''])),
  ).toBe(false)
})
it('cancels pending choosers on navigation and rejects removed devices', async () => {
  const { contents, choose, session } = fixture()
  const first = choose()
  contents.emit('did-navigate')
  await flush()
  expect(first).toHaveBeenCalledExactlyOnceWith(undefined)
  const second = choose()
  session.emit('usb-device-removed', {}, usb, contents)
  expect(f.choosers[1]!.update).toHaveBeenCalledWith([])
  f.choosers[1]!.resolve({ id: usb.deviceId, remember: true })
  await flush()
  expect(second).toHaveBeenCalledExactlyOnceWith(undefined)
})
it('rejects blocked sites and subframes without opening a chooser', async () => {
  const { choose, session, permitted, contents } = fixture()
  browserPermissions('work').setSite(origin, 'usb', 'block')
  const callback = choose()
  await flush()
  expect(callback).toHaveBeenCalledWith(undefined)
  expect(f.choosers).toHaveLength(0)
  expect(permitted()).toBe(false)
  const subframe = { url: origin }
  f.frames.set(subframe, contents)
  const denied = vi.fn<(...args: unknown[]) => void>()
  session.emit(
    'select-usb-device',
    { preventDefault: vi.fn<(...args: unknown[]) => void>() },
    { frame: subframe, deviceList: [usb] },
    denied,
  )
  expect(denied).toHaveBeenCalledOnce()
  expect(f.choosers).toHaveLength(0)
})
it('keeps Bluetooth scan updates in one chooser and cancels when the site changes', async () => {
  const { contents, manager } = fixture()
  const answer = vi.fn<(...args: unknown[]) => void>(),
    repeated = vi.fn<(...args: unknown[]) => void>()
  contents.emit(
    'select-bluetooth-device',
    { preventDefault: vi.fn<(...args: unknown[]) => void>() },
    [{ deviceId: 'a', deviceName: 'First' }],
    answer,
  )
  contents.emit(
    'select-bluetooth-device',
    { preventDefault: vi.fn<(...args: unknown[]) => void>() },
    [{ deviceId: 'b', deviceName: 'Second' }],
    repeated,
  )
  expect(f.choosers).toHaveLength(1)
  expect(f.choosers[0]!.update).toHaveBeenCalledWith([{ id: 'b', label: 'Second' }])
  manager.releaseTab(contents as never)
  await flush()
  expect(answer).toHaveBeenCalledExactlyOnceWith('')
})
it('rejects a resolved choice if same-origin navigation occurs before its continuation', async () => {
  const { contents, choose, permitted } = fixture()
  const answer = choose()
  f.choosers[0]!.resolve({ id: usb.deviceId, remember: true })
  contents.emit('did-navigate')
  await flush()
  expect(answer).toHaveBeenCalledExactlyOnceWith(undefined)
  expect(permitted()).toBe(false)
})

it.each(['hid', 'serial'] as const)('wires %s selection and exact-device checks', async (kind) => {
  const { session, contents } = fixture()
  const device =
    kind === 'hid'
      ? { deviceId: 'hid-1', name: 'Keyboard', vendorId: 10, productId: 20, serialNumber: 'stable' }
      : {
          portId: 'serial-1',
          portName: '/dev/ttyUSB0',
          vendorId: '10',
          productId: '20',
          serialNumber: 'stable',
        }
  const answer = vi.fn<(...args: unknown[]) => void>()
  const event = { preventDefault: vi.fn<() => void>() }
  if (kind === 'hid')
    session.emit(
      'select-hid-device',
      event,
      { frame: contents.mainFrame, deviceList: [device] },
      answer,
    )
  else session.emit('select-serial-port', event, [device], contents, answer)
  const id = kind === 'hid' ? 'hid-1' : 'serial-1'
  f.choosers[0]!.resolve({ id, remember: true })
  await flush()
  expect(answer).toHaveBeenCalledExactlyOnceWith(id)
  const check = session.setDevicePermissionHandler.mock.calls[0]![0]
  expect(check({ deviceType: kind, origin, device })).toBe(true)
  if (kind === 'hid') session.emit('hid-device-revoked', {}, { origin: origin + '/', device })
  else session.emit('serial-port-revoked', {}, { origin: origin + '/', port: device })
  expect(check({ deviceType: kind, origin, device })).toBe(false)
})
