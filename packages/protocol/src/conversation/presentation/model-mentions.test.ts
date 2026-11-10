import { expect, it } from 'vite-plus/test'
import { modelMentionReference, insertModelMention, matchingModelMentions } from './model-mentions'
it('matches model family prefixes and keeps provider instance identities distinct', () => {
  const models = [
    {
      reference: modelMentionReference('harness:claude', 'claude-opus/4.7'),
      provider: 'Claude',
      model: 'claude-opus/4.7',
      name: 'Claude Opus 4.7',
    },
    {
      reference: modelMentionReference('profile:work', 'gpt/6'),
      provider: 'Work Codex',
      model: 'gpt/6',
      name: 'GPT 6',
    },
  ]
  expect(matchingModelMentions(models, 'op')).toEqual([models[0]])
  expect(matchingModelMentions(models, 'claude-opus')).toEqual([models[0]])
  expect(matchingModelMentions(models, 'gpt')).toEqual([models[1]])
  expect(matchingModelMentions(models, 'g')).toEqual([])
  expect(models[0].reference).toBe('model:harness%3Aclaude/claude-opus%2F4.7')
  const inserted = insertModelMention('Ask @op about this', 4, 7, models[0].reference)
  expect(inserted.text).toContain('Ask `model:harness%3Aclaude/claude-opus%2F4.7` ')
  expect(inserted.text).toContain('about this')
})
