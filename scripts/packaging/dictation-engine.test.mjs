import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  dictationFingerprint,
  dictationToolchain,
  prepareDictationEngine,
} from './dictation-engine.mjs'

const name = process.platform === 'win32' ? 'dovo-dictation.exe' : 'dovo-dictation'
const notices = [
  'LICENSE.transcribe',
  'THIRD-PARTY-LICENSES.md',
  'LICENSE.ggml',
  'LICENSE.miniz',
  'LICENSE.tinyblas',
]
const toolchain = { cmake: 'cmake version 3.31.0', cxx: 'clang 17' }
const hostHasAppleSpeech =
  process.platform === 'darwin' && Number.parseInt(dictationToolchain().sdk) >= 26

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dovo-dictation-'))
  for (const [path, content] of [
    ['apps/desktop/native/dictation.cpp', 'int main() { return 0; }'],
    ['apps/desktop/native/apple-speech.swift', 'print("Apple Speech")'],
    ['apps/desktop/build/dictation/NOTICE.md', 'Dovo notice'],
  ]) {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), content)
  }
  return root
}

/** Simulate an actions/cache restore of a previously built bundle. */
async function restoredBundle(root, fingerprint) {
  const bundle = join(root, 'work/dictation', `${process.platform}-${process.arch}`, 'bundle')
  await mkdir(bundle, { recursive: true })
  await writeFile(join(bundle, name), 'binary')
  if (hostHasAppleSpeech) await writeFile(join(bundle, 'dovo-apple-speech'), 'swift binary')
  for (const notice of notices) await writeFile(join(bundle, notice), notice)
  await writeFile(
    join(bundle, 'build.json'),
    JSON.stringify({
      fingerprint,
      sha256: createHash('sha256').update('binary').digest('hex'),
      ...(hostHasAppleSpeech
        ? { appleSpeechSha256: createHash('sha256').update('swift binary').digest('hex') }
        : {}),
    }),
  )
  return bundle
}

/** Any rebuild starts with the pinned source download; stop there instead of compiling. */
async function withoutDownload(task) {
  const original = globalThis.fetch
  globalThis.fetch = async () => {
    throw new Error('rebuild requested')
  }
  try {
    return await task()
  } finally {
    globalThis.fetch = original
  }
}

await test('fingerprint covers helper source, notices, platform, architecture and toolchain', async () => {
  const root = await fixture()
  try {
    const base = { platform: 'darwin', arch: 'arm64', toolchain }
    const fingerprint = await dictationFingerprint(root, base)
    assert.equal(await dictationFingerprint(root, base), fingerprint)
    for (const changed of [
      { ...base, platform: 'linux' },
      { ...base, arch: 'x64' },
      { ...base, toolchain: { ...toolchain, cxx: 'clang 18' } },
      { ...base, toolchain: { ...toolchain, environment: { MACOSX_DEPLOYMENT_TARGET: '13.0' } } },
    ])
      assert.notEqual(await dictationFingerprint(root, changed), fingerprint)
    const notices = join(root, 'apps/desktop/build/dictation')
    const changes = [
      () => writeFile(join(notices, 'NOTICE.md'), 'Changed notice'),
      () => writeFile(join(notices, 'LICENSE.model.txt'), 'Model license'),
      () => rm(join(notices, 'NOTICE.md')),
      () => writeFile(join(root, 'apps/desktop/native/dictation.cpp'), 'int main() { return 1; }'),
    ]
    const seen = new Set([fingerprint])
    for (const change of changes) {
      await change()
      const next = await dictationFingerprint(root, base)
      assert.ok(!seen.has(next))
      seen.add(next)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

await test('fingerprints Apple Speech source only when the macOS SDK can build it', async () => {
  const root = await fixture()
  try {
    const mac = { platform: 'darwin', arch: 'arm64' }
    const supported = { ...mac, toolchain: { ...toolchain, sdk: '26.2', swift: 'Swift 6.2' } }
    const older = { ...mac, toolchain: { ...toolchain, sdk: '15.5' } }
    const supportedBefore = await dictationFingerprint(root, supported)
    const olderBefore = await dictationFingerprint(root, older)
    await writeFile(join(root, 'apps/desktop/native/apple-speech.swift'), 'print("New helper")')
    assert.notEqual(await dictationFingerprint(root, supported), supportedBefore)
    assert.equal(await dictationFingerprint(root, older), olderBefore)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

await test('reuses a restored bundle with matching fingerprint, binary and notices', async () => {
  const root = await fixture()
  try {
    const bundle = await restoredBundle(root, await dictationFingerprint(root))
    assert.equal(await withoutDownload(() => prepareDictationEngine(root)), bundle)
    assert.equal(await readFile(join(bundle, 'NOTICE.md'), 'utf8'), 'Dovo notice')
    if (hostHasAppleSpeech)
      assert.equal(await readFile(join(bundle, 'dovo-apple-speech'), 'utf8'), 'swift binary')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

await test(
  'rejects missing or modified Apple Speech helpers in a restored Mac bundle',
  {
    skip: !hostHasAppleSpeech,
  },
  async () => {
    const root = await fixture()
    try {
      const fingerprint = await dictationFingerprint(root)
      for (const damage of [
        (helper) => rm(helper),
        (helper) => writeFile(helper, 'modified Swift binary'),
      ]) {
        const bundle = await restoredBundle(root, fingerprint)
        await damage(join(bundle, 'dovo-apple-speech'))
        await assert.rejects(
          withoutDownload(() => prepareDictationEngine(root)),
          /rebuild requested/,
        )
        await assert.rejects(access(bundle), { code: 'ENOENT' })
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  },
)

await test('rebuilds stale, tampered or incomplete restored bundles from scratch', async () => {
  for (const damage of [
    (bundle) => writeFile(join(bundle, 'build.json'), JSON.stringify({ revision: 'older' })),
    (bundle) => writeFile(join(bundle, name), 'tampered'),
    (bundle) => rm(join(bundle, 'LICENSE.ggml')),
    (bundle) => writeFile(join(bundle, 'build.json'), '{'),
    (bundle) => writeFile(join(bundle, 'build.json'), 'null'),
    (bundle) => writeFile(join(bundle, 'build.json'), '42'),
    // A notice deleted from the overlay must not keep shipping from the restored bundle.
    (_bundle, root) => rm(join(root, 'apps/desktop/build/dictation/NOTICE.md')),
  ]) {
    const root = await fixture()
    try {
      const bundle = await restoredBundle(root, await dictationFingerprint(root))
      await damage(bundle, root)
      await assert.rejects(
        withoutDownload(() => prepareDictationEngine(root)),
        /rebuild requested/,
      )
      await assert.rejects(access(bundle), { code: 'ENOENT' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }
})
