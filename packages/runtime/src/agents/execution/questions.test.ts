import { decode } from '@dovo/protocol'
import { afterEach, expect, it } from 'vite-plus/test'
import { questionPromptSchema } from '@dovo/protocol'
import { startRuntime } from '../../index'
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
it('authenticates and validates background notification replies without bypassing the full form', async () => {
  const token = 'owner-token-at-least-thirty-two-characters'
  const r = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  cleanups.push(r.close)
  const pairedToken = 'paired-phone-token-at-least-twenty-characters'
  r.services.devices.add('Phone', pairedToken)
  const call = (
    id: string,
    value: string,
    patch: Record<string, unknown> = {},
    credential = token,
  ) =>
    fetch(`http://127.0.0.1:${r.port}/api/notifications/answer`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId: 'task', id, fieldId: 'choice', value, ...patch }),
    })
  const simple = { ...prompt, questions: [prompt.questions[0]] }
  const pending = r.services.questions.request('task', simple, new AbortController().signal)
  const id = r.services.questions.list()[0].id
  expect((await call(id, 'existing', {}, 'invalid')).status).toBe(401)
  expect((await call(id, 'existing', { taskId: 'another-thread' })).status).toBe(409)
  expect((await call(id, 'existing', { fieldId: 'unknown' })).status).toBe(409)
  expect((await call(id, 'custom')).status).toBe(400)
  expect((await call(id, 'existing', {}, pairedToken)).status).toBe(200)
  expect(await pending).toEqual({ choice: ['existing'] })
  expect((await call(id, 'existing')).status).toBe(200)
  expect((await call(id, 'different')).status).toBe(409)
  for (const questions of [
    prompt.questions,
    [{ ...simple.questions[0], secret: true }],
    [{ ...simple.questions[0], multiple: true }],
  ]) {
    const controller = new AbortController()
    const blocked = r.services.questions.request(
      'task',
      { ...prompt, questions },
      controller.signal,
    )
    const question = r.services.questions.list()[0]
    expect((await call(question.id, 'existing')).status).toBe(409)
    controller.abort()
    await blocked
  }
  const text = r.services.questions.request(
    'task',
    { title: 'Your label', questions: [{ ...simple.questions[0], options: [], custom: true }] },
    new AbortController().signal,
  )
  const textId = r.services.questions.list()[0].id
  expect((await call(textId, '   ')).status).toBe(400)
  expect((await call(textId, 'a label')).status).toBe(200)
  expect(await text).toEqual({ choice: ['a label'] })
  const cancelled = new AbortController()
  const stale = r.services.questions.request('task', simple, cancelled.signal)
  const staleId = r.services.questions.list()[0].id
  cancelled.abort()
  await stale
  expect((await call(staleId, 'existing')).status).toBe(409)
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
  const { WorkspaceStore } = await import('../../storage/workspace')
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
    "CREATE TRIGGER fail_form_acceptance BEFORE UPDATE ON workspace_tasks WHEN NEW.task_id = 'form-task' BEGIN SELECT RAISE(ABORT, 'SQLite unavailable'); END",
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

it('keeps secret questions human-controlled and falls back to a human if parent delivery fails', async () => {
  const { Questions } = await import('./questions')
  const questions = new Questions({ add: () => undefined })
  let delivered = 0
  questions.setRouting(
    () => true,
    () => {
      delivered++
      throw new Error('Parent inbox full')
    },
  )
  const controller = new AbortController()
  const secret = questions.request('child', prompt, controller.signal)
  const sensitive = questions.list()[0]
  expect(sensitive.routing).toBe('human')
  expect(delivered).toBe(0)
  expect(() =>
    questions.answerByParent('child', sensitive.id, { choice: ['existing'], secret: ['private'] }),
  ).toThrow('human')
  controller.abort()
  await secret
  const next = new AbortController()
  const regular = questions.request(
    'child',
    { ...prompt, questions: [prompt.questions[0]] },
    next.signal,
  )
  expect(delivered).toBe(1)
  expect(questions.list()[0].routing).toBe('human')
  next.abort()
  await regular
})

