import { afterEach, expect, it, vi } from 'vitest'
import { ChildProcess } from 'node:child_process'
import { PassThrough } from 'node:stream'
import sharp from 'sharp'
import { physicalDevice } from './physical-device'
import type { BrowserFrame } from './browser'

const mocked = vi.hoisted(() => ({ spawn: vi.fn<() => ChildProcess>() }))
vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof import('node:child_process')>()),
  spawn: mocked.spawn,
}))
function processDouble() {
  const child = new ChildProcess()
  const stdin = new PassThrough(),
    stdout = new PassThrough(),
    stderr = new PassThrough()
  Object.assign(child, { pid: 123, stdin, stdout, stderr })
  stdin.on('finish', () => {
    Object.defineProperty(child, 'exitCode', { value: 0 })
    child.emit('exit', 0, null)
  })
  return { child, stdin, stdout, stderr }
}
const device = {
  id: 'physical-ios:qa',
  runtime: 'qa',
  name: 'Phone',
  kind: 'physical' as const,
  platform: 'ios' as const,
  state: 'booted' as const,
}
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  mocked.spawn.mockReset()
})
function processes() {
  vi.stubEnv('DOVO_IOS_DEVICE_HELPER', '/fake/ios-device')
  const native = processDouble(),
    decoder = processDouble()
  mocked.spawn.mockReturnValueOnce(native.child).mockReturnValueOnce(decoder.child)
  return { native, decoder }
}
it.skipIf(process.platform !== 'darwin')(
  'waits for a decoded frame as well as the native handshake',
  async () => {
    const { native, decoder } = processes()
    let ready = false
    const opening = physicalDevice(device).then((value) => {
      ready = true
      return value
    })
    await vi.waitFor(() => expect(mocked.spawn).toHaveBeenCalledTimes(2))
    native.stderr.write(JSON.stringify({ type: 'ready', device: 'qa' }) + '\n')
    await new Promise((resolve) => setImmediate(resolve))
    expect(ready).toBe(false)
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
    const driver = await opening
    const frame = vi.fn<(frame: BrowserFrame) => void>()
    driver.start(frame, (error) => {
      throw error
    })
    expect(frame).toHaveBeenCalledWith(expect.objectContaining({ width: 2, height: 2 }))
    await driver.close()
  },
)
it.skipIf(process.platform !== 'darwin')(
  'cleans up both processes when the handshake succeeds but video never arrives',
  async () => {
    vi.useFakeTimers()
    const { native, decoder } = processes()
    const opening = physicalDevice(device)
    const failed = opening.catch((error: unknown) => error)
    await Promise.resolve()
    native.stderr.write(JSON.stringify({ type: 'ready', device: 'qa' }) + '\n')
    await vi.advanceTimersByTimeAsync(20000)
    expect(await failed).toMatchObject({
      message: expect.stringContaining('did not send a screen frame'),
    })
    expect(native.child.exitCode).toBe(0)
    expect(decoder.child.exitCode).toBe(0)
  },
)
