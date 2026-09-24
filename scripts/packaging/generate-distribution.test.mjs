import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
const script = new URL('./generate-distribution.mjs', import.meta.url)
await test('generates matching Homebrew and mise checksums and rejects incomplete releases', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'dovo-distribution-test-'))
  try {
    const output = join(temporary, 'output')
    assert.throws(() =>
      execFileSync(process.execPath, [script.pathname, temporary, output, '1.2.3'], {
        stdio: 'pipe',
      }),
    )
    const files = [
      'Dovo-Server-1.2.3-macos-arm64.tar.gz',
      'Dovo-Server-1.2.3-linux-arm64.tar.gz',
      'Dovo-Server-1.2.3-linux-x64.tar.gz',
      'Dovo-Studio-1.2.3-arm64.zip',
      'Dovo-Studio-mise-1.2.3-macos-arm64.tar.gz',
      'Dovo-Server-1.2.3-windows-x64.zip',
      'Dovo-Server-1.2.3-windows-arm64.zip',
    ]
    for (const name of files) await writeFile(join(temporary, name), name)
    execFileSync(process.execPath, [script.pathname, temporary, output, '1.2.3'])
    const formula = await readFile(join(output, 'Formula/dovo-server.rb'), 'utf8')
    const mise = await readFile(join(output, 'mise.toml'), 'utf8')
    const sums = await readFile(join(output, 'SHA256SUMS'), 'utf8')
    for (const name of files) {
      const hash = createHash('sha256').update(name).digest('hex')
      assert.ok(sums.includes(`${hash}  ${name}`))
      if (!name.startsWith('Dovo-Studio-1.2.3')) assert.ok(mise.includes(hash))
      if (name.startsWith('Dovo-Server') && !name.includes('windows'))
        assert.ok(formula.includes(hash))
    }
    assert.ok(!formula.includes(':no_check'))
    assert.match(formula, /bin.install_symlink/)
    assert.throws(() =>
      execFileSync(process.execPath, [script.pathname, temporary, output, '../bad'], {
        stdio: 'pipe',
      }),
    )
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

await test('stages the release version for server diagnostics without editing source manifests', async () => {
  const { stageWorkspace } = await import('./stage-workspace.mjs')
  const { mkdir } = await import('node:fs/promises')
  const temporary = await mkdtemp(join(tmpdir(), 'dovo-stage-version-'))
  try {
    const root = join(temporary, 'source')
    for (const dir of ['apps/api/dist', 'packages', 'patches', 'scripts'])
      await mkdir(join(root, dir), { recursive: true })
    await writeFile(join(root, 'package.json'), JSON.stringify({ version: '1.2.3' }))
    await writeFile(
      join(root, 'apps/api/package.json'),
      JSON.stringify({ name: '@dovo/api', version: '0.1.0' }),
    )
    for (const file of ['pnpm-lock.yaml', 'pnpm-workspace.yaml', 'scripts/prepare-pty.mjs'])
      await writeFile(join(root, file), '')
    const staged = join(temporary, 'staged')
    await stageWorkspace(root, staged)
    assert.equal(
      JSON.parse(await readFile(join(staged, 'apps/api/package.json'), 'utf8')).version,
      '1.2.3',
    )
    assert.equal(
      JSON.parse(await readFile(join(root, 'apps/api/package.json'), 'utf8')).version,
      '0.1.0',
    )
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})
