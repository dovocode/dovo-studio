import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

// This creates and deletes its own disposable simulator. Never point fixture flows at a user's phone.
if (process.platform !== 'darwin')
  throw new Error('Native iOS smoke requires a macOS host with Xcode')
const root = resolve(import.meta.dirname, '../..'),
  mobile = resolve(root, 'apps/mobile')
const run = (command, args, cwd = root) =>
  execFileSync(command, args, { cwd, env: process.env, stdio: 'inherit' })
const xcrun = (...args) => execFileSync('xcrun', args, { encoding: 'utf8' }).trim()
run('xcodebuild', ['-checkFirstLaunchStatus'])
const runtimes = JSON.parse(xcrun('simctl', 'list', 'runtimes', '--json')).runtimes
const runtime = runtimes
  .filter((item) => item.isAvailable && item.identifier.includes('.iOS-'))
  .sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }))[0]
if (!runtime) throw new Error('No available iOS simulator runtime')
const types = runtime.supportedDeviceTypes ?? []
const type =
  types.find((item) => /^iPhone \d+$/.test(item.name)) ??
  types.find((item) => item.productFamily === 'iPhone')
if (!type) throw new Error('No compatible iPhone simulator type')
const device = xcrun(
  'simctl',
  'create',
  `Dovo smoke ${process.env.GITHUB_RUN_ID ?? Date.now()}`,
  type.identifier,
  runtime.identifier,
)
try {
  run('xcrun', ['simctl', 'boot', device])
  run('xcrun', ['simctl', 'bootstatus', device, '-b'])
  run('pnpm', ['--filter', '@dovo/runtime...', '--filter', '@dovo/mobile...', '-r', 'build'])
  run('pnpm', ['exec', 'expo', 'prebuild', '--platform', 'ios', '--no-install'], mobile)
  run('pod', ['install'], resolve(mobile, 'ios'))
  const derived = resolve(root, 'work/mobile-smoke-build')
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
      `id=${device}`,
      '-derivedDataPath',
      derived,
      'CODE_SIGNING_ALLOWED=YES',
      'CODE_SIGN_IDENTITY=-',
      'ONLY_ACTIVE_ARCH=YES',
      'build',
    ],
    mobile,
  )
  run('xcrun', [
    'simctl',
    'install',
    device,
    resolve(derived, 'Build/Products/Release-iphonesimulator/DovoStudio.app'),
  ])
  run('xcrun', ['simctl', 'launch', device, 'com.dovo.studio'])
  run(process.execPath, ['scripts/verify-mobile.mjs', device, '--release-smoke'])
} catch (error) {
  mkdirSync(resolve(root, 'work/mobile-native-smoke'), { recursive: true })
  try {
    run('xcrun', [
      'simctl',
      'io',
      device,
      'screenshot',
      resolve(root, 'work/mobile-native-smoke/failure.png'),
    ])
  } catch (cause) {
    console.error(cause)
  }
  throw error
} finally {
  try {
    run('xcrun', ['simctl', 'shutdown', device])
  } finally {
    run('xcrun', ['simctl', 'delete', device])
  }
}
