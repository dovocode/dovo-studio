import { readFile, mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { harnessIconImages } from '../apps/mobile/src/agents/harness-icon-images.ts'
if (process.platform !== 'darwin')
  throw new Error('Build this UIKit harness on the authorized macOS Device Hub host.')
const root = fileURLToPath(new URL('../', import.meta.url))
const moduleRoot = join(root, 'apps/mobile/modules/dovo-composer-input')
const source = await readFile(join(moduleRoot, 'ios/DovoComposerInputModule.swift'), 'utf8')
const records = source
  .slice(
    source.indexOf('struct ComposerReferenceRecord'),
    source.indexOf('public class DovoComposerInputModule'),
  )
  .replaceAll(': Record', '')
  .replaceAll('@Field ', '')
const views = source.slice(source.indexOf('final class ReferenceAttachment'))
const harness = (await readFile(join(moduleRoot, 'tests/ios-harness.swift'), 'utf8')).replaceAll(
  '__HARNESS_ICON_PNG__',
  harnessIconImages.codex.png,
)
const work = await mkdtemp(join(tmpdir(), 'dovo-composer-reference-ios-'))
const app = join(work, 'DovoComposerReferenceQA.app')
await mkdir(app)
await writeFile(
  join(work, 'main.swift'),
  harness.replace('@main class', records + '\n' + views + '\n@main class'),
)
const sdk = execFileSync('xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-path'], {
  encoding: 'utf8',
}).trim()
execFileSync(
  'xcrun',
  [
    '--sdk',
    'iphonesimulator',
    'swiftc',
    '-parse-as-library',
    '-target',
    'arm64-apple-ios16.0-simulator',
    '-sdk',
    sdk,
    join(work, 'main.swift'),
    '-o',
    join(app, 'DovoComposerReferenceQA'),
  ],
  { stdio: 'inherit' },
)
await writeFile(
  join(app, 'Info.plist'),
  `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleExecutable</key><string>DovoComposerReferenceQA</string><key>CFBundleIdentifier</key><string>com.dovo.composer-reference-qa</string><key>CFBundleName</key><string>Composer QA</string><key>CFBundleVersion</key><string>1</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleSupportedPlatforms</key><array><string>iPhoneSimulator</string></array><key>DTPlatformName</key><string>iphonesimulator</string><key>MinimumOSVersion</key><string>16.0</string><key>LSRequiresIPhoneOS</key><true/><key>UILaunchScreen</key><dict/><key>UIApplicationSceneManifest</key><dict><key>UISceneConfigurations</key><dict><key>UIWindowSceneSessionRoleApplication</key><array><dict><key>UISceneConfigurationName</key><string>QA</string><key>UISceneDelegateClassName</key><string>HarnessScene</string></dict></array></dict></dict></dict></plist>`,
)
execFileSync('codesign', ['--force', '--sign', '-', app], { stdio: 'inherit' })
console.log(app)
