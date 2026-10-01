import { expect, it } from 'vite-plus/test'
import { searchThread } from './thread-search'

it('finds prompts and replies case-insensitively in conversation order', () => {
  const messages = [
    { id: 'u', role: 'user' as const, text: 'Fix the BUILD' },
    { id: 'a', role: 'assistant' as const, text: 'The build passes' },
    { id: 'b', role: 'assistant' as const, text: 'Other work' },
  ]
  expect(searchThread(messages, ' build ').map((match) => match.id)).toEqual(['u', 'a'])
  expect(searchThread(messages, '   ')).toEqual([])
  expect(searchThread(messages, 'missing')).toEqual([])
})

it('previews text near a match in a long reply, including folded intermediate work', () => {
  const text = `${'earlier '.repeat(1000)}needle${' later'.repeat(1000)}`
  const results = searchThread([{ id: 'a', role: 'assistant', text }], 'needle')
  expect(results[0].preview).toContain('needle')
  expect(results[0].preview.startsWith('…')).toBe(true)
  expect(results[0].preview.length).toBeLessThan(200)
})
