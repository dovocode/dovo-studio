import { open, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'

const machoMagic = new Set([
  'feedface',
  'cefaedfe',
  'feedfacf',
  'cffaedfe',
  'cafebabe',
  'bebafeca',
  'cafebabf',
  'bfbafeca',
])
export async function macSigningFiles(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await macSigningFiles(path)))
    else if (entry.isFile()) {
      const file = await open(path, 'r')
      try {
        const header = Buffer.alloc(4)
        const { bytesRead } = await file.read(header, 0, 4, 0)
        if (bytesRead === 4 && machoMagic.has(header.toString('hex'))) files.push(path)
      } finally {
        await file.close()
      }
    }
  }
  return files.sort((left, right) => left.localeCompare(right))
}

export function macInfoPlist(version) {
  if (!/^\d+\.\d+\.\d+(?:-nightly\.\d+)?$/.test(version))
    throw new Error('Invalid GPUI macOS version')
  const base = version.split('-')[0]
  const build = version.match(/-nightly\.(\d+)$/)?.[1]
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>dovo-desktop-gpui</string>
<key>CFBundleIdentifier</key><string>dev.dovo.studio.gpui</string>
<key>CFBundleName</key><string>Dovo Studio GPUI</string>
<key>CFBundleDisplayName</key><string>Dovo Studio GPUI</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>${base}</string>
<key>CFBundleVersion</key><string>${build || base}</string>
<key>CFBundleIconFile</key><string>dovo-gpui.icns</string>
<key>LSMinimumSystemVersion</key><string>13.0</string>
<key>LSApplicationCategoryType</key><string>public.app-category.developer-tools</string>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>
`
}

export async function signMacGpui({ root, app, stage, release }) {
  const env = process.env
  const required = [
    'CSC_LINK',
    'CSC_KEY_PASSWORD',
    'CSC_NAME',
    'APPLE_ID',
    'APPLE_APP_SPECIFIC_PASSWORD',
    'APPLE_TEAM_ID',
  ]
  if (release)
    for (const name of required) {
      if (!env[name]?.trim()) throw new Error(`Missing ${name} for signed GPUI release`)
    }
  const require = createRequire(join(root, 'package.json'))
  const builderRequire = createRequire(require.resolve('electron-builder'))
  const appRequire = createRequire(builderRequire.resolve('app-builder-lib'))
  const { createKeychain, removeKeychain } = builderRequire(
    'app-builder-lib/out/codeSign/macCodeSign.js',
  )
  const { TmpDir } = appRequire('temp-file')
  const temporary = new TmpDir('dovo-gpui-sign')
  let keychain
  try {
    if (release)
      keychain = await createKeychain({
        tmpDir: temporary,
        cscLink: env.CSC_LINK,
        cscKeyPassword: env.CSC_KEY_PASSWORD,
        currentDir: stage,
      })
    const identity = release ? env.CSC_NAME : '-'
    const entitlements = join(stage, 'node-entitlements.plist')
    await writeFile(
      entitlements,
      `<?xml version="1.0"?><plist version="1.0"><dict>
<key>com.apple.security.cs.allow-jit</key><true/>
<key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
<key>com.apple.security.cs.disable-library-validation</key><true/>
</dict></plist>`,
    )
    const args = [
      '--force',
      '--sign',
      identity,
      ...(release
        ? ['--timestamp', '--options', 'runtime', '--keychain', keychain.keychainFile]
        : []),
    ]
    // Sign actual Mach-O content, including extensionless PTY helpers and all native
    // Node modules, before sealing the bundle. Never follow symlinks out of the app.
    for (const file of await macSigningFiles(app)) {
      execFileSync(
        'codesign',
        [
          ...args,
          ...(file === join(app, 'Contents/Resources/libexec/node')
            ? ['--entitlements', entitlements]
            : []),
          file,
        ],
        { stdio: 'inherit' },
      )
    }
    execFileSync('codesign', [...args, app], { stdio: 'inherit' })
    execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' })
    if (release) {
      const { notarize } = appRequire('@electron/notarize')
      await notarize({
        appPath: app,
        appleId: env.APPLE_ID,
        appleIdPassword: env.APPLE_APP_SPECIFIC_PASSWORD,
        teamId: env.APPLE_TEAM_ID,
      })
      execFileSync('xcrun', ['stapler', 'validate', app], { stdio: 'inherit' })
      execFileSync('spctl', ['--assess', '--type', 'execute', app], { stdio: 'inherit' })
    }
  } finally {
    if (keychain) await removeKeychain(keychain.keychainFile)
    await temporary.cleanup()
  }
}
