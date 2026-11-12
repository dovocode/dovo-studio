import { expect, it } from 'vite-plus/test'
import {
  composerModelReference,
  composerReferences,
  composerTextReferences,
} from './composer-references'
import type { ResourceSettings } from '../../shared/resources'
const resources: ResourceSettings = {
  skills: [{ name: 'review', enabled: true, description: 'Review', content: 'Review changes' }],
  mcpServers: [
    {
      name: 'docs',
      enabled: true,
      transport: 'stdio',
      command: 'docs',
      args: [],
      url: '',
      env: {},
      headerEnv: {},
      bearerTokenEnv: '',
    },
  ],
}
it('recognizes completed references with UTF-16 source offsets, without changing the draft', () => {
  const text = '🚀 @src/file.ts $review @docs `model:harness%3Acodex/gpt%2Fexact` '
  const references = composerReferences(text, resources)
  expect(
    references.map((reference) => [
      reference.kind,
      reference.label,
      text.slice(reference.start, reference.end),
    ]),
  ).toEqual([
    ['file', 'file.ts', '@src/file.ts'],
    ['skill', 'review', '$review'],
    ['mcp', 'docs', '@docs'],
    ['model', 'gpt/exact', '`model:harness%3Acodex/gpt%2Fexact`'],
  ])
})
it('leaves typing, email, unknown names, code, links and malformed models as text', () => {
  expect(composerTextReferences('@src/file.ts', resources)).toEqual([])
  for (const text of [
    'person@example.com @person $other ',
    '`@src/file.ts `',
    '# Heading @src/file.ts here',
    '[`model:codex/gpt`](https://example.com)',
    '```ts\n@src/file.ts \n```',
    '[@src/file.ts ](https://example.com)',
    '`model:%ZZ/model`',
    '`model:host/%00`',
  ])
    expect(composerReferences(text, resources)).toEqual([])
})

it('keeps complete paths containing Markdown punctuation', () => {
  const text = 'Read @src/__tests__/my_file.ts please'
  const [reference] = composerReferences(text, resources)
  expect(text.slice(reference.start, reference.end)).toBe('@src/__tests__/my_file.ts')
  expect(reference.label).toBe('my_file.ts')
})

it('uses the referenced harness for model icons, including custom agents and ACP installs', () => {
  const agents = [{ id: 'work', provider: 'claude' as const }]
  for (const [harness, provider] of [
    ['harness:codex', 'codex'],
    ['harness:opencode', 'opencode'],
    ['agent:work', 'claude'],
    ['acp:my-install', 'acp'],
  ]) {
    const reference = `model:${encodeURIComponent(harness)}/same-model`
    expect(composerModelReference(reference, agents)?.provider).toBe(provider)
    const source = `Use \`${reference}\` please`
    const [chip] = composerReferences(source, { ...resources, agents })
    expect(chip.provider).toBe(provider)
    expect(source.slice(chip.start, chip.end)).toBe(`\`${reference}\``)
  }
  // An unknown or removed harness keeps its model text without a guessed brand.
  expect(composerModelReference('model:agent%3Amissing/same-model', agents)).toEqual({
    start: 0,
    end: 32,
    kind: 'model',
    label: 'same-model',
  })
  expect(composerModelReference('model:harness%3Aunknown/same-model')?.provider).toBeUndefined()
})
