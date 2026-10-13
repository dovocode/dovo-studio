import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { linuxDependencies, requiredGlibc } from './gpui-linux.mjs'
import { macInfoPlist, macSigningFiles, signMacGpui } from './gpui-mac.mjs'
import { gpuiArchive } from './gpui-archive.mjs'
import { gpuiReleaseAssets, verifyGpuiRelease } from './verify-gpui-release.mjs'
import { gpuiBuildTargets, gpuiTargets } from './gpui-targets.mjs'

test('Linux release ABI rejects new-host glibc and checks numeric versions', () => {
  assert.equal(requiredGlibc('GLIBC_2.9 GLIBC_2.34 GLIBC_2.39 GLIBC_2.3'), '2.39')
  assert.throws(
    () => requiredGlibc('GLIBC_2.39 GLIBC_2.43'),
    /build release packages on Ubuntu 24.04/,
  )
  assert.throws(() => requiredGlibc('GLIBC_3.0'), /glibc 3.0/)
  assert.throws(() => requiredGlibc('not an ELF version table'), /No glibc/)
  assert.ok(linuxDependencies.rpm.includes('vulkan-loader'))
  assert.ok(linuxDependencies.rpm.includes('webkit2gtk4.1'))
  assert.ok(linuxDependencies.rpm.includes('libxkbcommon-x11'))
  assert.ok(linuxDependencies.deb.includes('libvulkan1'))
})

