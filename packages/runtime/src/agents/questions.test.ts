import { decode } from '@dovo/protocol'
import { afterEach, expect, it } from 'vitest'
import { questionPromptSchema } from '@dovo/protocol'
import { startRuntime } from '../index'
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})
const prompt = decode(questionPromptSchema, {
  title: 'Choose an approach',
  questions: [
    {
      id: 'choice',
      header: 'Approach',
      question: 'How should this work?',
      options: [
        {
          value: 'existing',
          label: 'Existing',
        },
      ],
      custom: false,
    },
    {
      id: 'secret',
      header: 'Secret',
      question: 'Private value',
      secret: true,
    },
  ],
})
it('validates answers, accepts identical retries, rejects conflicting replies, and redacts secrets', async () => {
  const r = await startRuntime({
    databasePath: ':memory:',
    ownerToken: 'owner-token-at-least-thirty-two-characters',
    port: 0,
  })
  cleanups.push(r.close)
  const pending = r.services.questions.request('task', prompt, new AbortController().signal)
  const id = r.services.questions.list()[0].id
  expect(() =>
    r.services.questions.respond(id, {
      choice: ['other'],
    }),
  ).toThrow('available option')
  expect(() =>
    r.services.questions.respond(id, {
      choice: ['existing'],
    }),
  ).toThrow('Secret')
  expect(r.services.questions.list()).toHaveLength(1)
  const call = (token: string) =>
    fetch(`http://127.0.0.1:${r.port}/api/tasks/answer`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        id,
        answers: {
          choice: ['existing'],
          secret: ['sensitive-fixture-value'],
        },
      }),
    })
  expect((await call('invalid')).status).toBe(401)
  expect((await call('owner-token-at-least-thirty-two-characters')).status).toBe(200)
  expect(await pending).toEqual({
    choice: ['existing'],
    secret: ['sensitive-fixture-value'],
  })
  expect((await call('owner-token-at-least-thirty-two-characters')).status).toBe(200)
  expect(() => r.services.questions.respond(id, null)).toThrow('already answered')
  expect(r.services.questions.list()).toEqual([])
  const history = r.services.activity.list('', '', 0).events
  expect(JSON.stringify(history)).not.toContain('sensitive-fixture-value')
  expect(history.filter((e) => e.kind === 'question')).toHaveLength(1)
  expect(history.find((e) => e.kind === 'question')?.payload).toContain('answered')
})
it('cancels pending questions on abort and runtime shutdown without inventing answers', async () => {
  const r = await startRuntime({
    databasePath: ':memory:',
    ownerToken: 'owner-token-at-least-thirty-two-characters',
    port: 0,
  })
  const controller = new AbortController()
  const first = r.services.questions.request('task', prompt, controller.signal)
  controller.abort()
  expect(await first).toBeNull()
  expect(r.services.questions.list()).toEqual([])
  const second = r.services.questions.request('task', prompt, new AbortController().signal)
  await r.close()
  expect(await second).toBeNull()
})

it('keeps failed form admission retryable and retains durable answer receipts across restart', async () => {
  const { Questions } = await import('./questions')
  const { WorkspaceStore } = await import('../storage/workspace')
  const r = await startRuntime({
    databasePath: ':memory:',
    ownerToken: 'owner-token-at-least-thirty-two-characters',
    port: 0,
  })
  cleanups.push(r.close)
  const s = r.services
  s.store.update((w) => ({
    ...w,
    tasks: [
      {
        id: 'form-task',
        title: 'Form',
        repositoryId: 'repo',
        agentId: 'agent',
        status: 'draft',
        createdAt: '',
        messages: [],
        files: [],
        draft: '',
        example: false,
        queuePaused: true,
      },
    ],
  }))
  const answers = { choice: ['existing'], secret: ['private-answer'] }
  const pending = s.questions.request(
    'form-task',
    prompt,
    new AbortController().signal,
    undefined,
    (_answers, receipt) => {
      s.tasks.queue.add('form-task', `answer:${receipt.id}`, 'Answer delivered', [], receipt)
    },
  )
  const id = s.questions.list()[0].id
  s.db.exec(
    "CREATE TRIGGER fail_form_acceptance BEFORE UPDATE ON documents WHEN NEW.id = 'workspace' BEGIN SELECT RAISE(ABORT, 'SQLite unavailable'); END",
  )
  expect(() => s.questions.respond(id, answers)).toThrow('SQLite unavailable')
  expect(s.questions.list()).toHaveLength(1)
  expect(s.store.questionResponse(id)).toBeUndefined()
  expect(s.store.task('form-task').queue).toBeUndefined()
  expect(s.store.taskSubmission('form-task', `answer:${id}`)).toBeUndefined()
  s.db.exec('DROP TRIGGER fail_form_acceptance')
  s.questions.respond(id, answers)
  expect(await pending).toEqual(answers)
  expect(s.store.task('form-task').queue).toHaveLength(1)
  const recovered = new WorkspaceStore(s.db)
  const questions = new Questions(s.activity, recovered)
  expect(() => questions.respond(id, answers)).not.toThrow()
  expect(() => questions.respond(id, { ...answers, secret: ['changed'] })).toThrow('differently')
  expect(recovered.task('form-task').queue).toHaveLength(1)
  expect(s.store.questionResponse(id)).not.toContain('private-answer')
})
