import { build, Platform, Arch } from 'electron-builder'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { releaseVariant } from './release-variant.mjs'
import { windowsReleaseConfig, windowsSigningOptions } from './windows-signing.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const [architecture, directory] = process.argv.slice(2)
if (process.platform !== 'win32' || process.arch !== 'x64')
  throw new Error('Create signed installers on Windows x64')
if (!['x64', 'arm64'].includes(architecture) || !directory)
  throw new Error('Usage: package-windows-signed.mjs <x64|arm64> <unpacked-directory>')
const variant = await releaseVariant(root)
const require = createRequire(join(root, 'apps/desktop/package.json'))
const electron = JSON.parse(await readFile(require.resolve('electron/package.json'), 'utf8'))
const signing = windowsSigningOptions()
const publish = {
  provider: 'github',
  owner: 'dovocode',
  repo: 'dovo-studio',
  releaseType: 'draft',
  channel: `${variant.nightly ? 'nightly' : 'latest'}${architecture === 'arm64' ? '-arm64' : ''}`,
}
const prepackaged = resolve(directory)
// --prepackaged skips afterPack, where electron-builder normally writes this file.
await writeFile(
  join(prepackaged, 'resources/app-update.yml'),
  JSON.stringify({
    ...publish,
    publisherName: [signing.publisherName],
    updaterCacheDirName: `${variant.nightly ? 'dovo-studio-nightly' : 'dovo-studio'}-updater`,
  }),
)
const project = await mkdtemp(join(tmpdir(), 'dovo-windows-installer-'))
try {
  await writeFile(
    join(project, 'package.json'),
    JSON.stringify({
      name: variant.nightly ? 'dovo-studio-nightly' : 'dovo-studio',
      version: variant.version,
      description: 'Personal agent workspace',
      author: 'Dovocode',
      main: 'index.js',
    }),
  )
  const config = windowsReleaseConfig(root, variant)
  await build({
    projectDir: project,
    prepackaged,
    publish: 'never',
    targets: Platform.WINDOWS.createTarget(
      ['nsis'],
      architecture === 'arm64' ? Arch.arm64 : Arch.x64,
    ),
    config: {
      ...config,
      appId: variant.appId,
      productName: variant.productName,
      electronVersion: electron.version,
      directories: { output: join(root, 'release') },
      forceCodeSigning: true,
      win: { ...config.win, azureSignOptions: signing },
      nsis: {
        ...config.nsis,
        include: join(root, 'scripts/packaging/windows-uninstaller.nsh'),
      },
      publish: [publish],
    },
  })
} finally {
  await rm(project, { recursive: true, force: true })
}
