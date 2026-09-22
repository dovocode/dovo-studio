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
if (process.platform !== 'darwin' || process.arch !== 'arm64')
  throw new Error(
    'This release target is macOS Apple Silicon. Build on an arm64 Mac to include matching native modules.',
  )
if (Number(process.versions.node.split('.')[0]) !== 24)
  throw new Error('Package with Node 24, matching the runtime native modules.')
const stage = await mkdtemp(join(tmpdir(), 'dovo-package-'))
const require = createRequire(join(root, 'apps/desktop/package.json'))
const electron = JSON.parse(await readFile(require.resolve('electron/package.json'), 'utf8'))
try {
  const runtime = join(stage, 'runtime'),
    application = join(stage, 'application')
  const source = join(stage, 'source')
  await stageWorkspace(root, source)
  execFileSync(
    'pnpm',
    [
      '--config.allow-unused-patches=true',
      '--filter',
      '@dovo/api',
      'deploy',
      '--prod',
      '--legacy',
      runtime,
    ],
    {
      cwd: source,
      stdio: 'inherit',
    },
  )
  await mkdir(join(runtime, 'bin'))
  await cp(process.execPath, join(runtime, 'bin/node'))
  await chmod(join(runtime, 'bin/node'), 0o755)
  const runtimeRequire = createRequire(
    await realpath(join(runtime, 'node_modules/@dovo/runtime/package.json')),
  )
  const pty = dirname(runtimeRequire.resolve('node-pty/package.json'))
  await chmod(join(pty, 'prebuilds/darwin-arm64/spawn-helper'), 0o755)
  // Verify the deployed dependency closure with its bundled Node, before making an installer.
  execFileSync(
    join(runtime, 'bin/node'),
    [
      '--input-type=module',
      '--eval',
      "import {startRuntime} from '@dovo/runtime'; const r=await startRuntime({databasePath:':memory:',ownerToken:'packaging-check-token-at-least-32-characters',port:0}); const t=r.services.terminals.create('check',process.cwd()); r.services.terminals.close(t.id); await r.close();",
    ],
    { cwd: runtime, stdio: 'inherit' },
  )
  // Deploy the desktop dependency closure too (notably electron-updater).
  execFileSync(
    'pnpm',
    [
      '--config.allow-unused-patches=true',
      '--filter',
      '@dovo/desktop',
      'deploy',
      '--prod',
      '--legacy',
      application,
    ],
    { cwd: source, stdio: 'inherit' },
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
      author: 'Dovo',
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
  if (process.argv.includes('--publish') && !process.env.CSC_NAME)
    throw new Error(
      'Publishing desktop updates requires a Developer ID signing identity (CSC_NAME).',
    )
  await build({
    publish: process.argv.includes('--publish') ? 'always' : 'never',
    targets: Platform.MAC.createTarget(
      process.argv.includes('--dir') ? ['dir'] : ['dmg', 'zip'],
      Arch.arm64,
    ),
    config: {
      appId: 'com.dovo.studio',
      productName: 'Dovo Studio',
      electronVersion: electron.version,
      directories: { app: application, output: join(root, 'release') },
      files: ['dist/**/*', 'dist-electron/**/*', 'package.json'],
      afterPack: async (context) => {
        const destination = join(context.appOutDir, 'Dovo Studio.app/Contents/Resources/runtime')
        await cp(runtime, destination, { recursive: true, verbatimSymlinks: true })
        execFileSync(
          join(destination, 'bin/node'),
          [
            '--input-type=module',
            '--eval',
            "import {startRuntime} from '@dovo/runtime'; const r=await startRuntime({databasePath:':memory:',ownerToken:'packaging-check-token-at-least-32-characters',port:0}); const t=r.services.terminals.create('check',process.cwd()); r.services.terminals.close(t.id); await r.close();",
          ],
          { cwd: destination, stdio: 'inherit' },
        )
      },
      npmRebuild: false,
      asar: true,
      publish: [
        { provider: 'github', owner: 'dovocode', repo: 'dovo-studio', releaseType: 'draft' },
      ],
      mac: {
        icon: join(root, 'apps/desktop/build/icon.icns'),
        category: 'public.app-category.developer-tools',
        identity: process.env.CSC_NAME ?? null,
        hardenedRuntime: true,
        notarize: !!(
          process.env.APPLE_API_KEY ||
          (process.env.APPLE_ID &&
            process.env.APPLE_APP_SPECIFIC_PASSWORD &&
            process.env.APPLE_TEAM_ID)
        ),
      },
      artifactName: 'Dovo-Studio-${version}-${arch}.${ext}',
    },
  })
  await desktopMiseArchive(root)
} finally {
  await rm(stage, { recursive: true, force: true })
}
