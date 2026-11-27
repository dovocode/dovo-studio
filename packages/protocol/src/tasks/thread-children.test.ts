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

it('shows an old mention copy under its caller on the sending computer', () => {
  const copy = task('copy', {
    botMention: {
      botId: 'bot',
      runtimeId: 'owner',
      sourceTaskId: 'source',
      sourceMessageId: 'input',
    },
    forkedFrom: { taskId: 'source', title: 'Saved source title' },
  })
  const owner = {
    runtimeId: 'bot-profile',
    runtimeIdentity: 'owner',
    tasks: [task('bot', { bot: botMetadata }), task('source')],
  }
  const sender = {
    runtimeId: 'caller-profile',
    runtimeIdentity: 'sender',
    tasks: [copy, task('source')],
  }
  expect(threadChildren([owner, sender], { ...owner, id: 'bot' })).toEqual([])
  expect(threadChildren([owner, sender], { ...owner, id: 'source' })).toEqual([])
  expect(
    threadChildren([owner, sender, { ...sender, runtimeId: 'alias' }], { ...sender, id: 'source' }),
  ).toMatchObject([
    { task: { id: 'copy' }, runtimeId: 'caller-profile', mentionSourceTitle: 'source' },
  ])
  expect(taskParentReference(copy, sender.runtimeId, [], 'sender', [owner])).toMatchObject({
    runtimeId: 'caller-profile',
    runtimeIdentity: 'sender',
    threadId: 'source',
    title: 'Saved source title',
  })
})

it('shows a Bot call under the receiving Bot and preserves the cross-computer caller link', () => {
  const bot = task('bot', { bot: botMetadata })
  const call = task('call', {
    botMention: {
      botId: 'bot',
      runtimeId: 'destination',
      sourceRuntimeId: 'caller',
      sourceTaskId: 'bot',
      sourceMessageId: 'input',
      sourceTitle: 'Saved caller',
    },
  })
  const self = task('self', { botMention: { ...call.botMention, sourceRuntimeId: 'destination' } })
  const owner = {
    runtimeId: 'destination-profile',
    runtimeIdentity: 'destination',
    tasks: [bot, call, self],
  }
  const caller = { runtimeId: 'caller-profile', runtimeIdentity: 'caller', tasks: [bot] }
  expect(threadChildren([owner, caller], { ...owner, id: 'bot' })).toMatchObject([
    { task: { id: 'call' }, runtimeId: 'destination-profile' },
    { task: { id: 'self' }, runtimeId: 'destination-profile' },
  ])
  expect(threadChildren([owner, caller], { ...caller, id: 'bot' })).toMatchObject([
    { task: { id: 'call' }, runtimeId: 'destination-profile' },
  ])
  expect(
    taskParentReference(call, owner.runtimeId, owner.tasks, 'destination', [caller]),
  ).toMatchObject({
    runtimeId: 'caller-profile',
    threadId: 'bot',
  })
  expect(taskParentReference(call, owner.runtimeId, owner.tasks, 'destination')).toMatchObject({
    runtimeIdentity: 'caller',
    title: 'Saved caller',
  })
})

it('keeps routine workers and saved conversations with their Bot', () => {
  const ordinary = task('parent')
  const worker = task('worker', { botJob: { botId: 'parent', runId: 'run' } })
  const conversation = task('conversation', {
    botConversation: { botId: 'parent', requestRevision: 'revision' },
  })
  const parent = { id: 'parent', runtimeId: 'owner-profile', runtimeIdentity: 'owner' }
  const tasks = [worker, conversation]
  expect(threadChildren([{ ...parent, tasks: [ordinary, ...tasks] }], parent)).toEqual([])
  expect(threadChildren([{ ...parent, tasks }], parent)).toMatchObject([
    { task: { id: 'conversation' } },
    { task: { id: 'worker' } },
  ])
  for (const child of tasks) {
    expect(taskParentReference(child, parent.runtimeId, [ordinary], 'owner')).toBeUndefined()
    expect(taskParentReference(child, parent.runtimeId, [], 'owner')).toMatchObject({
      threadId: 'parent',
      title: 'Bot',
    })
  }
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
