import { afterEach, expect, it, vi } from 'vite-plus/test'
import type { ExecFileOptions } from 'node:child_process'
import * as files from 'node:fs/promises'
import { basename } from 'node:path'
import { previewDevices } from './devices'
import * as native from './simulator-native'

const command = vi.hoisted(() =>
  vi.fn<
    (
      file: string,
      args: string[],
      options: ExecFileOptions,
    ) => Promise<{ stdout: string; stderr: string }>
  >(),
)
vi.mock('node:child_process', async (original) => {
  const child = await original<typeof import('node:child_process')>()
  const { promisify } = await import('node:util')
  return { ...child, execFile: Object.assign(vi.fn(), { [promisify.custom]: command }) }
})
vi.mock('node:fs/promises', async (original) => {
  const files = await original<typeof import('node:fs/promises')>()
  return { ...files, access: vi.fn<typeof files.access>().mockResolvedValue(undefined) }
})
afterEach(() => {
  vi.restoreAllMocks()
  command.mockReset()
})
const physical = {
  result: {
    devices: [
      {
        identifier: 'phone',
        hardwareProperties: { reality: 'physical', platform: 'iOS', udid: 'phone' },
        deviceProperties: { name: 'Phone' },
        connectionProperties: { tunnelState: 'connected' },
      },
    ],
  },
}
async function respond(file: string, args: string[]) {
  let stdout = ''
  if (file === 'xcrun' && args[0] === 'devicectl') {
    await files.writeFile(args[args.indexOf('--json-output') + 1], JSON.stringify(physical))
  } else if (file === 'xcrun') {
    stdout = JSON.stringify({
      devices: { iOS: [{ udid: 'sim', name: 'Simulator', state: 'Booted', isAvailable: true }] },
    })
  } else if (basename(file) === 'emulator') {
    stdout = 'QA\nOther'
  } else if (args[0] === 'devices') {
    stdout =
      'List of devices attached\nemulator-5554 device\nemulator-5556 device\nusb device model:Pixel'
  } else if (args.includes('getprop')) {
    stdout = args[1] === 'emulator-5554' ? '1' : '0'
  } else if (args.includes('emu')) {
    stdout = args[1] === 'emulator-5554' ? 'QA\nOK' : 'Other\nOK'
  }
  return { stdout, stderr: '' }
}
function setup() {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
  vi.spyOn(native, 'emulatorEndpoint').mockResolvedValue({
    address: '127.0.0.1:4321',
    token: 'fixture',
  })
}

it('starts independent discovery sources together and preserves device readiness and ordering', async () => {
  setup()
  let release = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  command.mockImplementation(async (file, args) => {
    await gate
    return respond(file, args)
  })
  const pending = previewDevices()
  try {
    // None of these sources has completed; sequential discovery cannot reach five calls.
    await vi.waitFor(() => expect(command).toHaveBeenCalledTimes(5))
    release()
    const result = await pending
    expect(result.diagnostics).toEqual([])
    expect(result.devices.map(({ id, state }) => [id, state])).toEqual([
      ['physical-ios:phone', 'booted'],
      ['physical-android:usb', 'booted'],
      ['android:QA', 'booted'],
      ['ios:sim', 'booted'],
      ['android:Other', 'starting'],
    ])
    expect(native.emulatorEndpoint).toHaveBeenCalledTimes(1)
  } finally {
    release()
    await pending
  }
})

it('opening an iPhone skips simulator, Android and emulator discovery', async () => {
  setup()
  command.mockImplementation(respond)
  const result = await previewDevices('physical-ios:phone')
  expect(result.devices).toMatchObject([
    { id: 'physical-ios:phone', state: 'booted', liveSupported: true },
  ])
  expect(result.diagnostics).toEqual([])
  expect(command).toHaveBeenCalledTimes(1)
  expect(command.mock.calls[0].slice(0, 2)).toEqual([
    'xcrun',
    ['devicectl', 'list', 'devices', '--json-output', expect.any(String)],
  ])
  expect(native.emulatorEndpoint).not.toHaveBeenCalled()
})

it('keeps usable sources when an independent discovery command fails', async () => {
  setup()
  command.mockImplementation(async (file, args) => {
    if (file === 'xcrun' && args[0] === 'simctl') throw new Error('Xcode runtime missing')
    return respond(file, args)
  })
  const result = await previewDevices()
  expect(result.devices).toHaveLength(4)
  expect(result.diagnostics).toEqual([
    'iOS: install Xcode, select its developer directory and install a Simulator runtime.',
  ])
})
