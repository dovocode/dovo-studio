import { mkdtemp, readFile, rm, writeFile, chmod, realpath, cp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, isAbsolute, dirname } from 'node:path'
import { createRequire } from 'node:module'
import { deploy } from './deploy.mjs'
import { stageWorkspace } from './stage-workspace.mjs'
import { releaseVariant } from './release-variant.mjs'
import { buildDigest } from './build-fingerprint.mjs'
import { runtimeSmoke } from './runtime-smoke.mjs'
import { execFileSync } from 'node:child_process'

async function stamp(root) {
  const { version } = await releaseVariant(root)
  const packages = [
    'apps/api',
    'packages/runtime',
    'packages/protocol',
    'packages/client-runtime',
    'packages/push',
  ]
  return {
    version,
    platform: process.platform,
    arch: process.arch,
    node: process.versions.node,
    content: await buildDigest(root, [
      'package.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      'patches',
      'scripts/packaging',
      ...packages.flatMap((name) => [`${name}/package.json`, `${name}/dist`]),
    ]),
  }
}
export async function prepareRuntime(root, target) {
  const stage = await mkdtemp(join(tmpdir(), 'dovo-prepare-runtime-'))
  try {
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
        target,
      ],
      source,
    )
    if (process.platform === 'darwin') {
      const require = createRequire(
        await realpath(join(target, 'node_modules/@dovo/runtime/package.json')),
      )
      const pty = dirname(require.resolve('node-pty/package.json'))
      await chmod(join(pty, `prebuilds/darwin-${process.arch}/spawn-helper`), 0o755)
    }
    execFileSync(process.execPath, ['--input-type=module', '--eval', runtimeSmoke], {
      cwd: target,
      stdio: 'inherit',
    })
    await writeFile(join(target, '.dovo-runtime.json'), JSON.stringify(await stamp(root)))
  } finally {
    await rm(stage, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}
export async function preparedRuntime(root) {
  const directory = process.env.DOVO_PREPARED_RUNTIME
  if (!directory || !isAbsolute(directory))
    throw new Error('DOVO_PREPARED_RUNTIME must be an absolute path')
  const actual = JSON.parse(await readFile(join(directory, '.dovo-runtime.json'), 'utf8'))
  if (JSON.stringify(actual) !== JSON.stringify(await stamp(root)))
    throw new Error(
      'Prepared runtime does not match this build, release version or native platform',
    )
  return directory
}

export async function copyPreparedRuntime(root, destination) {
  await cp(await preparedRuntime(root), destination, {
    recursive: true,
    dereference: process.platform === 'win32',
    verbatimSymlinks: process.platform !== 'win32',
  })
}
