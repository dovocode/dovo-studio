import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stageDesktopWorkspace } from './stage-workspace.mjs'

await test('desktop staging keeps host dependencies and runtime outputs without changing the source workspace', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-desktop-stage-'))
  const root = join(directory, 'root')
  const desktop = {
    name: '@dovo/desktop',
    dependencies: { ws: '^8.0.0', 'electron-updater': '^6.0.0', react: '^19.0.0' },
  }
  try {
    for (const relative of ['apps/api/dist', 'apps/desktop', 'packages', 'scripts', 'patches'])
      await mkdir(join(root, relative), { recursive: true })
    await writeFile(join(root, 'package.json'), '{"version":"0.0.7"}')
    await writeFile(join(root, 'pnpm-workspace.yaml'), 'packages: [apps/*, packages/*]')
    await writeFile(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9')
    await writeFile(join(root, 'scripts/prepare-pty.mjs'), '')
    await writeFile(join(root, 'apps/api/package.json'), '{"name":"@dovo/api"}')
    await writeFile(join(root, 'apps/api/dist/index.js'), 'export const ready = true')
    const file = join(root, 'apps/desktop/package.json')
    await writeFile(file, JSON.stringify(desktop))
    const target = join(directory, 'staged')
    const dependencies = await stageDesktopWorkspace(root, target)
    assert.deepEqual(dependencies, { ws: '^8.0.0', 'electron-updater': '^6.0.0' })
    assert.deepEqual(
      JSON.parse(await readFile(join(target, 'apps/desktop/package.json'), 'utf8')).dependencies,
      dependencies,
    )
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), desktop)
    assert.equal(
      await readFile(join(target, 'apps/api/dist/index.js'), 'utf8'),
      'export const ready = true',
    )
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})
