import { expect, it } from 'vite-plus/test'
import { taskSchema } from '../../workspace.js'
import { decode } from '../../shared/schema.js'
import { botMentionSuggestions, insertBotMention } from './bot-mentions.js'

it('keeps same-named Bots on different computers distinct and inserts only a reference', () => {
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
