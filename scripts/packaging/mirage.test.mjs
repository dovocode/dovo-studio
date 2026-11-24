import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verifyMirageAsset, mirageAssets, prepareMirage } from './mirage.mjs'

await test('rejects corrupt or truncated model and runtime downloads', () => {
  const bytes = Buffer.from('model')
  const asset = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
  assert.equal(verifyMirageAsset(bytes, asset), true)
  assert.equal(verifyMirageAsset(Buffer.from('other'), asset), false)
  assert.equal(verifyMirageAsset(bytes.subarray(1), asset), false)
  assert.equal(new Set(mirageAssets.map((asset) => asset.name)).size, 4)
  for (const file of mirageAssets) {
    assert.match(file.url, /\/resolve\/[a-f0-9]{40}\//)
    assert.match(file.sha256, /^[a-f0-9]{64}$/)
  }
})

await test('waits for the Hugging Face rate limit to reset and verifies the retried bytes', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-mirage-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const firstRequest = Promise.withResolvers()
  const fetch = t.mock.method(globalThis, 'fetch', () => {
    if (fetch.mock.callCount() > 0) return Promise.resolve(new Response('wrong bytes'))
    firstRequest.resolve()
    return Promise.resolve(
      new Response(null, {
        status: 429,
        headers: { RateLimit: '"resolvers";r=0;t=3' },
      }),
    )
  })
  const prepared = prepareMirage(directory)
  const verified = assert.rejects(prepared, /cactus\.cjs size or SHA-256 mismatch/)
  void verified.catch(() => {})
  await firstRequest.promise
  await new Promise((resolve) => setImmediate(resolve))
  t.mock.timers.tick(2999)
  assert.equal(fetch.mock.callCount(), 1)
  t.mock.timers.tick(1)
  await verified
  assert.equal(fetch.mock.callCount(), 2)
  assert.equal(fetch.mock.calls[1].arguments[0], mirageAssets[0].url)
})
