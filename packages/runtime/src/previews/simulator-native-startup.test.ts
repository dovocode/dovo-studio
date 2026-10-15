import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test'
import { ChildProcess } from 'node:child_process'
import { PassThrough } from 'node:stream'
import sharp from 'sharp'
import type { PreviewDevice } from '@dovo/protocol'
import { androidSimulator, iosSimulator } from './simulator-native'
import { physicalDevice } from './physical-device'
import { physicalAndroid } from './physical-android'

const mocked = vi.hoisted(() => ({
  mkdtemp: vi.fn<() => Promise<string>>(),
  readdir: vi.fn<() => Promise<string[]>>(),
  readFile: vi.fn<() => Promise<string>>(),
  access: vi.fn<() => Promise<void>>(),
  mkdir: vi.fn<() => Promise<void>>(),
  rm: vi.fn<() => Promise<void>>(),
  spawn: vi.fn<() => ChildProcess>(),
  execute: vi.fn<(...args: unknown[]) => Promise<{ stdout: string; stderr: string }>>(),
  androidTool: vi.fn<() => Promise<string>>(),
  emulatorKey: vi.fn<() => Promise<{ token: () => string; dispose: () => Promise<void> }>>(),
  dispose: vi.fn<() => Promise<void>>(),
  rpc: vi.fn<() => void>(),
  probe: vi.fn<() => true>(),
  ready: vi.fn<() => Promise<void>>(),
  describe: vi.fn<() => Promise<object>>(),
  hid: vi.fn<() => PassThrough>(),
  close: vi.fn<() => void>(),
}))
vi.mock('node:fs/promises', async (original) => ({
  ...(await original<typeof import('node:fs/promises')>()),
  mkdtemp: mocked.mkdtemp,
  readdir: mocked.readdir,
  readFile: mocked.readFile,
  access: mocked.access,
  mkdir: mocked.mkdir,
  rm: mocked.rm,
}))
vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof import('node:child_process')>()),
  spawn: mocked.spawn,
  execFile: Object.assign(vi.fn<() => void>(), {
    [Symbol.for('nodejs.util.promisify.custom')]: mocked.execute,
  }),
}))
vi.mock('./devices.js', () => ({ androidTool: mocked.androidTool }))
vi.mock('./emulator-auth.js', () => ({ emulatorKey: mocked.emulatorKey }))
vi.mock('./simulator-rpc.js', () => ({
  SimulatorRpc: class {
    constructor() {
      mocked.rpc()
    }
    metadata = { set: vi.fn<() => void>() }
    ready = mocked.ready
    unary = mocked.describe
    writeStream = mocked.hid
    close = mocked.close
  },
}))

const ios: PreviewDevice = {
  id: 'ios:qa',
  runtime: 'qa',
  name: 'Phone',
  platform: 'ios',
  kind: 'simulator',
  state: 'booted',
}
const android: PreviewDevice = {
  ...ios,
  id: 'android:qa',
  runtime: 'emulator-5554',
  platform: 'android',
}
const phone: PreviewDevice = { ...ios, kind: 'physical' }
const androidPhone: PreviewDevice = { ...android, kind: 'physical' }

