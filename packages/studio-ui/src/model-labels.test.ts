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
it('notifies subscribed rows when catalog names change and stops after unsubscribe', () => {
  const labels = createModelLabels()
  const harness = { ...defaultTaskHarness('codex'), model: 'gpt-5.1-sol' }
  let updates = 0
  const unsubscribe = labels.subscribe(() => {
    updates++
  })
  const catalog = { models: [{ id: harness.model, name: 'GPT-5.1-Sol' }], reasoning: [] }
  labels.save('http://computer', harness, catalog)
  expect(labels.get('http://computer', harness)).toBe('GPT-5.1-Sol')
  expect(updates).toBe(1)
  labels.save('http://computer', harness, catalog)
  expect(updates).toBe(1)
  unsubscribe()
  labels.save('http://computer', harness, {
    ...catalog,
    models: [{ id: harness.model, name: 'Updated display name' }],
  })
  expect(updates).toBe(1)
})
