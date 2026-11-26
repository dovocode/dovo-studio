import { expect, it } from 'vite-plus/test'
import {
  modelMentionContext,
  modelMentionReference,
  insertModelMention,
  matchingModelMentions,
} from './model-mentions'
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

it('ignores inline model IDs inside explicit filenames', () => {
  expect(modelMentionContext('@file:"notes/`model:harness%3Acodex/gpt` summary"')).toBe('')
})

it('passes a model from a saved draft with its separator inside inline code', () => {
  const normal = '`model:harness%3Aclaude/opus`'
  const saved = '`model:harness%3Aclaude/opus `'
  const context = modelMentionContext(saved)
  expect(context).toContain('{"harness":"harness:claude","model":"opus"}')
  expect(modelMentionContext(`${normal} and ${saved}`)).toBe(context)
  expect(modelMentionContext('`model:harness%3Aclaude/opus other text`')).toBe('')
  expect(modelMentionContext('model:harness%3Aclaude/opus')).toBe('')
})