function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error('Promise not initialized')
  }
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
function processDouble() {
  const child = new ChildProcess()
  const stdin = new PassThrough(),
    stdout = new PassThrough(),
    stderr = new PassThrough()
  Object.assign(child, { pid: 123, stdin, stdout, stderr })
  const exit = () => {
    Object.defineProperty(child, 'exitCode', { value: 0, configurable: true })
    child.emit('exit', 0, null)
  }
  const kill = vi.spyOn(child, 'kill').mockImplementation(() => {
    exit()
    return true
  })
  stdin.on('finish', exit)
  return { child, stdin, stdout, stderr, kill }
}
function cancellation(mode: 'aborted' | 'revoked') {
  const controller = new AbortController()
  const reason = new Error(`Preparation ${mode}`)
  let revoked = false
  return {
    signal: controller.signal,
    reason,
    authorize: () => {
      if (revoked) throw reason
    },
    cancel: () => {
      if (mode === 'aborted') controller.abort(reason)
      else revoked = true
    },
  }
}
function listeners(signal: AbortSignal) {
  const add = vi.spyOn(signal, 'addEventListener')
  const remove = vi.spyOn(signal, 'removeEventListener')
  return () => {
    expect(add.mock.calls.length).toBeGreaterThan(0)
    expect(remove.mock.calls).toEqual(add.mock.calls.map(([name, callback]) => [name, callback]))
  }
}
beforeEach(() => {
  mocked.mkdtemp.mockResolvedValue('/mock/native-preview')
  mocked.readdir.mockResolvedValue(['pid_123.ini'])
  mocked.readFile.mockResolvedValue(
    'avd.name=Phone\nport.serial=5554\ngrpc.port=8554\ngrpc.jwks=/mock/keys\ngrpc.jwk_active=/mock/active',
  )
  mocked.access.mockResolvedValue(undefined)
  mocked.mkdir.mockResolvedValue(undefined)
  mocked.rm.mockResolvedValue(undefined)
  mocked.androidTool.mockResolvedValue('/mock/adb')
  mocked.execute.mockResolvedValue({ stdout: 'Physical size: 1080x2400', stderr: '' })
  mocked.dispose.mockResolvedValue(undefined)
  mocked.emulatorKey.mockResolvedValue({ token: () => 'token', dispose: mocked.dispose })
  mocked.ready.mockResolvedValue(undefined)
  mocked.describe.mockResolvedValue({
    targetDescription: { udid: 'qa', screenDimensions: { widthPoints: 400, heightPoints: 800 } },
  })
  mocked.hid.mockImplementation(() => new PassThrough({ objectMode: true }))
  mocked.probe.mockReturnValue(true)
  vi.spyOn(process, 'kill').mockImplementation(mocked.probe)
  vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
  vi.stubEnv('DOVO_IOS_DEVICE_HELPER', '/mock/ios-device')
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.resetAllMocks()
  vi.unstubAllEnvs()
})

it.each(['aborted', 'revoked'] as const)(
  'does not spawn an iOS companion after temp preparation is %s and removes the directory',
  async (mode) => {
    const directory = deferred<string>()
    mocked.mkdtemp.mockReturnValue(directory.promise)
    const guard = cancellation(mode)
    const opening = iosSimulator(ios, guard.authorize, guard.signal)
    const failed = opening.catch((error: unknown) => error)
    expect(mocked.mkdtemp).toHaveBeenCalledOnce()
    guard.cancel()
    directory.resolve('/mock/native-preview')
    expect(await failed).toBe(guard.reason)
    expect(mocked.spawn).not.toHaveBeenCalled()
    expect(mocked.rpc).not.toHaveBeenCalled()
    expect(mocked.rm).toHaveBeenCalledExactlyOnceWith('/mock/native-preview', {
      recursive: true,
      force: true,
    })
  },
)

it.each(['aborted', 'revoked'] as const)(
  'cleans up the iOS companion and RPC if readiness is %s',
  async (mode) => {
    const ready = deferred<void>()
    mocked.ready.mockReturnValue(ready.promise)
    const native = processDouble()
    mocked.spawn.mockReturnValue(native.child)
    const guard = cancellation(mode)
    const detached = listeners(guard.signal)
    const opening = iosSimulator(ios, guard.authorize, guard.signal)
    const failed = opening.catch((error: unknown) => error)
    await vi.waitFor(() => expect(mocked.ready).toHaveBeenCalledOnce())
    guard.cancel()
    if (mode === 'revoked') ready.resolve()
    expect(await failed).toBe(guard.reason)
    expect(mocked.describe).not.toHaveBeenCalled()
    expect(mocked.close).toHaveBeenCalledOnce()
    expect(native.kill).toHaveBeenCalledOnce()
    expect(mocked.rm).toHaveBeenCalledOnce()
    detached()
  },
)

it.each(['aborted', 'revoked'] as const)(
  'does not open the iOS HID stream when description preparation is %s',
  async (mode) => {
    const description = deferred<object>()
    mocked.describe.mockReturnValue(description.promise)
    const native = processDouble()
    mocked.spawn.mockReturnValue(native.child)
    const guard = cancellation(mode)
    const opening = iosSimulator(ios, guard.authorize, guard.signal)
    const failed = opening.catch((error: unknown) => error)
    await vi.waitFor(() => expect(mocked.describe).toHaveBeenCalledOnce())
    guard.cancel()
    if (mode === 'revoked') description.resolve({})
    expect(await failed).toBe(guard.reason)
    expect(mocked.hid).not.toHaveBeenCalled()
    expect(mocked.close).toHaveBeenCalledOnce()
    expect(native.kill).toHaveBeenCalledOnce()
    expect(mocked.rm).toHaveBeenCalledOnce()
  },
)

