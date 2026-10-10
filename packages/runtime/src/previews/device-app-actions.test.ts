import { afterEach, expect, it, vi } from 'vite-plus/test'
const commands = vi.hoisted(() => ({
  run: vi.fn<
    (file: string, args: string[], options: unknown) => Promise<{ stdout: string; stderr: string }>
  >(),
}))
vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof import('node:child_process')>()),
  execFile: Object.assign(vi.fn(), { [Symbol.for('nodejs.util.promisify.custom')]: commands.run }),
}))
import { androidLaunchComponent, deviceApps, launchDeviceApp } from './device-app-actions'
import * as devices from './devices'
afterEach(() => {
  vi.restoreAllMocks()
  commands.run.mockReset()
})
it('extracts Android launcher components without accepting shell text or diagnostic lines', () => {
  expect(
    androidLaunchComponent('priority=0 preferredOrder=0\ncom.example_app.app/.MainActivity\n'),
  ).toBe('com.example_app.app/.MainActivity')
  expect(androidLaunchComponent('com.example_app.app/com.example_app.Main$Activity')).toBe(
    'com.example_app.app/com.example_app.Main$Activity',
  )
  for (const value of [
    'No activity found',
    'com.example_app/app;cat /etc/passwd',
    'com.example_app/$(command)',
    "com.example_app/app'",
  ]) {
    expect(() => androidLaunchComponent(value)).toThrow('no launchable activity')
  }
})

it('launches and relaunches Android apps with validated and shell-quoted components', async () => {
  vi.spyOn(devices, 'androidTool').mockResolvedValue('adb')
  const device = {
    id: 'physical-android:serial',
    kind: 'physical' as const,
    name: 'Phone',
    platform: 'android' as const,
    state: 'booted' as const,
    runtime: 'serial',
  }
  commands.run
    .mockResolvedValueOnce({ stdout: 'com.example_app/com.example_app.Main$Activity', stderr: '' })
    .mockResolvedValue({ stdout: 'Starting app', stderr: '' })
  await launchDeviceApp(device, 'com.example_app', true)
  expect(commands.run).toHaveBeenNthCalledWith(
    1,
    'adb',
    [
      '-s',
      'serial',
      'shell',
      'cmd',
      'package',
      'resolve-activity',
      '--brief',
      '--user',
      '0',
      'com.example_app',
    ],
    expect.anything(),
  )
  expect(commands.run).toHaveBeenNthCalledWith(
    2,
    'adb',
    ['-s', 'serial', 'shell', 'am', 'force-stop', 'com.example_app'],
    expect.anything(),
  )
  expect(commands.run).toHaveBeenNthCalledWith(
    3,
    'adb',
    [
      '-s',
      'serial',
      'shell',
      'am',
      'start',
      '-n',
      "'com.example_app/com.example_app.Main$Activity'",
    ],
    expect.anything(),
  )
  await expect(launchDeviceApp(device, 'app;command', false)).rejects.toThrow(
    'valid app identifier',
  )
  expect(commands.run).toHaveBeenCalledTimes(3)
})
it('launches an iOS simulator app with the native terminate-existing option', async () => {
  commands.run.mockResolvedValue({ stdout: 'com.example_app: 1', stderr: '' })
  await launchDeviceApp(
    { id: 'ios:device', name: 'iPhone', platform: 'ios', state: 'booted', runtime: 'iOS' },
    'com.example_app',
    true,
  )
  expect(commands.run).toHaveBeenCalledWith(
    'xcrun',
    ['simctl', 'launch', '--terminate-running-process', 'device', 'com.example_app'],
    expect.anything(),
  )
})
it('lists Android app IDs and rejects diagnostic lines', async () => {
  vi.spyOn(devices, 'androidTool').mockResolvedValue('adb')
  commands.run.mockResolvedValue({
    stdout: 'package:com.example_app\nerror: bad\npackage:com.other\n',
    stderr: '',
  })
  expect(
    await deviceApps({
      id: 'android:avd',
      name: 'Android',
      platform: 'android',
      state: 'booted',
      runtime: 'emulator-5554',
    }),
  ).toEqual([
    { name: 'com.example_app', bundleId: 'com.example_app' },
    { name: 'com.other', bundleId: 'com.other' },
  ])
})
