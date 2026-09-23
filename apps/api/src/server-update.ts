import { spawn } from 'node:child_process'
import { cp, mkdir, readdir, readFile, writeFile, rm } from 'node:fs/promises'
import { closeSync, existsSync, openSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { managedProcessIsAlive, serverStatus, startServer, stopServer } from './server-manager.js'
import { writePrivateJson } from './server-config.js'
import { backupRuntimeDatabase } from '@dovo/runtime'
interface ServerRelease {
  entrypoint: string
  previousEntrypoint?: string
  createdAt: string
  version: string
}
export function sourceEntrypoint() {
  return fileURLToPath(new URL('../dist/index.js', import.meta.url))
}
export function selectedEntrypoint(directory: string) {
  // Package managers select the installed version. Do not redirect it to a previous source build.
  if (process.env.DOVO_SERVER_DISTRIBUTION === 'archive') return sourceEntrypoint()
  const path = join(directory, 'server-release.json')
  if (!existsSync(path)) return sourceEntrypoint()
  const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (
    !value ||
    typeof value !== 'object' ||
    !('entrypoint' in value) ||
    typeof value.entrypoint !== 'string' ||
    !existsSync(value.entrypoint)
  )
    throw new Error(
      `Invalid selected server release: ${path}. Restore the previous entrypoint before starting.`,
    )
  return value.entrypoint
}
async function execute(command: string, args: string[], cwd: string, logPath: string) {
  const log = openSync(logPath, 'a', 0o600)
  const child = spawn(command, args, {
    cwd,
    stdio: ['ignore', log, log],
    env: {
      ...process.env,
      CI: 'true',
    },
  })
  closeSync(log)
  await new Promise<void>((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(
              `${command} exited with ${code}. Read ${logPath}. The running runtime was not changed.`,
            ),
          ),
    )
  })
}
// Snapshot only runtime source, manifests and lockfile. Credentials, databases, other app
// source, Git state and the working checkout's node_modules never enter a release.
export async function stageServerSource(root: string, target: string) {
  await mkdir(target, {
    recursive: true,
    mode: 0o700,
  })
  for (const name of [
    'package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'tsconfig.base.json',
    'patches',
  ])
    await cp(join(root, name), join(target, name), {
      recursive: true,
    })
  const manifest: unknown = JSON.parse(await readFile(join(target, 'package.json'), 'utf8'))
  if (
    !manifest ||
    typeof manifest !== 'object' ||
    !('scripts' in manifest) ||
    !manifest.scripts ||
    typeof manifest.scripts !== 'object'
  )
    throw new Error('Invalid source package manifest.')
  await writeFile(
    join(target, 'package.json'),
    JSON.stringify(
      {
        ...manifest,
        scripts: {
          ...manifest.scripts,
          postinstall: 'node scripts/prepare-pty.mjs',
        },
      },
      null,
      2,
    ),
  )
  await mkdir(join(target, 'scripts'))
  for (const script of ['prepare-pty.mjs', 'build-browser-viewer.mjs', 'copy-runtime-assets.mjs'])
    await cp(join(root, 'scripts', script), join(target, 'scripts', script))
  const runtimePackages = new Set([
    'apps/api',
    'packages/runtime',
    'packages/protocol',
    'packages/client-runtime',
  ])
  for (const category of ['apps', 'packages']) {
    for (const entry of await readdir(join(root, category), {
      withFileTypes: true,
    })) {
      if (!entry.isDirectory() || !existsSync(join(root, category, entry.name, 'package.json')))
        continue
      const relative = `${category}/${entry.name}`
      await mkdir(join(target, relative), {
        recursive: true,
      })
      await cp(join(root, relative, 'package.json'), join(target, relative, 'package.json'))
      if (runtimePackages.has(relative)) {
        await cp(join(root, relative, 'src'), join(target, relative, 'src'), {
          recursive: true,
        })
        if (relative === 'packages/runtime')
          await cp(join(root, relative, 'native'), join(target, relative, 'native'), {
            recursive: true,
            filter: (source) => !source.split(/[\\/]/).includes('target'),
          })
        for (const name of await readdir(join(root, relative)))
          if (/^tsconfig.*\.json$/.test(name))
            await cp(join(root, relative, name), join(target, relative, name))
      }
    }
  }
  return 'version' in manifest && typeof manifest.version === 'string'
    ? manifest.version
    : 'unknown'
}
export async function updateServer(directory: string) {
  const initial = await serverStatus(directory)
  if (initial.running && !initial.managed)
    throw new Error(
      'This runtime is owned by another launcher. Stop it there and start it with pnpm server start before updating.',
    )
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
  const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`
  const release = join(directory, 'releases', id)
  const version = await stageServerSource(root, release)
  const logPath = join(release, 'update.log')
  await execute(
    'pnpm',
    ['install', '--frozen-lockfile', '--filter', '@dovo/api...', '--filter', 'dovo-studio'],
    release,
    logPath,
  )
  await execute('pnpm', ['--filter', '@dovo/api...', '-r', 'build'], release, logPath)
  await execute(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      "import {startRuntime} from '@dovo/runtime'; const r=await startRuntime({databasePath:':memory:',ownerToken:'release-check-token-at-least-thirty-two-characters',port:0}); const t=r.services.terminals.create('check',process.cwd()); r.services.terminals.close(t.id); await r.close();",
    ],
    join(release, 'apps/api'),
    logPath,
  )
  const entrypoint = join(release, 'apps/api/dist/index.js')
  const previousEntrypoint = selectedEntrypoint(directory)
  const previousMetadata = existsSync(join(directory, 'server-release.json'))
    ? JSON.parse(readFileSync(join(directory, 'server-release.json'), 'utf8'))
    : {
        entrypoint: previousEntrypoint,
        version: 'previous',
        createdAt: new Date().toISOString(),
      }
  const metadata: ServerRelease = {
    entrypoint,
    previousEntrypoint,
    version,
    createdAt: new Date().toISOString(),
  }
  if (initial.running) await stopServer(directory)
  const backupPath = join(directory, 'backups', `runtime-before-${id}.sqlite`)
  let backedUp = false
  try {
    if (existsSync(initial.databasePath)) {
      await mkdir(dirname(backupPath), {
        recursive: true,
        mode: 0o700,
      })
      await backupRuntimeDatabase(initial.databasePath, backupPath)
      backedUp = true
    }
    writePrivateJson(join(directory, 'server-release.json'), metadata)
    await startServer(directory, entrypoint)
  } catch (error) {
    writePrivateJson(join(directory, 'server-release.json'), previousMetadata)
    if (managedProcessIsAlive(directory))
      throw new Error(
        `The new runtime did not stop cleanly. The previous release is selected, but the database was not restored while a process is using it. Backup: ${backupPath}. ${error instanceof Error ? error.message : String(error)}`,
      )
    if (backedUp) {
      await cp(backupPath, initial.databasePath)
      await rm(initial.databasePath + '-wal', {
        force: true,
      })
      await rm(initial.databasePath + '-shm', {
        force: true,
      })
    }
    if (initial.running) {
      try {
        await startServer(directory, previousEntrypoint)
      } catch (rollbackError) {
        throw new Error(
          `The new release failed and the previous runtime could not restart: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}. Original error: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
    throw new Error(
      `The new release failed; the previous release was ${initial.running ? 'restarted' : 'kept selected'}. ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  return {
    updated: true,
    version,
    release,
    updateLogPath: logPath,
    ...(backedUp
      ? {
          backupPath,
        }
      : {}),
    ...(await serverStatus(directory)),
  }
}
