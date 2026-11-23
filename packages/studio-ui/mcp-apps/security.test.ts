/// <reference types="node" />

import { webcrypto } from 'node:crypto'
import { runInNewContext } from 'node:vm'
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

it('gives guest code Web Crypto UUIDs on HTTP and preserves a native UUID method', () => {
  const html = protectHtml('<script>crypto.randomUUID()</script>', csp(undefined))
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  const guestCrypto = { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) }
  const run = (crypto: object) => {
    const context = { crypto }
    return scripts.map(([, script]) => runInNewContext(script, context)).at(-1)
  }
  const id = run(guestCrypto)
  expect(id).toMatch(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/)
  expect(run(guestCrypto)).not.toBe(id)
  const native = () => 'native UUID'
  expect(run({ randomUUID: native })).toBe('native UUID')
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
