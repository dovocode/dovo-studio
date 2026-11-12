import { expect, it } from 'vite-plus/test'
import {
  composerModelReference,
  composerReferenceIcon,
  composerReferences,
  composerTextReferences,
} from './composer-references'
import type { ResourceSettings } from '../../shared/resources'
import { resolveScopedAgents } from '../../runtime/connection/scoped-settings'
import { runtimeDefaultsSchema } from '../../runtime/connection/runtime-setup'
import { decode } from '../../shared/schema'
import { defaultTaskHarness, type Repository } from '../../workspace'
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

it('identifies the file type and reference kind without adding a label prefix', () => {
  expect(
    ['App.tsx', 'package.json', 'README.md', '.env', 'logo.png', 'run.sh', 'unknown.bin'].map(
      (label) => composerReferenceIcon({ kind: 'file', label }),
    ),
  ).toEqual([
    'file-code',
    'file-data',
    'file-text',
    'file-config',
    'file-image',
    'file-terminal',
    'file-file',
  ])
  expect(composerReferenceIcon({ kind: 'skill', label: 'review' })).toBe('skill')
  expect(composerReferenceIcon({ kind: 'mcp', label: 'docs' })).toBe('mcp')
})

it('resolves built-in and scoped agent model references with the same settings as the picker', () => {
  const project: Repository = { id: 'project', name: 'Project', path: '/project', branch: 'main' }
  const defaults = decode(runtimeDefaultsSchema, {
    scopedSettings: {
      environment: { agents: [{ ...defaultTaskHarness('codex'), id: 'work', name: 'Work' }] },
      shared: [],
    },
  })
  const agents = resolveScopedAgents(defaults, project, [])
  expect(composerModelReference('model:agent%3Adovo%3Acodex/gpt', agents)?.provider).toBe('codex')
  expect(composerModelReference('model:agent%3Awork/gpt', agents)?.provider).toBe('codex')
  const overridden = resolveScopedAgents(
    defaults,
    { ...project, agents: [{ ...defaultTaskHarness('claude'), id: 'work', name: 'Work' }] },
    [],
  )
  expect(composerModelReference('model:agent%3Awork/gpt', overridden)?.provider).toBe('claude')
})
