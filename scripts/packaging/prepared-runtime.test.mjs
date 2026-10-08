import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, symlink, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildDigest } from './build-fingerprint.mjs'
import { copyPreparedRuntime } from './prepared-runtime.mjs'

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

await test('shared runtime copies survive relocation and reject incompatible build stamps', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dovo-prepared-copy-'))
  const prepared = join(root, 'prepared')
  const previous = process.env.DOVO_PREPARED_RUNTIME
  process.env.DOVO_PREPARED_RUNTIME = prepared
  try {
    await writeFile(join(root, 'package.json'), '{"version":"0.0.7"}')
    await mkdir(join(prepared, 'node_modules/actual'), { recursive: true })
    await writeFile(join(prepared, 'node_modules/actual/index.js'), 'export const ready = true')
    await symlink(
      process.platform === 'win32' ? join(prepared, 'node_modules/actual') : 'actual',
      join(prepared, 'node_modules/link'),
      'junction',
    )
    const stamp = {
      version: '0.0.7',
      platform: process.platform,
      arch: process.arch,
      node: process.versions.node,
      content: await buildDigest(root, ['package.json']),
    }
    const manifest = join(prepared, '.dovo-runtime.json')
    await writeFile(manifest, JSON.stringify(stamp))
    const destination = join(root, 'copied')
    await copyPreparedRuntime(root, destination)
    await rename(prepared, `${prepared}-unavailable`)
    assert.equal(
      await readFile(join(destination, 'node_modules/link/index.js'), 'utf8'),
      'export const ready = true',
    )
    await rename(`${prepared}-unavailable`, prepared)
    for (const key of ['version', 'platform', 'arch', 'node', 'content']) {
      await writeFile(manifest, JSON.stringify({ ...stamp, [key]: 'different' }))
      await assert.rejects(copyPreparedRuntime(root, destination), /does not match/)
    }
  } finally {
    if (previous === undefined) delete process.env.DOVO_PREPARED_RUNTIME
    else process.env.DOVO_PREPARED_RUNTIME = previous
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})
