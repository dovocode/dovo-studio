import { execFileSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
if (process.platform !== 'darwin') throw new Error('Local iPhone builds require macOS and Xcode.')
const env = {
  ...process.env,
  DOVO_SOURCE_COMMIT: execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim(),
}
const run = (command, args, cwd = root) =>
  execFileSync(command, args, { cwd, env, stdio: 'inherit' })
const mobile = join(root, 'apps/mobile')

// Build metadata can survive copied/restored checkouts with stale dist files.
// Always emit the workspace dependencies used by the release bundle.
for (const name of ['durable-connections', 'protocol', 'client-runtime'])
  rmSync(join(root, 'packages', name, 'tsconfig.build.tsbuildinfo'), { force: true })
run('pnpm', [
  '--filter',
  '@dovo/design',
  '--filter',
  '@dovo/durable-connections',
  '--filter',
  '@dovo/protocol',
  '--filter',
  '@dovo/client-runtime',
  '-r',
  'build',
])
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
    'generic/platform=iOS',
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
console.log(`Signed iPhone app ready: ${application}`)
