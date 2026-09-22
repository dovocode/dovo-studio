import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import { hostname, homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { z } from 'zod'
import { previewUrl, type PreviewDevice, type previewActionSchema } from '@dovo/protocol'
import { HttpError } from '../errors.js'
const exec = promisify(execFile)
const run = async (file: string, args: string[]) =>
  (await exec(file, args, { timeout: 30000, maxBuffer: 12 * 1024 * 1024 })).stdout.trim()
const iosSchema = z.object({
  devices: z.record(
    z.string(),
    z.array(
      z.object({ udid: z.string(), name: z.string(), state: z.string(), isAvailable: z.boolean() }),
    ),
  ),
})
export function parseIosDevices(raw: string): PreviewDevice[] {
  return Object.entries(iosSchema.parse(JSON.parse(raw)).devices)
    .filter(([runtime]) => runtime.includes('iOS'))
    .flatMap(([runtime, devices]) =>
      devices
        .filter((d) => d.isAvailable)
        .map((d) => ({
          id: `ios:${d.udid}`,
          name: d.name,
          platform: 'ios' as const,
          state:
            d.state === 'Booted'
              ? ('booted' as const)
              : d.state === 'Shutdown'
                ? ('stopped' as const)
                : ('starting' as const),
          runtime,
        })),
    )
}
const physicalIosSchema = z.object({
  result: z.object({
    devices: z.array(
      z.object({
        identifier: z.string(),
        hardwareProperties: z
          .object({ reality: z.string(), platform: z.string(), udid: z.string() })
          .optional(),
        deviceProperties: z
          .object({ name: z.string(), osVersionNumber: z.string().optional() })
          .optional(),
        connectionProperties: z
          .object({ tunnelState: z.string(), pairingState: z.string().optional() })
          .optional(),
        properties: z
          .object({
            hardware: z.object({ reality: z.string(), platform: z.string(), udid: z.string() }),
            state: z.object({ name: z.string() }),
            connection: z.object({ state: z.string(), pairingState: z.string().optional() }),
            software: z
              .object({ osVersionNumber: z.object({ stringValue: z.string() }).optional() })
              .optional(),
          })
          .optional(),
      }),
    ),
  }),
})
export function parsePhysicalIosDevices(raw: string): PreviewDevice[] {
  return physicalIosSchema.parse(JSON.parse(raw)).result.devices.flatMap((device) => {
    const hardware = device.properties?.hardware ?? device.hardwareProperties
    if (hardware?.reality !== 'physical' || hardware.platform !== 'iOS') return []
    const state =
      device.properties?.connection.state ??
      device.connectionProperties?.tunnelState ??
      'disconnected'
    const paired =
      device.properties?.connection.pairingState ?? device.connectionProperties?.pairingState
    const connection = state === 'disconnected' && paired === 'paired' ? 'paired' : state
    return [
      {
        id: `physical-ios:${hardware.udid}`,
        kind: 'physical' as const,
        liveSupported: true,
        name: device.properties?.state.name ?? device.deviceProperties?.name ?? 'iPhone',
        platform: 'ios' as const,
        state: connection === 'connected' ? ('booted' as const) : ('stopped' as const),
        connection,
        runtime: hardware.udid,
      },
    ]
  })
}
export function parsePhysicalAndroidDevices(raw: string): PreviewDevice[] {
  return raw.split('\n').flatMap((line) => {
    const match = line.match(/^(\S+)\s+(device|offline|unauthorized)(?:\s+(.*))?$/)
    if (!match || match[1].startsWith('emulator-')) return []
    return [
      {
        id: `physical-android:${match[1]}`,
        kind: 'physical' as const,
        liveSupported: false,
        name: match[3]?.match(/model:(\S+)/)?.[1].replaceAll('_', ' ') ?? match[1],
        platform: 'android' as const,
        state: match[2] === 'device' ? ('booted' as const) : ('stopped' as const),
        connection: match[2] === 'device' ? 'connected' : match[2],
        runtime: match[1],
      },
    ]
  })
}
export async function androidTool(tool: 'adb' | 'emulator') {
  const defaultRoot = join(
    homedir(),
    process.platform === 'darwin' ? 'Library/Android/sdk' : 'Android/Sdk',
  )
  const root =
    process.env.ANDROID_HOME ||
    process.env.ANDROID_SDK_ROOT ||
    (process.platform === 'win32'
      ? join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'Android', 'Sdk')
      : join(homedir(), process.platform === 'darwin' ? 'Library/Android/sdk' : 'Android/Sdk'))
  const path = join(
    root,
    tool === 'adb' ? 'platform-tools' : 'emulator',
    process.platform === 'win32' ? `${tool}.exe` : tool,
  )
  try {
    await access(path)
    return path
  } catch {
    const fallback = join(
      defaultRoot,
      tool === 'adb' ? 'platform-tools' : 'emulator',
      process.platform === 'win32' ? `${tool}.exe` : tool,
    )
    try {
      await access(fallback)
      return fallback
    } catch {
      return tool
    }
  }
}
const launching = new Map<string, ChildProcess>()
const launchErrors = new Map<string, string>()
export async function previewDevices() {
  const devices: PreviewDevice[] = [],
    diagnostics: string[] = []
  if (process.platform === 'darwin') {
    try {
      devices.push(
        ...parseIosDevices(
          await run('xcrun', ['simctl', 'list', 'devices', 'available', '--json']),
        ),
      )
    } catch {
      diagnostics.push(
        'iOS: install Xcode, select its developer directory and install a Simulator runtime.',
      )
    }
    const directory = await mkdtemp(join(tmpdir(), 'dovo-devices-'))
    try {
      const output = join(directory, 'devices.json')
      await run('xcrun', ['devicectl', 'list', 'devices', '--json-output', output])
      devices.push(...parsePhysicalIosDevices(await readFile(output, 'utf8')))
    } catch {
      diagnostics.push(
        'Physical iPhones: connect and trust this Mac, enable Developer Mode, and use Xcode 15 or newer.',
      )
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  } else diagnostics.push('iOS simulators require a macOS runtime with Xcode.')
  try {
    devices.push(
      ...parsePhysicalAndroidDevices(await run(await androidTool('adb'), ['devices', '-l'])),
    )
  } catch {
    diagnostics.push('Physical Android devices: install Platform Tools and enable USB debugging.')
  }
  try {
    const emulator = await androidTool('emulator'),
      adb = await androidTool('adb')
    const names = (await run(emulator, ['-list-avds']))
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    const serials = (await run(adb, ['devices']))
      .split('\n')
      .flatMap((line) => line.match(/^(emulator-\d+)\s+device$/)?.[1] ?? [])
    const running = new Map<string, string>()
    for (const serial of serials) {
      const name = (await run(adb, ['-s', serial, 'emu', 'avd', 'name'])).split('\n')[0]?.trim()
      if (name) running.set(name, serial)
    }
    for (const name of names)
      devices.push({
        id: `android:${name}`,
        name,
        platform: 'android',
        state: running.has(name) ? 'booted' : launching.has(name) ? 'starting' : 'stopped',
        runtime: running.get(name) ?? 'Android emulator',
      })
  } catch {
    diagnostics.push(
      'Android: install SDK Platform Tools and Emulator, then create an AVD in Android Studio. Set ANDROID_HOME if needed.',
    )
  }
  const priority = { booted: 0, starting: 1, stopped: 2 }
  devices.sort(
    (a, b) =>
      Number(b.kind === 'physical') - Number(a.kind === 'physical') ||
      priority[a.state] - priority[b.state] ||
      a.name.localeCompare(b.name),
  )
  diagnostics.push(...launchErrors.values())
  return { host: hostname(), devices, diagnostics }
}
const pending = new Set<string>()
export async function previewDeviceAction(input: z.infer<typeof previewActionSchema>) {
  if (pending.has(input.id))
    throw new HttpError(409, 'This device already has an operation in progress.')
  pending.add(input.id)
  try {
    const device = (await previewDevices()).devices.find((d) => d.id === input.id)
    if (!device) throw new HttpError(404, 'Device is no longer available. Refresh the device list.')
    if (['devicehub', 'accessibility', 'screen-recording'].includes(input.action)) {
      if (process.platform !== 'darwin' || device.platform !== 'ios')
        throw new HttpError(409, 'Device Hub requires Xcode 27 on a Mac.')
      if (input.action === 'devicehub') {
        const tool = await run('xcrun', ['--find', 'devicectl'])
        await run('open', ['-a', resolve(tool, '../../../../Applications/DeviceHub.app')])
      } else
        await run('open', [
          input.action === 'accessibility'
            ? 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
            : 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
        ])
      return { ok: true as const }
    }
    if (device.kind === 'physical' && ['boot', 'shutdown'].includes(input.action))
      throw new HttpError(409, 'Start and stop are only available for simulators.')
    if (device.kind === 'physical' && device.platform === 'ios') {
      const native = ['devicectl', 'device']
      const target = ['--device', device.runtime, '--timeout', '15']
      if (input.action === 'apps') {
        const output = await run('xcrun', [
          ...native,
          'info',
          'apps',
          ...target,
          '--json-output',
          '-',
        ])
        const result = z
          .object({
            result: z.object({
              apps: z.array(z.object({ name: z.string(), bundleIdentifier: z.string() })),
            }),
          })
          .parse(JSON.parse(output))
        return {
          ok: true as const,
          apps: result.result.apps
            .map((app) => ({ name: app.name, bundleId: app.bundleIdentifier }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        }
      }
      if (['launch', 'relaunch', 'open'].includes(input.action)) {
        if (input.action !== 'open' && !input.bundleId)
          throw new HttpError(400, 'Select an app to launch.')
        await run('xcrun', [
          ...native,
          'process',
          'launch',
          ...target,
          ...(input.action === 'relaunch' ? ['--terminate-existing'] : []),
          ...(input.action === 'open' ? ['--payload-url', previewUrl(input.url ?? '')] : []),
          input.action === 'open' ? 'com.apple.mobilesafari' : input.bundleId!,
        ])
        return { ok: true as const }
      }
      if (['portrait', 'landscape'].includes(input.action)) {
        await run('xcrun', [
          ...native,
          'orientation',
          'set',
          ...target,
          input.action === 'portrait' ? 'portrait' : 'landscapeLeft',
        ])
        return { ok: true as const }
      }
      if (['light', 'dark'].includes(input.action)) {
        await run('xcrun', [...native, 'settings', 'appearance', ...target, '--mode', input.action])
        return { ok: true as const }
      }

      if (input.action !== 'screenshot')
        throw new HttpError(409, 'Open this phone with Device Hub to interact with it.')
      const directory = await mkdtemp(join(tmpdir(), 'dovo-phone-'))
      try {
        const file = join(directory, 'screen.png')
        await run('xcrun', [
          'devicectl',
          'device',
          'capture',
          'screenshot',
          '--device',
          device.runtime,
          '--destination',
          file,
        ])
        return {
          ok: true as const,
          image: `data:image/png;base64,${(await readFile(file)).toString('base64')}`,
        }
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    }
    if (
      ['apps', 'launch', 'relaunch', 'portrait', 'landscape', 'light', 'dark'].includes(
        input.action,
      )
    )
      throw new HttpError(409, 'These controls require a physical iPhone or iPad.')
    const id = input.id.slice(input.id.indexOf(':') + 1)
    if (input.action === 'boot' && device.state !== 'stopped') return { ok: true as const }
    if (input.action !== 'boot' && device.state !== 'booted')
      throw new HttpError(409, 'Start the device and wait until it is ready.')
    if (device.platform === 'ios') {
      if (input.action === 'boot') await run('xcrun', ['simctl', 'boot', id])
      if (input.action === 'shutdown') await run('xcrun', ['simctl', 'shutdown', id])
      if (input.action === 'open')
        await run('xcrun', ['simctl', 'openurl', id, previewUrl(input.url ?? '')])
      if (input.action === 'screenshot') {
        const dir = await mkdtemp(join(tmpdir(), 'dovo-preview-'))
        try {
          const file = join(dir, 'screen.png')
          await run('xcrun', ['simctl', 'io', id, 'screenshot', file])
          return {
            ok: true as const,
            image: `data:image/png;base64,${(await readFile(file)).toString('base64')}`,
          }
        } finally {
          await rm(dir, { recursive: true, force: true })
        }
      }
    } else {
      const adb = await androidTool('adb')
      if (input.action === 'boot') {
        const emulator = await androidTool('emulator')
        await new Promise<void>((resolve, reject) => {
          const child = spawn(emulator, ['-avd', id, '-grpc-use-token'], {
            detached: true,
            stdio: 'ignore',
          })
          launchErrors.delete(id)
          launching.set(id, child)
          child.once('exit', (code) => {
            launching.delete(id)
            if (code)
              launchErrors.set(
                id,
                `${device.name}: emulator exited with code ${code}. Start it in Android Studio to inspect its diagnostics.`,
              )
          })
          child.once('error', (error) => {
            launching.delete(id)
            reject(error)
          })
          child.once('spawn', () => {
            child.unref()
            resolve()
          })
        })
      }
      if (input.action === 'shutdown') await run(adb, ['-s', device.runtime, 'emu', 'kill'])
      if (input.action === 'open') {
        const url = new URL(previewUrl(input.url ?? ''))
        if (
          device.kind !== 'physical' &&
          ['localhost', '127.0.0.1', '0.0.0.0', '[::1]'].includes(url.hostname)
        )
          url.hostname = '10.0.2.2'
        // adb shell joins arguments into a remote shell command. Quote the URL there too.
        await run(adb, [
          '-s',
          device.runtime,
          'shell',
          'am',
          'start',
          '-a',
          'android.intent.action.VIEW',
          '-d',
          `'${url.href.replaceAll("'", "'\\''")}'`,
        ])
      }
      if (input.action === 'screenshot') {
        const { stdout } = await exec(adb, ['-s', device.runtime, 'exec-out', 'screencap', '-p'], {
          encoding: 'buffer',
          timeout: 30000,
          maxBuffer: 12 * 1024 * 1024,
        })
        return { ok: true as const, image: `data:image/png;base64,${stdout.toString('base64')}` }
      }
    }
    return { ok: true as const }
  } finally {
    pending.delete(input.id)
  }
}
