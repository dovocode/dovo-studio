import { expect, it } from 'vite-plus/test'
import { decode } from '@dovo/protocol'
import { productHelp, productHelpSchema } from './product-help.js'

it('returns bounded installed sections with version and source references', () => {
  const found = productHelp({ taskId: 'test', action: 'search', query: 'Bot routines' })
  if (!('results' in found)) throw new Error('Expected search results')
  expect(found.results.length).toBeGreaterThan(0)
  expect(found.results.length).toBeLessThanOrEqual(5)
  expect(found.version).toBeTruthy()
  expect(found.revision).toBeTruthy()
  for (const hit of found.results) {
    expect(hit.excerpt.length).toBeLessThanOrEqual(400)
    expect(hit.source).toMatch(/^docs\/[\w-]+\.md$/)
    const section = productHelp({ taskId: 'test', action: 'read', id: hit.id })
    if (!('text' in section)) throw new Error('Expected section')
    expect(section.text.length).toBeLessThanOrEqual(8000)
    expect(section.title).toBe(hit.title)
  }
})

it('rejects arbitrary files and invalid offsets without reading user content', () => {
  expect(() => productHelp({ taskId: 'test', action: 'read', id: '../../secret' })).toThrow(
    'not found',
  )
  expect(() => productHelp({ taskId: 'test', action: 'search', query: ' ' })).toThrow('query')
  expect(() => decode(productHelpSchema, { taskId: 'test', action: 'read', offset: -1 })).toThrow(
    Error,
  )
})
