import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { verifyMirageAsset, mirageAssets } from './mirage.mjs'

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
