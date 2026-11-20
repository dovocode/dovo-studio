import { expect, it } from 'vite-plus/test'
import { taskSchema } from '../../workspace.js'
import { decode } from '../../shared/schema.js'
import { botMentionSuggestions, botMentionTargets, insertBotMention } from './bot-mentions.js'

it('keeps same-named Bots on different computers distinct and inserts only a reference', async () => {
  const bot = decode(taskSchema, {
    id: 'same',
    title: 'Release helper',
    repositoryId: '',
    agentId: '',
    status: 'review',
    createdAt: '2026-11-01T00:00:00Z',
    messages: [],
    files: [],
    draft: '',
    example: false,
    bot: {
      role: 'Releases',
      responsibilities: 'Private instructions',
      revision: '11111111-1111-4111-8111-111111111111',
      state: 'active',
      createdAt: '2026-11-01T00:00:00Z',
      updatedAt: '2026-11-01T00:00:00Z',
    },
  })
  const sources = ['mac', 'linux'].map((runtimeId) => ({
    runtimeId,
    name: runtimeId,
    tasks: [
      bot,
      { ...bot, id: 'archived', archivedAt: '2026-11-02T00:00:00Z' },
      { ...bot, id: 'normal', bot: undefined },
    ],
  }))
  const { contextMentionSuggestions, agentMentionSuggestions, insertAgentMention } =
    await import('./bot-mentions.js')
  const agent = { id: 'review/1', name: bot.title, provider: 'codex' as const }
  expect(contextMentionSuggestions(sources, 'release')).toEqual(
    botMentionSuggestions(sources, 'release'),
  )
  const [choice] = agentMentionSuggestions('mac/1', 'my project', [agent], 'release')
  expect(choice).toEqual({
    kind: 'agent',
    name: bot.title,
    detail: 'Agent · codex',
    reference: 'agent:mac%2F1/my%20project/review%2F1',
  })
  const inserted = insertAgentMention('Ask @re', 4, 7, choice)
  expect(inserted.text).toBe('Ask @Release helper (`agent:mac%2F1/my%20project/review%2F1`) ')
  expect(botMentionTargets(inserted.text)).toEqual([])
  const items = botMentionSuggestions(sources, 'release')
  expect(items.map((item) => item.reference).sort()).toEqual([
    'studio:linux:thread:same',
    'studio:mac:thread:same',
  ])
  expect(botMentionSuggestions(sources, 'mac')).toHaveLength(1)
  expect(JSON.stringify(items)).not.toContain('Private instructions')
  expect(insertBotMention('Ask @re please', 4, 7, items[0]).text).toBe(
    `Ask @Release helper (\`${items[0].reference}\`)  please`,
  )
})

it('extracts only explicit mentions in sent prose', () => {
  const mention = '@Dory (`studio:host-a:thread:dory`)'
  expect(botMentionTargets(`Ask ${mention} please`)).toEqual([
    { runtimeId: 'host-a', kind: 'thread', id: 'dory' },
  ])
  for (const text of [
    'studio:host-a:thread:dory',
    '@Dory',
    '@file:"notes/ @Dory (`studio:host-a:thread:dory`) file.md"',
    '```\n' + mention + '\n```',
    '# ' + mention,
    '[' + mention + '](https://example.com)',
    '@Browser (`studio:host-a:browser:dory`)',
  ])
    expect(botMentionTargets(text)).toEqual([])
})

it('finds older archived threads by title and inserts an escaped reference without history', async () => {
  const { contextMentionSuggestions, insertThreadMention } = await import('./bot-mentions.js')
  const task = decode(taskSchema, {
    id: 'old',
    title: 'Release [notes]',
    repositoryId: '',
    agentId: '',
    status: 'review',
    createdAt: '2026-01-01T00:00:00Z',
    messages: [{ id: 'private', role: 'user', text: 'private history' }],
    files: [],
    draft: '',
    example: false,
    archived: true,
  })
  const sources = [{ runtimeId: 'mac', name: 'Mac', tasks: [task] }]
  expect(contextMentionSuggestions(sources, '')).toEqual([])
  const items = contextMentionSuggestions(sources, 'thread:release')
  expect(items).toHaveLength(1)
  expect(items[0].detail).toContain('Archived')
  expect(JSON.stringify(items)).not.toContain('private history')
  const inserted = insertThreadMention('@thread:release', 0, 15, items[0]).text
  expect(inserted).toContain('[Release \\[notes\\]](dovo://thread?runtimeId=mac&threadId=old)')
  expect(botMentionTargets(inserted)).toEqual([])
})
