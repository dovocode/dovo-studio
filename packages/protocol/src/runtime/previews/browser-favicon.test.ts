import { expect, it } from 'vite-plus/test'
import { browserPageFavicon } from './browser-favicon.js'

it('retains cached icons while the same site loads, but clears them across origins and explicit failures', () => {
  const previous = { url: 'http://localhost:3000/page', favicon: 'data:image/png;base64,cached' }
  expect(browserPageFavicon(previous, 'http://localhost:3000/next#hash', undefined)).toBe(
    previous.favicon,
  )
  expect(browserPageFavicon(previous, 'http://localhost:3001/next', undefined)).toBeUndefined()
  expect(browserPageFavicon(previous, 'http://localhost:3000/page', null)).toBeUndefined()
  expect(browserPageFavicon(previous, 'http://localhost:3000/page', 'new-icon')).toBe('new-icon')
  expect(browserPageFavicon(previous, '', undefined)).toBeUndefined()
})