it('removes the iOS directory even if spawn throws synchronously', async () => {
  mocked.spawn.mockImplementation(() => {
    throw new Error('Spawn failed')
  })
  await expect(iosSimulator(ios)).rejects.toThrow('Spawn failed')
  expect(mocked.rm).toHaveBeenCalledOnce()
})

it('removes startup listeners on successful iOS construction and preserves ordinary close', async () => {
  const native = processDouble()
  mocked.spawn.mockReturnValue(native.child)
  const controller = new AbortController()
  const detached = listeners(controller.signal)
  const driver = await iosSimulator(ios, undefined, controller.signal)
  expect(driver.screenPoints?.()).toEqual({ width: 400, height: 800 })
  detached()
  controller.abort()
  expect(mocked.close).not.toHaveBeenCalled()
  await driver.close()
  expect(mocked.close).toHaveBeenCalledOnce()
  expect(native.kill).toHaveBeenCalledOnce()
  expect(mocked.rm).toHaveBeenCalledOnce()
})

it.each(['aborted', 'revoked'] as const)(
  'does not probe an emulator or open its RPC when endpoint discovery is %s',
  async (mode) => {
    const directory = deferred<string[]>()
    mocked.readdir.mockReturnValue(directory.promise)
    const guard = cancellation(mode)
    const opening = androidSimulator(android, guard.authorize, guard.signal)
    const failed = opening.catch((error: unknown) => error)
    guard.cancel()
    directory.resolve(['pid_123.ini'])
    expect(await failed).toBe(guard.reason)
    expect(mocked.probe).not.toHaveBeenCalled()
    expect(mocked.readFile).not.toHaveBeenCalled()
    expect(mocked.emulatorKey).not.toHaveBeenCalled()
    expect(mocked.rpc).not.toHaveBeenCalled()
    expect(mocked.execute).not.toHaveBeenCalled()
  },
)

it.each(['aborted', 'revoked'] as const)(
  'disposes a signing key prepared after emulator construction is %s',
  async (mode) => {
    const signer = deferred<{ token: () => string; dispose: () => Promise<void> }>()
    mocked.emulatorKey.mockReturnValue(signer.promise)
    const guard = cancellation(mode)
    const opening = androidSimulator(android, guard.authorize, guard.signal)
    const failed = opening.catch((error: unknown) => error)
    await vi.waitFor(() => expect(mocked.emulatorKey).toHaveBeenCalledOnce())
    guard.cancel()
    signer.resolve({ token: () => 'token', dispose: mocked.dispose })
    expect(await failed).toBe(guard.reason)
    expect(mocked.dispose).toHaveBeenCalledOnce()
    expect(mocked.rpc).not.toHaveBeenCalled()
    expect(mocked.execute).not.toHaveBeenCalled()
  },
)

it('cleans up the emulator RPC and signing key promptly when readiness is aborted', async () => {
  mocked.ready.mockReturnValue(new Promise(() => {}))
  const guard = cancellation('aborted')
  const detached = listeners(guard.signal)
  const opening = androidSimulator(android, guard.authorize, guard.signal)
  const failed = opening.catch((error: unknown) => error)
  await vi.waitFor(() => expect(mocked.ready).toHaveBeenCalledOnce())
  guard.cancel()
  expect(await failed).toBe(guard.reason)
  expect(mocked.close).toHaveBeenCalledOnce()
  expect(mocked.dispose).toHaveBeenCalledOnce()
  expect(mocked.androidTool).not.toHaveBeenCalled()
  detached()
})

it.each(['aborted', 'revoked'] as const)(
  'does not access an emulator through ADB if tool discovery is %s',
  async (mode) => {
    const adb = deferred<string>()
    mocked.androidTool.mockReturnValue(adb.promise)
    const guard = cancellation(mode)
    const opening = androidSimulator(android, guard.authorize, guard.signal)
    const failed = opening.catch((error: unknown) => error)
    await vi.waitFor(() => expect(mocked.androidTool).toHaveBeenCalledOnce())
    guard.cancel()
    adb.resolve('/mock/adb')
    expect(await failed).toBe(guard.reason)
    expect(mocked.execute).not.toHaveBeenCalled()
    expect(mocked.close).toHaveBeenCalledOnce()
    expect(mocked.dispose).toHaveBeenCalledOnce()
  },
)

it('cleans up the emulator RPC and signing key if tool discovery fails', async () => {
  const failure = new Error('ADB unavailable')
  mocked.androidTool.mockRejectedValue(failure)
  await expect(androidSimulator(android)).rejects.toBe(failure)
  expect(mocked.close).toHaveBeenCalledOnce()
  expect(mocked.dispose).toHaveBeenCalledOnce()
})

