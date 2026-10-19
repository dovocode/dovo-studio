import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mobileBuildNumber, validateNightlyTag } from './mobile-release.mjs'
await test('mobile build sequence stays above manual builds and increases across runs and retries', () => {
  const first = Number(mobileBuildNumber('2026101902', '1', '1'))
  assert.ok(first > 2026101902)
  assert.ok(Number(mobileBuildNumber('2026101902', '1', '2')) > first)
  assert.ok(
    Number(mobileBuildNumber('2026101902', '2', '1')) >
      Number(mobileBuildNumber('2026101902', '1', '99')),
  )
  for (const values of [
    ['1', '0', '1'],
    ['1', '1', '100'],
    ['1', 'abc', '1'],
    ['2100000000', '1', '1'],
  ])
    assert.throws(() => mobileBuildNumber(...values))
})
await test('mobile release assets cannot overwrite a stable or mismatched release', () => {
  validateNightlyTag('v0.0.9-nightly.400', '0.0.9')
  validateNightlyTag('', '0.0.9')
  for (const tag of [
    'v0.0.9',
    'v0.0.8-nightly.400',
    'v0x0x9-nightly.400',
    'v0.0.9-nightly.1\nother',
  ])
    assert.throws(() => validateNightlyTag(tag, '0.0.9'))
})
