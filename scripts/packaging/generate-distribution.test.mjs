import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
const script = new URL('./generate-distribution.mjs', import.meta.url)
const releaseEnvironment = new Map()
beforeEach(() => {
  for (const key of ['DOVO_RELEASE_VERSION', 'DOVO_RELEASE_CHANNEL']) {
    releaseEnvironment.set(key, process.env[key])
    delete process.env[key]
  }
})
afterEach(() => {
  for (const [key, value] of releaseEnvironment) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

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

await test('generates separate nightly Homebrew and mise definitions', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'dovo-nightly-distribution-test-'))
  try {
    const version = '1.2.3-nightly.42'
    const files = [
      `Dovo-Server-Nightly-${version}-macos-arm64.tar.gz`,
      `Dovo-Server-Nightly-${version}-linux-arm64.tar.gz`,
      `Dovo-Server-Nightly-${version}-linux-x64.tar.gz`,
      `Dovo-Studio-Nightly-${version}-arm64.zip`,
      `Dovo-Studio-Nightly-mise-${version}-macos-arm64.tar.gz`,
      `Dovo-Server-Nightly-${version}-windows-x64.zip`,
      `Dovo-Server-Nightly-${version}-windows-arm64.zip`,
    ]
    for (const file of files) await writeFile(join(temporary, file), file)
    const output = join(temporary, 'distribution')
    execFileSync(process.execPath, [script.pathname, temporary, output, version])
    const formula = await readFile(join(output, 'Formula/dovo-server-nightly.rb'), 'utf8')
    const cask = await readFile(join(output, 'Casks/dovo-studio-nightly.rb'), 'utf8')
    const mise = await readFile(join(output, 'mise.toml'), 'utf8')
    assert.match(formula, /class DovoServerNightly/)
    assert.match(formula, /bin\/dovo-server-nightly/)
    assert.match(cask, /Dovo Studio \(Nightly\)\.app/)
    assert.match(mise, /http:dovo-server-nightly/)
    assert.match(mise, /http:dovo-studio-nightly/)
    assert.ok(!formula.includes('Dovo-Server-1.2.3-'))
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
    for (const dir of ['apps/api/dist', 'packages/push/dist', 'patches', 'scripts'])
      await mkdir(join(root, dir), { recursive: true })
    await writeFile(
      join(root, 'packages/push/package.json'),
      JSON.stringify({ name: '@dovo/push' }),
    )
    await writeFile(join(root, 'packages/push/dist/apns.js'), 'export class Apns {}')
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
      await readFile(join(staged, 'packages/push/dist/apns.js'), 'utf8'),
      'export class Apns {}',
    )
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

await test('nightly packaging keeps source manifests intact and uses a separate app identity', async () => {
  const { releaseVariant } = await import('./release-variant.mjs')
  const temporary = await mkdtemp(join(tmpdir(), 'dovo-nightly-version-test-'))
  const previous = process.env.DOVO_RELEASE_VERSION
  try {
    await writeFile(join(temporary, 'package.json'), JSON.stringify({ version: '1.2.3' }))
    process.env.DOVO_RELEASE_VERSION = '1.2.3-nightly.42'
    const variant = await releaseVariant(temporary)
    assert.equal(variant.productName, 'Dovo Studio (Nightly)')
    assert.equal(variant.appId, 'com.dovo.studio.nightly')
    assert.equal(variant.version, '1.2.3-nightly.42')
    assert.equal(
      JSON.parse(await readFile(join(temporary, 'package.json'), 'utf8')).version,
      '1.2.3',
    )
  } finally {
    if (previous === undefined) delete process.env.DOVO_RELEASE_VERSION
    else process.env.DOVO_RELEASE_VERSION = previous
    await rm(temporary, { recursive: true, force: true })
  }
})
