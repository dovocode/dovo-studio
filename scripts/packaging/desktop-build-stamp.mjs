import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { buildDigest } from './build-fingerprint.mjs'

async function source(root) {
  const paths = [
    'package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'patches',
    'vite.config.ts',
    'tsconfig.base.json',
    'scripts',
    'apps/desktop/src',
    'apps/desktop/electron',
    'apps/desktop/public',
    'apps/desktop/build',
    'apps/desktop/package.json',
    'apps/desktop/vite.config.ts',
    'apps/desktop/tsconfig.json',
  ]
  for (const entry of await readdir(join(root, 'packages'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    paths.push(`packages/${entry.name}/src`, `packages/${entry.name}/package.json`)
  }
  return buildDigest(root, paths)
}
const outputs = (root) => buildDigest(root, ['apps/desktop/dist', 'apps/desktop/dist-electron'])
export async function writeDesktopBuildStamp(root) {
  await writeFile(
    join(root, 'apps/desktop/dist/.dovo-build.json'),
    JSON.stringify({
      source: await source(root),
      outputs: await outputs(root),
    }),
  )
}
export async function verifyDesktopBuild(root) {
  let stamp
  try {
    stamp = JSON.parse(await readFile(join(root, 'apps/desktop/dist/.dovo-build.json'), 'utf8'))
  } catch (error) {
    throw new Error('Desktop build verification is missing. Run pnpm build first.', {
      cause: error,
    })
  }
  if (stamp?.source !== (await source(root)) || stamp?.outputs !== (await outputs(root)))
    throw new Error(
      'The desktop build does not match its sources or outputs. Run pnpm build first.',
    )
}
