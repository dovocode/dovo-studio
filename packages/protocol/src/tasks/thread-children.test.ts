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

const botMetadata = {
  role: 'Coordinator',
  responsibilities: '',
  state: 'active',
  revision: '00000000-0000-0000-0000-000000000000',
  createdAt: '2026-11-15T08:00:00Z',
  updatedAt: '2026-11-15T08:00:00Z',
}

it('groups local routine workers and remote mention copies by runtime identity', () => {
  const bot = task('bot', { bot: botMetadata })
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
      tasks: [copy, unrelated, task('source'), task('foreign-worker', { botJob: worker.botJob })],
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
  expect(rows[0]).toMatchObject({ mentionSourceTitle: 'source' })
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

it('does not group Bot work under a known ordinary thread and keeps unresolved references', () => {
  const ordinary = task('parent')
  const worker = task('worker', { botJob: { botId: 'parent', runId: 'run' } })
  const conversation = task('conversation', {
    botConversation: { botId: 'parent', requestRevision: 'revision' },
  })
  const copy = task('copy', {
    botMention: {
      botId: 'parent',
      runtimeId: 'owner',
      sourceTaskId: 'original',
      sourceMessageId: 'input',
    },
    forkedFrom: { taskId: 'original', title: 'Saved source title' },
  })
  const parent = { id: 'parent', runtimeId: 'owner-profile', runtimeIdentity: 'owner' }
  const sender = { runtimeId: 'sender-profile', runtimeIdentity: 'sender', tasks: [copy] }
  const withoutParent = [{ ...parent, tasks: [worker, conversation] }, sender]
  const withParent = [{ ...parent, tasks: [ordinary, worker, conversation] }, sender]

  expect(threadChildren(withParent, parent)).toEqual([])
  expect(threadChildren(withoutParent, parent)).toMatchObject([
    { task: { id: 'conversation' } },
    { task: { id: 'copy' }, mentionSourceTitle: 'Saved source title' },
    { task: { id: 'worker' } },
  ])
  for (const child of [worker, conversation]) {
    expect(taskParentReference(child, parent.runtimeId, [ordinary], 'owner')).toBeUndefined()
    expect(taskParentReference(child, parent.runtimeId, [], 'owner')).toMatchObject({
      threadId: 'parent',
      title: 'Bot',
    })
  }
  expect(taskParentReference(copy, sender.runtimeId, [copy], 'sender', withParent)).toBeUndefined()
  expect(taskParentReference(copy, sender.runtimeId, [copy], 'sender', [])).toMatchObject({
    runtimeIdentity: 'owner',
    threadId: 'parent',
    title: 'Bot',
  })
})

it('keeps archived children after open ones and ignores self links', () => {
  const workers = ['a', 'b', 'bot'].map((id) =>
    task(id, {
      botJob: { botId: 'bot', runId: 'run' },
      ...(id === 'bot' ? { bot: botMetadata } : {}),
      ...(id === 'a' ? { archivedAt: '2026-11-15T09:00:00Z' } : {}),
    }),
  )
  expect(
    threadChildren([{ runtimeId: null, tasks: workers }], { runtimeId: null, id: 'bot' }).map(
      ({ task }) => task.id,
    ),
  ).toEqual(['b', 'a'])
})
