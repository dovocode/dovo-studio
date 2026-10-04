import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { verifyDesktopBuild, writeDesktopBuildStamp } from './desktop-build-stamp.mjs'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dovo-build-stamp-'))
  for (const [path, content] of [
    ['package.json', '{"version":"1.0.0"}'],
    ['apps/desktop/src/main.ts', 'export const title = "Dovo"'],
    ['packages/studio-ui/src/composer.ts', 'export const composer = "ready"'],
    ['apps/desktop/dist/index.html', '<html>Dovo</html>'],
    ['apps/desktop/dist-electron/main.js', 'console.log("Dovo")'],
  ]) {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), content)
  }
  return root
}

await test('accepts restored outputs regardless of checkout timestamps and rejects changed inputs', async () => {
  const root = await fixture()
  try {
    await writeDesktopBuildStamp(root)
    await utimes(join(root, 'apps/desktop/src/main.ts'), new Date(), new Date())
    await utimes(join(root, 'apps/desktop/dist/index.html'), new Date(0), new Date(0))
    await verifyDesktopBuild(root)
    await writeFile(
      join(root, 'packages/studio-ui/src/composer.ts'),
      'export const composer = "new"',
    )
    await assert.rejects(verifyDesktopBuild(root), /does not match/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

await test('rejects missing, mixed and edited build outputs', async () => {
  const root = await fixture()
  try {
    await assert.rejects(verifyDesktopBuild(root), /verification is missing/)
    await writeDesktopBuildStamp(root)
    await writeFile(join(root, 'apps/desktop/dist-electron/main.js'), 'console.log("old build")')
    await assert.rejects(verifyDesktopBuild(root), /does not match/)
    await writeDesktopBuildStamp(root)
    await rm(join(root, 'apps/desktop/dist/index.html'))
    await assert.rejects(verifyDesktopBuild(root), /does not match/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
