import { expect, it } from 'vite-plus/test'
import { clipboardImageData } from './clipboard-image'

it('accepts PNG clipboard data and rejects empty, unsupported and oversized payloads', () => {
  expect(clipboardImageData('data:image/png;base64,YQ==')).toBe('YQ==')
  expect(() => clipboardImageData('data:image/png;base64,')).toThrow(/No image/)
  expect(() => clipboardImageData('data:image/jpeg;base64,YQ==')).toThrow(/not supported/)
  expect(() => clipboardImageData('data:image/png;base64,' + 'A'.repeat(28_000_000))).toThrow(
    /too large/,
  )
})
