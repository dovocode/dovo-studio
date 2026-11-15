import { expect, it } from 'vite-plus/test'
import { threadChildren } from './thread-children.js'
import { taskParentReference } from './thread-parent.js'
import { taskSchema } from '../workspace.js'
import { decode } from '../shared/schema.js'

const task = (id: string, fields = {}) =>
  decode(taskSchema, {
    id,
    title: id,
    repositoryId: '',
    agentId: '',
    status: 'review',
    createdAt: '2026-11-15T08:00:00Z',
    messages: [],
    files: [],
    draft: '',
    example: false,
    ...fields,
  })

it('groups local routine workers and remote mention copies by runtime identity', () => {
  const bot = task('bot')
  const worker = task('worker', { botJob: { botId: 'bot', runId: 'run' } })
  const copy = task('copy', {
    botMention: {
      botId: 'bot',
      runtimeId: 'owner',
      sourceTaskId: 'source',
      sourceMessageId: 'input',
    },
  })
  const unrelated = task('unrelated', { botMention: { ...copy.botMention, runtimeId: 'other' } })
  const sources = [
    { runtimeId: 'bot-profile', runtimeIdentity: 'owner', tasks: [bot, worker] },
    {
      runtimeId: 'source-profile',
      runtimeIdentity: 'sender',
      tasks: [copy, unrelated, task('foreign-worker', { botJob: worker.botJob })],
    },
  ]
  const rows = threadChildren(sources, {
    id: 'bot',
    runtimeId: 'bot-profile',
    runtimeIdentity: 'owner',
  })
  expect(rows.map((row) => [row.task.id, row.runtimeId])).toEqual([
    ['copy', 'source-profile'],
    ['worker', 'bot-profile'],
  ])
  expect(taskParentReference(copy, 'source-profile', [], 'sender', sources)).toMatchObject({
    runtimeId: 'bot-profile',
    runtimeIdentity: 'owner',
    threadId: 'bot',
  })
  expect(taskParentReference(worker, 'bot-profile', [bot], 'owner')).toMatchObject({
    threadId: 'bot',
    title: 'bot',
  })
  expect(threadChildren(sources, { id: 'bot', runtimeId: 'unverified-profile' })).toEqual([])
  expect(
    threadChildren([...sources, { ...sources[1]!, runtimeId: 'sender-alias' }], {
      id: 'bot',
      runtimeId: 'bot-profile',
      runtimeIdentity: 'owner',
    }),
  ).toHaveLength(2)
  expect(
    threadChildren([{ runtimeId: 'bot-profile', runtimeIdentity: 'other', tasks: [worker] }], {
      id: 'bot',
      runtimeId: 'bot-profile',
      runtimeIdentity: 'owner',
    }),
  ).toEqual([])
})

it('keeps archived children after open ones and ignores self links', () => {
  const workers = ['a', 'b', 'bot'].map((id) =>
    task(id, {
      botJob: { botId: 'bot', runId: 'run' },
      ...(id === 'a' ? { archivedAt: '2026-11-15T09:00:00Z' } : {}),
    }),
  )
  expect(
    threadChildren([{ runtimeId: null, tasks: workers }], { runtimeId: null, id: 'bot' }).map(
      ({ task }) => task.id,
    ),
  ).toEqual(['b', 'a'])
})
