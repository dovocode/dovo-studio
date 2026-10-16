import { expect, it, vi } from 'vite-plus/test'
import type { PreviewDevice } from '@dovo/protocol'
import { controlNativeDevice, deviceControls } from './device-controls'
import type { NativeSimulator } from './simulator-native'

const ios: PreviewDevice = {
  id: 'ios:test',
  name: 'iPhone',
  platform: 'ios',
  state: 'booted',
  runtime: 'iOS',
}
function setup(device = ios) {
  const input = vi.fn<NativeSimulator['input']>().mockResolvedValue(undefined)
  const driver = controlNativeDevice(
    {
      input,
      screenPoints: () => ({ width: 400, height: 800 }),
      start: () => () => {},
      release: async () => {},
      close: async () => {},
    },
    device,
  )
  return { input, driver }
}

it('keeps a finger down for the requested long press and lifts it once', async () => {
  const { input, driver } = setup()
  const pending = driver.input({
    type: 'gesture',
    gesture: 'long-press',
    x: 20,
    y: 30,
    durationMs: 50,
  })
  await Promise.resolve()
  expect(
    input.mock.calls.map(([value]) => (value.type === 'pointer' ? value.phase : value.type)),
  ).toEqual(['down'])
  await pending
  expect(input.mock.calls.map(([value]) => value)).toEqual([
    { type: 'pointer', phase: 'down', pointerType: 'touch', button: 'left', x: 20, y: 30 },
    { type: 'pointer', phase: 'up', pointerType: 'touch', button: 'left', x: 20, y: 30 },
  ])
})

it('holds before dragging and releases at the final position', async () => {
  const { input, driver } = setup()
  const pending = driver.input({
    type: 'gesture',
    gesture: 'drag',
    x: 10,
    y: 20,
    endX: 110,
    endY: 220,
    durationMs: 100,
  })
  await Promise.resolve()
  expect(input).toHaveBeenCalledTimes(1)
  await pending
  expect(
    input.mock.calls.map(([value]) => (value.type === 'pointer' ? value.phase : value.type)),
  ).toEqual(['down', 'move', 'move', 'move', 'move', 'up'])
  expect(input.mock.calls.at(-1)?.[0]).toMatchObject({ phase: 'up', x: 110, y: 220 })
})

it('releases a finger if a gesture is cancelled while holding', async () => {
  const { input, driver } = setup()
  const abort = new AbortController()
  const pending = driver.input(
    { type: 'gesture', gesture: 'long-press', x: 10, y: 20, durationMs: 5000 },
    undefined,
    abort.signal,
  )
  const rejected = pending.catch((error: unknown) => error)
  await Promise.resolve()
  abort.abort()
  expect(await rejected).toMatchObject({ name: 'AbortError' })
  expect(input.mock.calls.at(-1)?.[0]).toMatchObject({ phase: 'up', x: 10, y: 20 })
})

it('rechecks authority while dragging and still releases the touch on revocation', async () => {
  const { input, driver } = setup()
  let allowed = true
  const pending = driver.input(
    { type: 'gesture', gesture: 'drag', x: 10, y: 20, endX: 110, endY: 220, durationMs: 100 },
    () => {
      if (!allowed) throw new Error('revoked')
    },
  )
  const rejected = pending.catch((error: unknown) => error)
  input.mockImplementation(async (value) => {
    if (value.type === 'pointer' && value.phase === 'move') allowed = false
  })
  expect(await rejected).toMatchObject({ message: 'revoked' })
  expect(input.mock.calls.at(-1)?.[0]).toMatchObject({ phase: 'up', x: 35, y: 70 })
})

it('performs a double tap as two distinct contacts', async () => {
  const { input, driver } = setup()
  const pending = driver.input({
    type: 'gesture',
    gesture: 'double-tap',
    x: 10,
    y: 20,
    durationMs: 100,
  })
  await pending
  expect(
    input.mock.calls.map(([value]) => (value.type === 'pointer' ? value.phase : value.type)),
  ).toEqual(['down', 'up', 'down', 'up'])
})

it('maps navigation to the correct native platform controls', async () => {
  const { input, driver } = setup()
  await driver.input({ type: 'device-button', button: 'back' })
  expect(input.mock.calls[0]?.[0]).toEqual({
    type: 'scroll',
    x: 1,
    y: 400,
    deltaX: -320,
    deltaY: 0,
  })
  await expect(driver.input({ type: 'device-button', button: 'app-switcher' })).rejects.toThrow(
    'automation runner',
  )
  expect(deviceControls(ios).controls).not.toContain('app-switcher')
  const android = setup({ ...ios, id: 'android:test', platform: 'android' })
  await android.driver.input({ type: 'device-button', button: 'app-switcher' })
  await android.driver.input({ type: 'device-button', button: 'back' })
  expect(android.input.mock.calls.map(([value]) => value)).toEqual([
    { type: 'key', key: 'AppSwitch' },
    { type: 'back' },
  ])
})

it('uses ADB gestures on physical Android and reports unsupported controls honestly', async () => {
  const physicalAndroid = { ...ios, platform: 'android' as const, kind: 'physical' as const }
  const { input, driver } = setup(physicalAndroid)
  const hold = {
    type: 'gesture' as const,
    gesture: 'long-press' as const,
    x: 10,
    y: 20,
    durationMs: 50,
  }
  await driver.input(hold)
  expect(input.mock.calls.map(([value]) => value)).toEqual([hold])
  const pinch = {
    type: 'gesture' as const,
    gesture: 'pinch' as const,
    x: 100,
    y: 200,
    startRadius: 10,
    endRadius: 50,
    durationMs: 300,
  }
  await expect(driver.input(pinch)).rejects.toThrow('unavailable')
  const simulator = setup()
  await simulator.driver.input(pinch)
  await expect(simulator.driver.input({ type: 'device-button', button: 'mute' })).rejects.toThrow(
    'mute',
  )
  expect(deviceControls(ios).controls).toContain('pinch')
  expect(deviceControls(physicalAndroid).controls).not.toContain('pinch')
  expect(deviceControls({ ...physicalAndroid, kind: 'simulator' }).controls).toContain('pinch')
})