test('macOS signing selects extensionless helpers and native modules by content', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'gpui-macho-test-'))
  try {
    await mkdir(join(temporary, 'nested'))
    await writeFile(join(temporary, 'nested/spawn-helper'), Buffer.from('cffaedfe01020304', 'hex'))
    await writeFile(join(temporary, 'binding.node'), Buffer.from('cafebabe01020304', 'hex'))
    await writeFile(join(temporary, 'foreign.node'), Buffer.from('7f454c4601020304', 'hex'))
    await writeFile(join(temporary, 'script'), '#!/bin/sh\n')
    await writeFile(join(temporary, 'empty'), '')
    if (process.platform !== 'win32') await symlink('/usr/bin', join(temporary, 'external'))
    assert.deepEqual(await macSigningFiles(temporary), [
      join(temporary, 'binding.node'),
      join(temporary, 'nested/spawn-helper'),
    ])
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

test('macOS bundle has a stable credential identity and valid nightly version fields', () => {
  const plist = macInfoPlist('1.2.3-nightly.42')
  assert.match(plist, /<key>CFBundleIdentifier<\/key><string>dev.dovo.studio.gpui<\/string>/)
  assert.match(plist, /<key>CFBundleVersion<\/key><string>42<\/string>/)
  assert.match(plist, /<key>CFBundleShortVersionString<\/key><string>1.2.3<\/string>/)
  assert.throws(() => macInfoPlist('1.2.3<script>'), /Invalid/)
})

test('signed macOS release fails closed without existing signing credentials', async () => {
  if (!process.env.CSC_LINK)
    await assert.rejects(signMacGpui({ release: true }), /Missing CSC_LINK/)
})

test('archive preserves final bytes and deployed runtime layout after relocation', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'gpui-archive-test-'))
  try {
    const directory = join(temporary, 'signed app')
    await mkdir(join(directory, 'libexec/server/dist'), { recursive: true })
    await writeFile(join(directory, 'dovo-desktop-gpui'), 'final signed bytes', { mode: 0o755 })
    await writeFile(join(directory, 'libexec/node'), 'node')
    await writeFile(join(directory, 'libexec/server/dist/server-cli.js'), 'runtime')
    const path = await gpuiArchive({
      directory,
      output: join(temporary, 'release'),
      version: '1.2.3',
      nightly: false,
      platform: 'linux',
      arch: 'arm64',
    })
    const extracted = join(temporary, 'relocated')
    await mkdir(extracted)
    execFileSync('tar', ['-xzf', path, '-C', extracted])
    assert.equal(await readFile(join(extracted, 'dovo-desktop-gpui'), 'utf8'), 'final signed bytes')
    assert.equal(
      await readFile(join(extracted, 'libexec/server/dist/server-cli.js'), 'utf8'),
      'runtime',
    )
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

test('release requires every platform and hashes final assets', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'gpui-release-test-'))
  try {
    const variant = { version: '1.2.3-nightly.42', nightly: true }
    await assert.rejects(verifyGpuiRelease(temporary, variant), /Missing GPUI release asset/)
    const assets = gpuiReleaseAssets(variant)
    for (const name of assets) await writeFile(join(temporary, name), name)
    const changed = assets[0]
    await writeFile(join(temporary, changed), 'signed final content')
    const manifest = await verifyGpuiRelease(temporary, variant)
    const lines = (await readFile(join(temporary, manifest), 'utf8')).trim().split('\n')
    assert.equal(lines.length, 10)
    assert.ok(
      lines.includes(
        `${createHash('sha256').update('signed final content').digest('hex')}  ${changed}`,
      ),
    )
    await writeFile(join(temporary, changed), '')
    await assert.rejects(verifyGpuiRelease(temporary, variant), /Empty GPUI release asset/)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

test('build workflow keeps signed downloads in Actions without creating releases', async () => {
  const require = createRequire(import.meta.url)
  const builderRequire = createRequire(require.resolve('electron-builder'))
  const appRequire = createRequire(builderRequire.resolve('app-builder-lib'))
  const { load } = appRequire('js-yaml')
  const workflow = load(
    await readFile(new URL('../../.github/workflows/release-gpui.yml', import.meta.url), 'utf8'),
  )
  assert.equal(workflow.permissions.contents, 'read')
  assert.equal(workflow.jobs.build.env.DOVO_BUILD_TARGET, 'gpui')
  assert.ok(workflow.jobs.build.steps.some((step) => step.run === 'pnpm install --frozen-lockfile'))
  assert.equal(workflow.on.pull_request, undefined)
  assert.deepEqual(gpuiBuildTargets.map(({ os, arch }) => `${os}-${arch}`).sort(), [
    'linux-arm64',
    'linux-x64',
    'macos-arm64',
    'macos-x64',
    'windows-arm64',
    'windows-x64',
  ])
  assert.equal(workflow.jobs['windows-sign'].environment, 'windows-signing')
  assert.equal(workflow.jobs['windows-sign'].permissions['id-token'], 'write')
  assert.ok(workflow.jobs.artifacts.needs.includes('windows-smoke'))
  assert.equal(workflow.jobs.artifacts.permissions.contents, 'read')
  assert.ok(
    workflow.jobs.artifacts.steps.some(
      (step) => step.uses === 'actions/upload-artifact@v7' && step.with['retention-days'] === 30,
    ),
  )
  assert.ok(
    Object.values(workflow.jobs).every((job) =>
      job.steps.every((step) => !step.run?.includes('gh release')),
    ),
  )
  const macStep = workflow.jobs.build.steps.find((step) => step.env?.CSC_LINK)
  assert.equal(macStep.env.CSC_LINK, '${{ secrets.MAC_CERTIFICATE }}')
  assert.equal(macStep.env.CSC_NAME, '${{ secrets.MAC_SIGNING_IDENTITY }}')
  assert.ok(
    workflow.jobs.build.steps.some(
      (step) =>
        step.run?.includes('check-gpui-linux-install.sh') && step.run.includes('fedora:$version'),
    ),
  )
  if (process.platform !== 'win32') {
    const temporary = await mkdtemp(join(tmpdir(), 'gpui-release-variant-'))
    try {
      const base = JSON.parse(
        await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
      ).version
      const step = workflow.jobs.prepare.steps.find((item) => item.id === 'variant')
      const output = join(temporary, 'outputs')
      const env = {
        ...process.env,
        GITHUB_OUTPUT: output,
        GITHUB_REF_TYPE: 'branch',
        GITHUB_RUN_NUMBER: '42',
        INPUT_VERSION: '',
        INPUT_PLATFORMS: 'all',
        GITHUB_EVENT_NAME: 'workflow_dispatch',
      }
      const values = async () =>
        Object.fromEntries(
          (await readFile(output, 'utf8'))
            .trim()
            .split('\n')
            .map((line) => {
              const index = line.indexOf('=')
              return [line.slice(0, index), line.slice(index + 1)]
            }),
        )
      execFileSync('bash', ['-c', step.run], { env })
      assert.deepEqual(await values(), {
        version: `${base}-nightly.42`,
        channel: 'nightly',
        platforms: 'all',
        matrix: JSON.stringify(gpuiTargets()),
      })
      await writeFile(output, '')
      execFileSync('bash', ['-c', step.run], {
        env: { ...env, GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: `v${base}` },
      })
      assert.equal((await values()).version, base)
      assert.equal((await values()).channel, 'stable')
      await writeFile(output, '')
      execFileSync('bash', ['-c', step.run], {
        env: { ...env, INPUT_VERSION: `${base}-nightly.99` },
      })
      assert.equal((await values()).version, `${base}-nightly.99`)
      assert.equal((await values()).channel, 'nightly')
      await writeFile(output, '')
      execFileSync('bash', ['-c', step.run], {
        env: { ...env, GITHUB_EVENT_NAME: 'push', INPUT_PLATFORMS: '' },
      })
      assert.equal((await values()).matrix, JSON.stringify(gpuiTargets('windows-macos')))
      assert.equal(
        gpuiReleaseAssets({ version: base, nightly: false, platforms: 'windows-macos' }).length,
        4,
      )
      await writeFile(output, '')
      execFileSync('bash', ['-c', step.run], { env: { ...env, INPUT_PLATFORMS: 'linux' } })
      assert.equal((await values()).matrix, JSON.stringify(gpuiTargets('linux')))
      assert.throws(() => gpuiTargets('unknown'), /Invalid/)
      assert.throws(
        () =>
          execFileSync('bash', ['-c', step.run], {
            env: { ...env, INPUT_VERSION: '9.9.9' },
            stdio: 'pipe',
          }),
        /Command failed/,
      )
    } finally {
      await rm(temporary, { recursive: true, force: true })
    }
  }
})