it('passes cancellation to the emulator display command and rechecks before returning', async () => {
  const command = deferred<{ stdout: string; stderr: string }>()
  mocked.execute.mockReturnValue(command.promise)
  const guard = cancellation('aborted')
  const opening = androidSimulator(android, guard.authorize, guard.signal)
  const failed = opening.catch((error: unknown) => error)
  await vi.waitFor(() => expect(mocked.execute).toHaveBeenCalledOnce())
  expect(mocked.execute).toHaveBeenCalledWith(
    '/mock/adb',
    expect.any(Array),
    expect.objectContaining({ signal: guard.signal }),
  )
  guard.cancel()
  command.resolve({ stdout: 'Physical size: 1080x2400', stderr: '' })
  expect(await failed).toBe(guard.reason)
  expect(mocked.close).toHaveBeenCalledOnce()
  expect(mocked.dispose).toHaveBeenCalledOnce()
})

it('preserves ordinary Android emulator construction and close', async () => {
  const driver = await androidSimulator(android)
  expect(mocked.execute).toHaveBeenCalledOnce()
  await driver.close()
  expect(mocked.close).toHaveBeenCalledOnce()
  expect(mocked.dispose).toHaveBeenCalledOnce()
})

it.each(['aborted', 'revoked'] as const)(
  'does not access a physical Android phone after tool discovery is %s',
  async (mode) => {
    const adb = deferred<string>()
    mocked.androidTool.mockReturnValue(adb.promise)
    const guard = cancellation(mode)
    const opening = physicalAndroid(androidPhone, guard.authorize, guard.signal)
    const failed = opening.catch((error: unknown) => error)
    guard.cancel()
    adb.resolve('/mock/adb')
    expect(await failed).toBe(guard.reason)
    expect(mocked.execute).not.toHaveBeenCalled()
  },
)

it('passes cancellation to physical Android display preparation and checks after it', async () => {
  const command = deferred<{ stdout: string; stderr: string }>()
  mocked.execute.mockReturnValue(command.promise)
  const guard = cancellation('revoked')
  const opening = physicalAndroid(androidPhone, guard.authorize, guard.signal)
  const failed = opening.catch((error: unknown) => error)
  await vi.waitFor(() => expect(mocked.execute).toHaveBeenCalledOnce())
  expect(mocked.execute).toHaveBeenCalledWith(
    '/mock/adb',
    expect.any(Array),
    expect.objectContaining({ signal: guard.signal }),
  )
  guard.cancel()
  command.resolve({ stdout: 'Physical size: 1080x2400', stderr: '' })
  expect(await failed).toBe(guard.reason)
})

it.each(['aborted', 'revoked'] as const)(
  'does not build a helper or connect a physical iPhone after helper preparation is %s',
  async (mode) => {
    vi.stubEnv('DOVO_IOS_DEVICE_HELPER', '')
    const access = deferred<void>()
    mocked.access.mockReturnValueOnce(access.promise)
    const guard = cancellation(mode)
    const opening = physicalDevice(phone, guard.authorize, guard.signal)
    const failed = opening.catch((error: unknown) => error)
    expect(mocked.access).toHaveBeenCalledOnce()
    guard.cancel()
    access.resolve()
    expect(await failed).toBe(guard.reason)
    expect(mocked.mkdir).not.toHaveBeenCalled()
    expect(mocked.execute).not.toHaveBeenCalled()
    expect(mocked.spawn).not.toHaveBeenCalled()
  },
)

it('cleans up both physical iPhone processes and startup timers when aborted', async () => {
  vi.useFakeTimers()
  const native = processDouble(),
    decoder = processDouble()
  mocked.spawn.mockReturnValueOnce(native.child).mockReturnValueOnce(decoder.child)
  const guard = cancellation('aborted')
  const detached = listeners(guard.signal)
  const opening = physicalDevice(phone, guard.authorize, guard.signal)
  const failed = opening.catch((error: unknown) => error)
  await vi.waitFor(() => expect(mocked.spawn).toHaveBeenCalledTimes(2))
  guard.cancel()
  expect(await failed).toBe(guard.reason)
  expect(native.child.exitCode).toBe(0)
  expect(decoder.child.exitCode).toBe(0)
  expect(vi.getTimerCount()).toBe(0)
  detached()
})