it('validates and receipts unanswered outcomes without weakening ordinary questions', async () => {
  const { vi } = await import('vite-plus/test')
  const token = 'owner-token-at-least-thirty-two-characters'
  const r = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  cleanups.push(r.close)
  const outcomes = vi.fn()
  const optional = {
    ...prompt,
    unanswered: true,
    questions: [{ ...prompt.questions[0], required: false }],
  }
  const pending = r.services.questions.request(
    'task',
    optional,
    new AbortController().signal,
    undefined,
    undefined,
    undefined,
    outcomes,
  )
  const id = r.services.questions.list()[0].id
  const call = (answers: unknown, outcome: unknown) =>
    fetch(`http://127.0.0.1:${r.port}/api/tasks/answer`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, answers, outcomes: outcome }),
    })
  expect((await call({}, { unknown: 'skipped' })).status).toBe(400)
  expect((await call({ choice: ['existing'] }, { choice: 'replied_in_chat' })).status).toBe(400)
  expect((await call({}, { choice: 'invented' })).status).toBe(400)
  expect((await call({}, { choice: 'replied_in_chat' })).status).toBe(200)
  expect(await pending).toEqual({})
  expect(outcomes).toHaveBeenCalledWith({ choice: 'replied_in_chat' })
  expect((await call({}, { choice: 'replied_in_chat' })).status).toBe(200)
  expect((await call({}, { choice: 'skipped' })).status).toBe(409)
  const cancelled = vi.fn()
  const controller = new AbortController()
  const stopped = r.services.questions.request(
    'task',
    optional,
    controller.signal,
    undefined,
    undefined,
    undefined,
    cancelled,
  )
  controller.abort()
  expect(await stopped).toBeNull()
  expect(cancelled).not.toHaveBeenCalled()
})

it('rejects a reused question key with different wording after the first answer', async () => {
  const r = await startRuntime({
    databasePath: ':memory:',
    ownerToken: 'owner-token-at-least-thirty-two-characters',
    port: 0,
  })
  cleanups.push(r.close)
  const questions = r.services.questions
  const simple = { ...prompt, questions: [prompt.questions[0]] }
  const key = 'tool-question:fixture-key'
  const first = questions.request(
    'task',
    simple,
    new AbortController().signal,
    undefined,
    undefined,
    key,
  )
  questions.respond(key, { choice: ['existing'] })
  expect(await first).toEqual({ choice: ['existing'] })
  // The same prompt under the same key is an idempotent retry.
  await expect(
    questions.request('task', simple, new AbortController().signal, undefined, undefined, key),
  ).resolves.toBeNull()
  expect(questions.list()).toEqual([])
  const reworded = {
    ...simple,
    questions: [{ ...simple.questions[0], question: 'Should this delete the old data?' }],
  }
  expect(() =>
    questions.request('task', reworded, new AbortController().signal, undefined, undefined, key),
  ).toThrow('already answered for a different question')
  expect(() =>
    questions.request('other', simple, new AbortController().signal, undefined, undefined, key),
  ).toThrow('already answered for a different question')
  expect(questions.list()).toEqual([])
  expect(questions.status(key)).toBe('answered')
})

