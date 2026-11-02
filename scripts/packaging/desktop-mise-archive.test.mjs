import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { desktopMiseArchive } from './desktop-mise-archive.mjs'
import { releaseVariant } from './release-variant.mjs'

await test(
  'mise archive preserves app contents and symlinks with a working executable launcher',
  { skip: process.platform === 'win32' },
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'dovo mise archive '))
    try {
      await writeFile(join(root, 'package.json'), '{"version":"1.0.0"}')
      const variant = await releaseVariant(root)
      const contents = join(root, 'release/mac-arm64', `${variant.productName}.app/Contents`)
      await mkdir(contents, { recursive: true })
      await writeFile(join(contents, 'binary'), 'signed app fixture')
      await symlink('binary', join(contents, 'Current'))
      const archive = await desktopMiseArchive(root)
      const extracted = join(root, 'extracted')
      await mkdir(extracted)
      execFileSync('tar', ['-xzf', archive, '-C', extracted])
      assert.equal(
        await readFile(join(extracted, `${variant.productName}.app/Contents/binary`), 'utf8'),
        'signed app fixture',
      )
      assert.equal(
        await readlink(join(extracted, `${variant.productName}.app/Contents/Current`)),
        'binary',
      )
      const launcher = join(
        extracted,
        variant.nightly ? 'bin/dovo-studio-nightly' : 'bin/dovo-studio',
      )
      const script = await readFile(launcher, 'utf8')
      assert.ok(script.includes(`/usr/bin/open -a "$base/${variant.productName}.app"`))
      execFileSync('sh', ['-n', launcher])
      await rm(join(root, 'release/mac-arm64'), { recursive: true })
      await assert.rejects(desktopMiseArchive(root), /Command failed/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  },
)
