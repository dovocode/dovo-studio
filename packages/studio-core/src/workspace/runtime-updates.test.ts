import { expect, it } from 'vite-plus/test'
import { newerRuntimeVersion } from './runtime-updates.js'

it('compares stable and nightly release versions numerically', () => {
  expect(newerRuntimeVersion('0.0.10', '0.0.9')).toBe(true)
  expect(newerRuntimeVersion('0.0.7-nightly.42', '0.0.7-nightly.41')).toBe(true)
  expect(newerRuntimeVersion('0.0.7-nightly.9', '0.0.7-nightly.42')).toBe(false)
  expect(newerRuntimeVersion('0.0.7', '0.0.7-nightly.42')).toBe(true)
  expect(newerRuntimeVersion('unknown', '0.0.7')).toBe(false)
})
