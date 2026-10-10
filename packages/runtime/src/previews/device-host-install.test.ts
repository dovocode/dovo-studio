import { afterEach, expect, it, vi } from 'vite-plus/test'
import { mkdtemp, mkdir, writeFile, stat, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
const commands = vi.hoisted(() => ({
  run: vi.fn<
    (file: string, args: string[], options: unknown) => Promise<{ stdout: string; stderr: string }>
  >(),
}))
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return {
    ...actual,
    execFile: Object.assign(vi.fn(), {
      [Symbol.for('nodejs.util.promisify.custom')]: commands.run,
    }),
  }
})
import { installNative, DeviceHostUploads } from './device-host-install'
import * as discovery from './devices'
afterEach(() => {
  vi.restoreAllMocks()
  commands.run.mockReset()
})
it('installs Android APKs with known adb arguments and cleans owned staging after install', async () => {
  vi.spyOn(discovery, 'previewDevices').mockResolvedValue({
    host: 'android',
    diagnostics: [],
    devices: [
      {
        id: 'physical-android:serial',
        name: 'Android',
        kind: 'physical',
        platform: 'android',
        state: 'booted',
        runtime: 'serial',
      },
    ],
  })
  vi.spyOn(discovery, 'androidTool').mockResolvedValue('adb')
  commands.run.mockResolvedValue({ stdout: 'Success', stderr: '' })
  const uploads = new DeviceHostUploads()
  try {
    const upload = await uploads.create('paired:task', '.apk')
    await writeFile(upload.path, 'apk')
    await expect(
      uploads.install(upload.id, 'other:task', 'physical-android:serial'),
    ).rejects.toThrow('another paired device')
    expect(commands.run).not.toHaveBeenCalled()
    await expect(
      uploads.install(upload.id, 'paired:task', 'physical-android:serial'),
    ).resolves.toEqual({ ok: true })
    expect(commands.run).toHaveBeenCalledWith(
      'adb',
      ['-s', 'serial', 'install', '-r', upload.path],
      expect.objectContaining({ timeout: 120000 }),
    )
    await expect(stat(upload.path)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(installNative('physical-android:serial', '/tmp/wrong.app')).rejects.toThrow('.apk')
  } finally {
    await uploads.dispose()
  }
})
it('checks iOS build platform and physical signing before known devicectl/simctl installation commands', async () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
  vi.spyOn(discovery, 'previewDevices').mockResolvedValue({
    host: 'mac',
    diagnostics: [],
    devices: [
      { id: 'ios:uuid', name: 'Simulator', platform: 'ios', state: 'booted', runtime: 'iOS' },
      {
        id: 'physical-ios:phone',
        name: 'iPhone',
        kind: 'physical',
        platform: 'ios',
        state: 'booted',
        runtime: 'phone',
      },
    ],
  })
  const root = await mkdtemp(join(tmpdir(), 'dovo-ios-install-test-'))
  const app = join(root, 'Test.app')
  await mkdir(app)
  try {
    commands.run.mockResolvedValue({
      stdout: JSON.stringify({ CFBundleSupportedPlatforms: ['iPhoneSimulator'] }),
      stderr: '',
    })
    await expect(installNative('physical-ios:phone', app)).rejects.toThrow('iPhoneOS')
    expect(commands.run.mock.calls.every(([, args]) => args[0] === '-convert')).toBe(true)
    await expect(installNative('ios:uuid', app)).resolves.toEqual({ ok: true })
    expect(commands.run).toHaveBeenCalledWith(
      'xcrun',
      ['simctl', 'install', 'uuid', app],
      expect.anything(),
    )
    commands.run.mockResolvedValue({
      stdout: JSON.stringify({ CFBundleSupportedPlatforms: ['iPhoneOS'] }),
      stderr: '',
    })
    await expect(installNative('physical-ios:phone', app)).rejects.toThrow('signed .app')
    await writeFile(join(app, 'embedded.mobileprovision'), 'profile')
    await expect(installNative('physical-ios:phone', app)).resolves.toEqual({ ok: true })
    expect(commands.run).toHaveBeenCalledWith(
      'codesign',
      ['--verify', '--deep', '--strict', app],
      expect.anything(),
    )
    expect(commands.run).toHaveBeenCalledWith(
      'xcrun',
      ['devicectl', 'device', 'install', 'app', '--device', 'phone', app],
      expect.anything(),
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('reserves all upload slots before creating staging directories', async () => {
  const uploads = new DeviceHostUploads()
  try {
    const results = await Promise.allSettled(
      Array.from({ length: 21 }, () => uploads.create('owner', '.apk')),
    )
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(20)
    expect(results[20]).toMatchObject({
      status: 'rejected',
      reason: expect.objectContaining({ message: 'Too many staged device artifacts' }),
    })
  } finally {
    await uploads.dispose()
  }
})

it('aborts destination native installs when the hub is disabled or their device is revoked', async () => {
  vi.spyOn(discovery, 'previewDevices').mockResolvedValue({
    host: 'B',
    diagnostics: [],
    devices: [
      {
        id: 'physical-android:serial',
        name: 'Phone',
        kind: 'physical',
        platform: 'android',
        state: 'booted',
        runtime: 'serial',
      },
    ],
  })
  vi.spyOn(discovery, 'androidTool').mockResolvedValue('adb')
  const uploads = new DeviceHostUploads()
  commands.run.mockImplementation(async (_file, _args, options) => {
    if (
      !options ||
      typeof options !== 'object' ||
      !('signal' in options) ||
      !(options.signal instanceof AbortSignal)
    )
      throw new Error('Missing cancellation signal')
    const signal = options.signal
    await new Promise<void>((_resolve, reject) =>
      signal.addEventListener('abort', () => reject(new Error('Native install cancelled')), {
        once: true,
      }),
    )
    return { stdout: '', stderr: '' }
  })
  try {
    for (const revoke of [false, true]) {
      const upload = await uploads.create('device-host:["paired","task"]', '.apk')
      await writeFile(upload.path, 'apk')
      const outcome = uploads
        .install(upload.id, 'device-host:["paired","task"]', 'physical-android:serial')
        .catch((error: unknown) => error)
      await vi.waitFor(() => expect(commands.run).toHaveBeenCalledTimes(revoke ? 2 : 1))
      if (revoke) uploads.cancelDevice('paired')
      else uploads.cancelAll()
      expect(await outcome).toMatchObject({
        message: 'App installation was cancelled by device cleanup',
      })
      await expect(stat(upload.path)).rejects.toMatchObject({ code: 'ENOENT' })
    }
  } finally {
    await uploads.dispose()
  }
})
