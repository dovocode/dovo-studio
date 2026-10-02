import { expect, it } from 'vite-plus/test'
import { defaultTaskHarness } from '@dovo/protocol'
import { createModelLabels } from './model-labels'
it('retains catalog display names after reopening and reload without saving credentials', () => {
  let saved = ''
  const storage = {
    getItem: () => saved || null,
    setItem: (_key: string, value: string) => {
      saved = value
    },
  }
  const harness = {
    ...defaultTaskHarness('codex'),
    model: 'gpt-6.1-sol',
    args: ['--api-key', 'private-value'],
  }
  const labels = createModelLabels(storage)
  labels.save('http://computer', harness, {
    models: [{ id: harness.model, name: 'GPT-6.1 Sol' }],
    reasoning: [],
  })
  expect(createModelLabels(storage).get('http://computer', harness)).toBe('GPT-6.1 Sol')
  expect(saved).not.toContain('private-value')
  expect(labels.get('http://other-computer', harness)).toBeUndefined()
  expect(labels.get('http://computer', { ...harness, provider: 'opencode' })).toBeUndefined()
})
it('recovers from corrupt or unavailable storage and retains in-memory names', () => {
  const labels = createModelLabels({
    getItem: () => '{bad',
    setItem: () => {
      throw new Error('Full')
    },
  })
  const harness = { ...defaultTaskHarness('codex'), model: 'custom' }
  labels.save(undefined, harness, {
    models: [{ id: 'custom', name: 'My custom model' }],
    reasoning: [],
  })
  expect(labels.get(undefined, harness)).toBe('My custom model')
})
