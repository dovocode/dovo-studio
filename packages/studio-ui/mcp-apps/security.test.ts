import { expect, it } from 'vite-plus/test'
import { sources, csp, protectHtml } from './security'
it('accepts only HTTP origins and rejects CSP injection, credentials and paths', () => {
  expect(
    sources([
      'https://cdn.example.com',
      'http://127.0.0.1:9000',
      'https://*.example.com',
      'https://example.com; connect-src *',
      'https://user:password@example.com',
      'data:',
      'https://example.com/script.js',
    ]),
  ).toEqual(['https://cdn.example.com', 'http://127.0.0.1:9000', 'https://*.example.com'])
})
it('denies network and frames by default and inserts policy before guest markup', () => {
  const policy = csp({
    resourceDomains: ['https://cdn.example.com'],
    connectDomains: ["https://example.com' *"],
  })
  expect(policy).toContain("connect-src 'none'")
  expect(policy).toContain("frame-src 'none'")
  expect(policy).toContain('https://cdn.example.com')
  expect(
    protectHtml('<script>run()</script>', policy).indexOf('Content-Security-Policy'),
  ).toBeLessThan(protectHtml('<script>run()</script>', policy).indexOf('<script>'))
})
