import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Schema } from 'effect'
import { decode, mutableStruct, type PreviewDevice } from '@dovo/protocol'
import { androidTool } from './devices.js'
import { HttpError } from '../errors.js'
const exec = promisify(execFile)
const run = async (file: string, args: string[], signal?: AbortSignal, authorize?: () => void) => {
  authorize?.()
  signal?.throwIfAborted()
  return (
    await exec(file, args, {
      signal,
      timeout: 30000,
      maxBuffer: 12 * 1024 * 1024,
      windowsHide: true,
    })
  ).stdout.trim()
}
export function androidLaunchComponent(output: string) {
  const component = output
    .split('\n')
    .map((line) => line.trim())
    .find((line) => /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.$-]+$/.test(line))
  if (!component)
    throw new HttpError(
      409,
      'This app has no launchable activity. Install an app with a launcher activity first.',
    )
  return component
}
export async function deviceApps(
  device: PreviewDevice,
  signal?: AbortSignal,
  authorize?: () => void,
) {
  const command = (file: string, args: string[]) => run(file, args, signal, authorize)
  if (device.state !== 'booted') throw new HttpError(409, 'Start or connect this device first.')
  if (device.platform === 'android') {
    const packages = await command(await androidTool('adb'), [
      '-s',
      device.runtime,
      'shell',
      'pm',
      'list',
      'packages',
      '-3',
    ])
    return packages
      .split('\n')
      .flatMap((line) => {
        const match = /^package:([a-zA-Z0-9][a-zA-Z0-9_.-]*)$/.exec(line.trim())
        return match ? [{ name: match[1], bundleId: match[1] }] : []
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  }
  const directory = await mkdtemp(join(tmpdir(), 'dovo-device-apps-'))
  try {
    const file = join(directory, 'apps.plist')
    await writeFile(file, await command('xcrun', ['simctl', 'listapps', device.id.slice(4)]))
    const apps = decode(
      Schema.Record(
        Schema.String,
        mutableStruct({
          CFBundleDisplayName: Schema.optional(Schema.String),
          CFBundleName: Schema.optional(Schema.String),
        }),
      ),
      JSON.parse(await command('plutil', ['-convert', 'json', '-o', '-', file])),
    )
    return Object.entries(apps)
      .map(([bundleId, info]) => ({
        name: info.CFBundleDisplayName ?? info.CFBundleName ?? bundleId,
        bundleId,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
export async function launchDeviceApp(
  device: PreviewDevice,
  bundleId: string,
  relaunch: boolean,
  signal?: AbortSignal,
  authorize?: () => void,
) {
  const command = (file: string, args: string[]) => run(file, args, signal, authorize)
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(bundleId))
    throw new HttpError(400, 'Choose a valid app identifier.')
  if (device.state !== 'booted') throw new HttpError(409, 'Start or connect this device first.')
  if (device.platform === 'ios') {
    await command('xcrun', [
      'simctl',
      'launch',
      ...(relaunch ? ['--terminate-running-process'] : []),
      device.id.slice(4),
      bundleId,
    ])
  } else {
    const adb = await androidTool('adb'),
      target = ['-s', device.runtime, 'shell']
    const component = androidLaunchComponent(
      await command(adb, [
        ...target,
        'cmd',
        'package',
        'resolve-activity',
        '--brief',
        '--user',
        '0',
        bundleId,
      ]),
    )
    if (relaunch) await command(adb, [...target, 'am', 'force-stop', bundleId])
    const output = await command(adb, [...target, 'am', 'start', '-n', `'${component}'`])
    if (/^Error:/m.test(output))
      throw new HttpError(
        409,
        'Android could not launch this app. Check its launcher activity and installation.',
      )
  }
  return { ok: true as const }
}
