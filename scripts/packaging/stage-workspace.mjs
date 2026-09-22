import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
// pnpm's production deploy can prune development links in its source workspace.
// Stage manifests and compiled runtime packages so packaging never changes the working install.
export async function stageWorkspace(root, target) {
  const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  await mkdir(target)
  for (const name of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'patches'])
    await cp(join(root, name), join(target, name), { recursive: true })
  await mkdir(join(target, 'scripts'))
  await cp(join(root, 'scripts/prepare-pty.mjs'), join(target, 'scripts/prepare-pty.mjs'))
  const runtimePackages = new Set([
    'apps/api',
    'packages/runtime',
    'packages/protocol',
    'packages/client-runtime',
  ])
  for (const category of ['apps', 'packages'])
    for (const entry of await readdir(join(root, category), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const relative = `${category}/${entry.name}`
      await mkdir(join(target, relative), { recursive: true })
      await cp(join(root, relative, 'package.json'), join(target, relative, 'package.json'))
      if (relative === 'apps/api') {
        const manifest = join(target, relative, 'package.json')
        await writeFile(
          manifest,
          JSON.stringify({ ...JSON.parse(await readFile(manifest, 'utf8')), version }, null, 2),
        )
      }
      if (runtimePackages.has(relative))
        await cp(join(root, relative, 'dist'), join(target, relative, 'dist'), { recursive: true })
    }
}
