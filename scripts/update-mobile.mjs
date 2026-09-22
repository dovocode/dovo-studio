import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
if (process.platform !== 'darwin') throw new Error('Local iPhone builds require macOS and Xcode.')
const args = process.argv.slice(2).filter((arg) => arg !== '--')
const index = args.indexOf('--device')
const device = index >= 0 ? args[index + 1] : undefined
if (!device || device.startsWith('--'))
  throw new Error(
    'Usage: pnpm mobile:update -- --device <UDID>. Find IDs with: xcrun devicectl list devices',
  )
if (args.length !== 2 || index !== 0) throw new Error('Only --device <UDID> is supported.')
const run = (command, args, cwd = root) => execFileSync(command, args, { cwd, stdio: 'inherit' })
const mobile = join(root, 'apps/mobile')
const temporary = mkdtempSync(join(tmpdir(), 'dovo-ios-update-'))
try {
  const listing = join(temporary, 'devices.json')
  run('xcrun', ['devicectl', 'list', 'devices', '--json-output', listing])
  const devices = JSON.parse(readFileSync(listing, 'utf8')).result?.devices ?? []
  const target = devices.find(
    (item) => item.identifier === device || item.hardwareProperties?.udid === device,
  )
  if (!target)
    throw new Error('The requested iPhone is unavailable. Connect and unlock it, then try again.')
  run('pnpm', ['--filter', '@dovo/protocol', '--filter', '@dovo/client-runtime', '-r', 'build'])
  run('pnpm', ['--filter', '@dovo/mobile', 'build'])
  // CNG regenerates the widget extension and its capabilities; CocoaPods installs native dependencies.
  run('pnpm', ['exec', 'expo', 'prebuild', '--platform', 'ios', '--no-install'], mobile)
  run('pod', ['install'], join(mobile, 'ios'))
  const build = resolve(root, 'work/mobile-update-build')
  run(
    'xcodebuild',
    [
      '-workspace',
      'ios/DovoStudio.xcworkspace',
      '-scheme',
      'DovoStudio',
      '-configuration',
      'Release',
      '-destination',
      `id=${target.hardwareProperties?.udid ?? device}`,
      '-derivedDataPath',
      build,
      '-allowProvisioningUpdates',
      ...(process.env.DOVO_APPLE_TEAM_ID
        ? [`DEVELOPMENT_TEAM=${process.env.DOVO_APPLE_TEAM_ID}`]
        : []),
      'build',
    ],
    mobile,
  )
  const application = join(build, 'Build/Products/Release-iphoneos/DovoStudio.app')
  if (!existsSync(application)) throw new Error('Xcode finished without the expected iPhone app.')
  run('xcrun', [
    'devicectl',
    'device',
    'install',
    'app',
    '--device',
    target.identifier,
    application,
  ])
  console.log('Dovo Studio updated. Pairing and app data were preserved.')
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