it('keeps prompt identity in durable answer receipts after eviction and restart', async () => {
  const { Questions } = await import('./questions')
  const { WorkspaceStore } = await import('../../storage/workspace')
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
  const simple = { ...prompt, questions: [prompt.questions[0]] }
  const reworded = {
    ...simple,
    questions: [{ ...simple.questions[0], question: 'Should this delete the old data?' }],
  }
  const ask = (questions: InstanceType<typeof Questions>, key: string, value = simple) =>
    questions.request('form-task', value, new AbortController().signal, undefined, undefined, key)
  // The task-tool path: the receipt reaches the database through the queued answer.
  const queued = 'tool-question:queued'
  const first = s.questions.request(
    'form-task',
    simple,
    new AbortController().signal,
    undefined,
    (_answers, receipt) =>
      s.tasks.queue.add('form-task', `answer:${receipt.id}`, 'Answer', [], receipt),
    queued,
  )
  s.questions.respond(queued, { choice: ['existing'] })
  expect(await first).toEqual({ choice: ['existing'] })
  // The provider path: the receipt is written with its provider action.
  const direct = 'tool-question:direct'
  const second = s.questions.request(
    'form-task',
    simple,
    new AbortController().signal,
    undefined,
    (_answers, receipt) =>
      s.store.acceptQuestionResponse('form-task', receipt, {
        id: `answer:turn:${receipt.id}`,
        taskId: 'form-task',
        attemptId: 'turn',
        kind: 'answer',
        state: 'dispatched',
      }),
    direct,
  )
  s.questions.respond(direct, { choice: ['existing'] })
  expect(await second).toEqual({ choice: ['existing'] })
  for (const key of [queued, direct]) expect(s.store.questionPrompt(key)).toMatch(/^[0-9a-f]{64}$/)

  // Restart: a fresh instance has only the durable receipts.
  const restarted = new Questions(s.activity, new WorkspaceStore(s.db))
  for (const key of [queued, direct]) {
    await expect(ask(restarted, key)).resolves.toBeNull()
    expect(() => ask(restarted, key, reworded)).toThrow('already answered for a different question')
    expect(() =>
      restarted.request('other', simple, new AbortController().signal, undefined, undefined, key),
    ).toThrow('already answered for a different question')
  }
  expect(restarted.list()).toEqual([])

  // Eviction: 256 later answers push the keyed answer out of memory in the same instance.
  for (let index = 0; index < 256; index++) {
    const pending = s.questions.request('form-task', simple, new AbortController().signal)
    s.questions.respond(s.questions.list()[0].id, { choice: ['existing'] })
    await pending
  }
  await expect(ask(s.questions, queued)).resolves.toBeNull()
  expect(() => ask(s.questions, queued, reworded)).toThrow('for a different question')

  // A receipt from an older runtime has no identity, so a match cannot be confirmed either way.
  const legacy = 'tool-question:legacy'
  s.db
    .prepare(
      'INSERT INTO question_responses (id,task_id,fingerprint,attachments) VALUES (?, ?, ?, ?)',
    )
    .run(legacy, 'form-task', 'fingerprint', '[]')
  expect(s.store.questionPrompt(legacy)).toBeNull()
  expect(s.store.questionPrompt('tool-question:missing')).toBeUndefined()
  expect(() => ask(restarted, legacy)).toThrow('cannot confirm it was the same question')
  expect(() => ask(restarted, legacy, reworded)).toThrow('cannot confirm it was the same question')
  expect(restarted.status(legacy)).toBe('answered')
})

it('adds the prompt identity column to an older answer receipt table', async () => {
  const { default: Database } = await import('better-sqlite3')
  const { openDatabase } = await import('../../storage/database')
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const directory = await mkdtemp(join(tmpdir(), 'dovo-question-receipts-'))
  cleanups.push(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'runtime.db')
  const old = new Database(path)
  old.exec(
    'CREATE TABLE question_responses (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, fingerprint TEXT NOT NULL, attachments TEXT)',
  )
  old.prepare('INSERT INTO question_responses VALUES (?, ?, ?, ?)').run('old', 'task', 'f', '[]')
  old.close()
  const db = openDatabase(path)
  try {
    expect(db.prepare('SELECT id, fingerprint, prompt FROM question_responses').all()).toEqual([
      { id: 'old', fingerprint: 'f', prompt: null },
    ])
  } finally {
    db.close()
  }
})
