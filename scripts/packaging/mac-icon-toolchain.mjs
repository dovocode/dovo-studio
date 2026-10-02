import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export function verifyMacIconToolchain() {
  const output = execFileSync('xcrun', ['actool', '--version'], { encoding: 'utf8' })
  const version = output.match(/<key>short-bundle-version<\/key>\s*<string>([^<]+)<\/string>/)?.[1]
  if (!version || Number(version.split('.')[0]) < 26)
    throw new Error(
      `Native macOS icons require Xcode 26 or newer; selected actool is ${version ?? 'unknown'}. Set DEVELOPER_DIR to a supported Xcode installation.`,
    )
  const osVersion = execFileSync('sw_vers', ['-productVersion'], { encoding: 'utf8' }).trim()
  console.log(`Native macOS icon toolchain: actool ${version} on macOS ${osVersion}`)
  // --version never starts AssetCatalogAgent, which can crash with mismatched host frameworks.
  // Exercise the same Icon Composer compilation as electron-builder before staging/signing.
  const temporary = mkdtempSync(join(tmpdir(), 'dovo-icon-preflight-'))
  try {
    const icon = join(temporary, 'Icon.icon'),
      compiled = join(temporary, 'out')
    cpSync(fileURLToPath(new URL('../../apps/desktop/build/Dovo.icon', import.meta.url)), icon, {
      recursive: true,
    })
    mkdirSync(compiled)
    execFileSync(
      'xcrun',
      [
        'actool',
        icon,
        '--compile',
        compiled,
        '--output-format',
        'human-readable-text',
        '--notices',
        '--warnings',
        '--output-partial-info-plist',
        join(compiled, 'Info.plist'),
        '--app-icon',
        'Icon',
        '--include-all-app-icons',
        '--accent-color',
        'AccentColor',
        '--enable-on-demand-resources',
        'NO',
        '--development-region',
        'en',
        '--target-device',
        'mac',
        '--minimum-deployment-target',
        '26.0',
        '--platform',
        'macosx',
      ],
      { stdio: 'inherit', timeout: 120_000 },
    )
    for (const name of ['Assets.car', 'Icon.icns'])
      if (!statSync(join(compiled, name)).size)
        throw new Error(`Icon preflight produced an empty ${name}.`)
    console.log('Native macOS icon compilation verified (Assets.car and Icon.icns).')
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  verifyMacIconToolchain()
