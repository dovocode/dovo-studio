import { expect, it } from 'vite-plus/test'
import { browserUserAgent } from './browser-user-agent'

const native = 'Mozilla/5.0 dovo-studio/0.0.9 Chrome/156.0.0.0 Electron/45.2.1 Safari/537.36'
const chrome = 'Mozilla/5.0 Chrome/156.0.0.0 Safari/537.36'

it.each([
  'https://web.whatsapp.com/',
  'https://teams.microsoft.com/v2/',
  'https://teams.cloud.microsoft/',
  'https://teams.live.com/',
])('uses the compatible identity only for %s', (url) => {
  expect(browserUserAgent(native, url)).toBe(chrome)
})

it.each([
  'https://solvegate.io/demo/managed',
  'https://challenges.cloudflare.com/',
  'https://www.google.com/search?q=test',
  'https://web.whatsapp.com.example.org/',
  'https://example.org/web.whatsapp.com',
  'https://login.microsoftonline.com/',
  'http://100.101.203.188:3000/',
  'about:blank',
  'file://web.whatsapp.com/index.html',
  '',
])('preserves native identity for %s', (url) => {
  expect(browserUserAgent(native, url)).toBe(native)
})
