import { runtimeSmoke } from './runtime-smoke.mjs'
import { deploy } from './deploy.mjs'
import { stageWorkspace } from './stage-workspace.mjs'
import { desktopMiseArchive } from './desktop-mise-archive.mjs'
import { mkdtemp, cp, mkdir, readFile, writeFile, chmod, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { build, Platform, Arch } from 'electron-builder'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
if (
  !['darwin', 'linux', 'win32'].includes(process.platform) ||
  !['arm64', 'x64'].includes(process.arch) ||
  (process.platform === 'darwin' && process.arch !== 'arm64')
)
  throw new Error('Build natively on macOS arm64, Windows x64/arm64 or Linux x64/arm64.')
if (Number(process.versions.node.split('.')[0]) !== 24)
  throw new Error('Package with Node 24, matching the runtime native modules.')
const nodeName = process.platform === 'win32' ? 'node.exe' : 'node'
const platform =
  process.platform === 'darwin'
    ? Platform.MAC
    : process.platform === 'win32'
      ? Platform.WINDOWS
      : Platform.LINUX
const targets =
  process.platform === 'darwin'
    ? ['dmg', 'zip']
    : process.platform === 'win32'
      ? ['nsis']
      : ['deb', 'rpm', 'AppImage']
const stage = await mkdtemp(join(tmpdir(), 'dovo-package-'))
const require = createRequire(join(root, 'apps/desktop/package.json'))
const electron = JSON.parse(await readFile(require.resolve('electron/package.json'), 'utf8'))

try {
  const runtime = join(stage, 'runtime'),
    application = join(stage, 'application')
  const source = join(stage, 'source')
  await stageWorkspace(root, source)
  deploy(
    [
      '--config.allow-unused-patches=true',
      '--config.node-linker=hoisted',
      '--config.shared-workspace-lockfile=false',
      '--filter',
      '@dovo/api',
      'deploy',
      '--prod',
      '--legacy',
      runtime,
    ],
    source,
  )
  await mkdir(join(runtime, 'bin'))
  await cp(process.execPath, join(runtime, 'bin', nodeName))
  await chmod(join(runtime, 'bin', nodeName), 0o755)
  const runtimeRequire = createRequire(
    await realpath(join(runtime, 'node_modules/@dovo/runtime/package.json')),
  )
  const pty = dirname(runtimeRequire.resolve('node-pty/package.json'))
  if (process.platform === 'darwin')
    await chmod(join(pty, 'prebuilds/darwin-arm64/spawn-helper'), 0o755)
  // Verify the deployed dependency closure with its bundled Node, before making an installer.
  execFileSync(join(runtime, 'bin', nodeName), ['--input-type=module', '--eval', runtimeSmoke], {
    cwd: runtime,
    stdio: 'inherit',
  })
  // Deploy the desktop dependency closure too (notably electron-updater).
  deploy(
    [
      '--config.allow-unused-patches=true',
      '--config.node-linker=hoisted',
      '--config.shared-workspace-lockfile=false',
      '--filter',
      '@dovo/desktop',
      'deploy',
      '--prod',
      '--legacy',
      application,
    ],
    source,
  )
  await cp(join(root, 'apps/desktop/dist'), join(application, 'dist'), { recursive: true })
  await cp(join(root, 'apps/desktop/dist-electron'), join(application, 'dist-electron'), {
    recursive: true,
  })
  await writeFile(
    join(application, 'package.json'),
    JSON.stringify({
      name: 'dovo-studio',
      version: JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version,
      description: 'Personal agent workspace',
      author: { name: 'Dovocode', email: 'noreply@github.com' },
      homepage: 'https://github.com/dovocode/dovo-studio',
      license: 'UNLICENSED',
      type: 'module',
      main: 'dist-electron/main.js',
      dependencies: {
        'electron-updater': JSON.parse(
          await readFile(join(root, 'apps/desktop/package.json'), 'utf8'),
        ).dependencies['electron-updater'],
      },
    }),
  )
  if (process.argv.includes('--publish') && process.platform === 'darwin' && !process.env.CSC_NAME)
    throw new Error(
      'Publishing desktop updates requires a Developer ID signing identity (CSC_NAME).',
    )
  await build({
    publish: process.argv.includes('--publish') ? 'always' : 'never',
    targets: platform.createTarget(
      process.argv.includes('--dir') ? ['dir'] : targets,
      process.arch === 'arm64' ? Arch.arm64 : Arch.x64,
    ),
    config: {
      appId: 'com.dovo.studio',
      productName: 'Dovo Studio',
      electronVersion: electron.version,
      directories: { app: application, output: join(root, 'release') },
      files: ['dist/**/*', 'dist-electron/**/*', 'package.json'],
      afterPack: async (context) => {
        const destination = join(
          context.appOutDir,
          process.platform === 'darwin'
            ? 'Dovo Studio.app/Contents/Resources/runtime'
            : 'resources/runtime',
        )
        await cp(runtime, destination, {
          recursive: true,
          dereference: process.platform === 'win32',
          verbatimSymlinks: process.platform !== 'win32',
        })
        execFileSync(
          join(destination, 'bin', nodeName),
          ['--input-type=module', '--eval', runtimeSmoke],
          { cwd: destination, stdio: 'inherit' },
        )
      },
      npmRebuild: false,
      asar: true,
      publish: [
        {
          provider: 'github',
          owner: 'dovocode',
          repo: 'dovo-studio',
          releaseType: 'draft',
          channel:
            process.platform === 'win32' && process.arch === 'arm64' ? 'latest-arm64' : 'latest',
        },
      ],
      mac: {
        icon: join(root, 'apps/desktop/build/icon.icns'),
        category: 'public.app-category.developer-tools',
        identity: process.env.CSC_NAME?.replace(/^Developer ID Application:\s*/, '') ?? null,
        hardenedRuntime: true,
        notarize: !!(
          process.env.APPLE_API_KEY ||
          (process.env.APPLE_ID &&
            process.env.APPLE_APP_SPECIFIC_PASSWORD &&
            process.env.APPLE_TEAM_ID)
        ),
      },
      win: { icon: join(root, 'apps/desktop/build/icon.png') },
      nsis: {
        oneClick: false,
        allowToChangeInstallationDirectory: true,
        artifactName: 'Dovo-Studio-${version}-windows-${arch}.${ext}',
      },
      linux: {
        icon: join(root, 'apps/desktop/build/icon.png'),
        category: 'Development',
        executableName: 'dovo-studio',
        maintainer: 'Dovocode <noreply@github.com>',
        artifactName: 'Dovo-Studio-${version}-linux-${arch}.${ext}',
      },
      artifactName: 'Dovo-Studio-${version}-${arch}.${ext}',
    },
  })
  if (process.platform === 'darwin') await desktopMiseArchive(root)
} finally {
  // Windows may briefly retain file handles after the PTY child exits.
  await rm(stage, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
