import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const mobile = join(root, 'apps/mobile')
const args = process.argv.slice(2).filter((arg) => arg !== '--')
if (args.length !== 2 || args[0] !== '--platform' || !['ios', 'android'].includes(args[1]))
  throw new Error('Usage: DOVO_MOBILE_BUILD_NUMBER=1 pnpm mobile:package -- --platform ios|android')
const platform = args[1]
const buildNumber = process.env.DOVO_MOBILE_BUILD_NUMBER ?? ''
if (!/^[1-9][0-9]*$/.test(buildNumber) || Number(buildNumber) > 2_100_000_000)
  throw new Error('Set a unique positive DOVO_MOBILE_BUILD_NUMBER (at most 2100000000)')
const env = {
  ...process.env,
  DOVO_SOURCE_COMMIT: execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim(),
  DOVO_MOBILE_CHANNEL: process.env.DOVO_MOBILE_CHANNEL ?? 'nightly',
  DOVO_MOBILE_DISTRIBUTION: platform === 'android' ? '1' : '0',
  DOVO_APNS_ENVIRONMENT: 'production',
}
if (env.DOVO_PUSH_NOTIFICATIONS === '0')
  throw new Error('Store builds require push notification support')
if (platform === 'ios') {
  if (process.platform !== 'darwin') throw new Error('iOS archives require macOS and Xcode')
  if (!/^[A-Z0-9]{10}$/.test(env.DOVO_APPLE_TEAM_ID ?? ''))
    throw new Error('Set DOVO_APPLE_TEAM_ID to the existing Apple developer team')
} else {
  for (const key of [
    'DOVO_ANDROID_KEYSTORE',
    'DOVO_ANDROID_STORE_PASSWORD',
    'DOVO_ANDROID_KEY_ALIAS',
    'DOVO_ANDROID_KEY_PASSWORD',
    'DOVO_GOOGLE_SERVICES_FILE',
  ])
    if (!env[key]) throw new Error(`Set ${key} for the signed Android push build`)
  for (const key of ['DOVO_ANDROID_KEYSTORE', 'DOVO_GOOGLE_SERVICES_FILE'])
    if (!existsSync(env[key])) throw new Error(`${key} does not point to an existing private file`)
  const firebase = JSON.parse(readFileSync(env.DOVO_GOOGLE_SERVICES_FILE, 'utf8'))
  if (
    !firebase.client?.some(
      (client) => client.client_info?.android_client_info?.package_name === 'com.dovo.studio',
    )
  )
    throw new Error('Firebase configuration must contain Android application com.dovo.studio')
}
const version = JSON.parse(readFileSync(join(mobile, 'app.json'), 'utf8')).expo.version
const output = resolve(root, `work/mobile-store/${platform}-${version}-${buildNumber}`)
if (existsSync(output))
  throw new Error('This store build output already exists; choose a new build number')
mkdirSync(output, { recursive: true, mode: 0o700 })
const run = (command, values, cwd = root) =>
  execFileSync(command, values, { cwd, env, stdio: 'inherit' })
run('pnpm', [
  '--filter',
  '@dovo/design',
  '--filter',
  '@dovo/protocol',
  '--filter',
  '@dovo/client-runtime',
  '-r',
  'build',
])
run('pnpm', ['--filter', '@dovo/mobile', 'build'])
run('pnpm', ['exec', 'expo', 'prebuild', '--platform', platform, '--no-install'], mobile)
if (platform === 'ios') {
  if (env.DOVO_IOS_PROVISIONING_PROFILES) run(process.execPath, ['scripts/ci/ios-profiles.mjs'])
  run('pod', ['install'], join(mobile, 'ios'))
  const archive = join(output, 'DovoStudio.xcarchive')
  run(
    'xcodebuild',
    [
      '-workspace',
      'ios/DovoStudio.xcworkspace',
      '-scheme',
      'DovoStudio',
      '-configuration',
      'Release',
      '-sdk',
      'iphoneos',
      '-destination',
      'generic/platform=iOS',
      '-archivePath',
      archive,
      ...(env.DOVO_IOS_PROVISIONING_PROFILES ? [] : ['-allowProvisioningUpdates']),
      `DEVELOPMENT_TEAM=${env.DOVO_APPLE_TEAM_ID}`,
      'archive',
    ],
    mobile,
  )
  const options = join(output, 'ExportOptions.plist')
  const profiles = env.DOVO_IOS_PROVISIONING_PROFILES
    ? JSON.parse(env.DOVO_IOS_PROVISIONING_PROFILES)
    : null
  const signing = profiles
    ? `<key>signingStyle</key><string>manual</string><key>signingCertificate</key><string>Apple Distribution</string><key>provisioningProfiles</key><dict>${Object.entries(
        profiles,
      )
        .map(([id, uuid]) => `<key>${id}</key><string>${uuid}</string>`)
        .join('')}</dict>`
    : '<key>signingStyle</key><string>automatic</string>'
  writeFileSync(
    options,
    `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>method</key><string>app-store-connect</string><key>destination</key><string>export</string><key>teamID</key><string>${env.DOVO_APPLE_TEAM_ID}</string>${signing}<key>manageAppVersionAndBuildNumber</key><false/><key>uploadSymbols</key><true/></dict></plist>`,
  )
  run('xcodebuild', [
    '-exportArchive',
    '-archivePath',
    archive,
    '-exportPath',
    output,
    '-exportOptionsPlist',
    options,
    ...(profiles ? [] : ['-allowProvisioningUpdates']),
  ])
  if (!existsSync(join(output, 'DovoStudio.ipa')))
    throw new Error('Xcode did not export the expected IPA')
} else {
  run(
    process.platform === 'win32' ? 'gradlew.bat' : './gradlew',
    ['bundleRelease', '--no-daemon'],
    join(mobile, 'android'),
  )
  copyFileSync(
    join(mobile, 'android/app/build/outputs/bundle/release/app-release.aab'),
    join(output, 'DovoStudio.aab'),
  )
}
console.log(
  `Signed ${platform} store build exported to ${output}. Upload and testing-track submission are separate steps.`,
)