it('stops the physical iPhone helper if decoder spawn throws', async () => {
  const native = processDouble()
  mocked.spawn.mockReturnValueOnce(native.child).mockImplementationOnce(() => {
    throw new Error('Decoder failed')
  })
  await expect(physicalDevice(phone)).rejects.toThrow('Decoder failed')
  expect(native.child.exitCode).toBe(0)
})

it.each([iosSimulator, androidSimulator, physicalDevice, physicalAndroid])(
  'rejects an already canceled construction before any preparation',
  async (construct) => {
    const guard = cancellation('aborted')
    guard.cancel()
    await expect(construct(ios, guard.authorize, guard.signal)).rejects.toBe(guard.reason)
    expect(mocked.mkdtemp).not.toHaveBeenCalled()
    expect(mocked.readdir).not.toHaveBeenCalled()
    expect(mocked.access).not.toHaveBeenCalled()
    expect(mocked.androidTool).not.toHaveBeenCalled()
    expect(mocked.spawn).not.toHaveBeenCalled()
    expect(mocked.execute).not.toHaveBeenCalled()
  },
)

it.each(['aborted', 'revoked'] as const)(
  'does not publish a key or open emulator RPC after endpoint configuration reading is %s',
  async (mode) => {
    const configuration = deferred<string>()
    mocked.readFile.mockReturnValue(configuration.promise)
    const guard = cancellation(mode)
    const opening = androidSimulator(android, guard.authorize, guard.signal)
    const failed = opening.catch((error: unknown) => error)
    await vi.waitFor(() => expect(mocked.readFile).toHaveBeenCalledOnce())
    guard.cancel()
    configuration.resolve('avd.name=Phone\nport.serial=5554\ngrpc.port=8554\ngrpc.token=secret')
    expect(await failed).toBe(guard.reason)
    expect(mocked.emulatorKey).not.toHaveBeenCalled()
    expect(mocked.rpc).not.toHaveBeenCalled()
    expect(mocked.execute).not.toHaveBeenCalled()
  },
)

async function sendPhysicalFrame(decoder: ReturnType<typeof processDouble>) {
  const jpeg = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#fff' } })
    .jpeg()
    .toBuffer()
  decoder.stdout.write(
    Buffer.concat([
      Buffer.from('--dovo-frame\r\nContent-Type: image/jpeg\r\n\r\n'),
      jpeg,
      Buffer.from('\r\n--dovo-frame\r\n'),
    ]),
  )
}

it('removes physical iPhone startup listeners on success and preserves ordinary close', async () => {
  const native = processDouble(),
    decoder = processDouble()
  mocked.spawn.mockReturnValueOnce(native.child).mockReturnValueOnce(decoder.child)
  const controller = new AbortController()
  const detached = listeners(controller.signal)
  const opening = physicalDevice(phone, undefined, controller.signal)
  await vi.waitFor(() => expect(mocked.spawn).toHaveBeenCalledTimes(2))
  native.stderr.write(JSON.stringify({ type: 'ready', device: 'qa' }) + '\n')
  await sendPhysicalFrame(decoder)
  const driver = await opening
  detached()
  controller.abort()
  expect(native.child.exitCode).toBeNull()
  expect(decoder.child.exitCode).toBeNull()
  await driver.close()
  expect(native.child.exitCode).toBe(0)
  expect(decoder.child.exitCode).toBe(0)
})

it('cleans up physical iPhone startup if authorization is revoked before the first frame', async () => {
  const native = processDouble(),
    decoder = processDouble()
  mocked.spawn.mockReturnValueOnce(native.child).mockReturnValueOnce(decoder.child)
  const guard = cancellation('revoked')
  const detached = listeners(guard.signal)
  const opening = physicalDevice(phone, guard.authorize, guard.signal)
  const failed = opening.catch((error: unknown) => error)
  await vi.waitFor(() => expect(mocked.spawn).toHaveBeenCalledTimes(2))
  native.stderr.write(JSON.stringify({ type: 'ready', device: 'qa' }) + '\n')
  guard.cancel()
  await sendPhysicalFrame(decoder)
  expect(await failed).toBe(guard.reason)
  expect(native.child.exitCode).toBe(0)
  expect(decoder.child.exitCode).toBe(0)
  detached()
})

it('preserves ordinary physical Android construction and close', async () => {
  const driver = await physicalAndroid(androidPhone)
  expect(driver.screenPoints?.()).toEqual({ width: 540, height: 1200 })
  await driver.close()
})
