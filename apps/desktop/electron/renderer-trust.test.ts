import { expect, it } from 'vite-plus/test'
import { trustedRendererUrl } from './renderer-trust'

it('only trusts the renderer document or configured development origin', () => {
  const path = '/app/dist/index.html'
  expect(trustedRendererUrl('file:///app/dist/index.html#settings', path)).toBe(true)
  expect(trustedRendererUrl('file:///app/dist/other.html', path)).toBe(false)
  expect(trustedRendererUrl('https://attacker.invalid', path)).toBe(false)
  expect(trustedRendererUrl('http://localhost:5173/settings', path, 'http://localhost:5173')).toBe(
    true,
  )
  expect(trustedRendererUrl('http://localhost:5174', path, 'http://localhost:5173')).toBe(false)
  expect(trustedRendererUrl('invalid', path)).toBe(false)
})
