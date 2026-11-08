import { randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import {
  decode,
  questionPromptSchema,
  type Attachment,
  type QuestionAttachmentIds,
} from '@dovo/protocol'
import { Questions } from './questions'
import type { Attachments } from '../../storage/attachments'
import { startRuntime } from '../../index'
import { fixture } from '../../testing/fixture'
import { WorkspaceStore } from '../../storage/workspace'
const prompt = decode(questionPromptSchema, {
  title: 'References',
  questions: [
    { id: 'design', header: 'Design', question: 'Attach the design' },
    { id: 'secret', header: 'Secret', question: 'Private', secret: true, required: false },
    {
      id: 'choice',
      header: 'Choice',
      question: 'Choice',
      custom: false,
      options: [{ value: 'yes', label: 'Yes' }],
      required: false,
    },
  ],
})
const file: Attachment = {
  id: randomUUID(),
  name: 'drawing "draft".txt',
  mime: 'text/plain',
  size: 3,
}
const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const close of cleanup.splice(0).reverse()) await close()
})
function setup() {
  const questions = new Questions({ add: () => undefined })
  const metadata = vi.fn<Attachments['metadata']>((task: string, ids: string[]) => {
    if (task !== 'owner' || ids.some((id) => id !== file.id))
      throw new Error('Attachment belongs to another task')
    return ids.map(() => file)
  })
  const materialize = vi.fn<Attachments['materialize']>(async () => ({
    ...file,
    path: '/private/attachments/design.txt',
    data: 'YWJj',
  }))
  questions.setAttachments({ metadata, materialize })
  return { questions, metadata, materialize }
}
it('supports file-only answers, quotes runtime-owned references and fingerprints the original response', async () => {
  const s = setup(),
    receipt = vi.fn<NonNullable<Parameters<Questions['request']>[4]>>()
  const pending = s.questions.request(
    'owner',
    prompt,
    new AbortController().signal,
    undefined,
    receipt,
  )
  const info = s.questions.list()[0]
  expect(info.attachments).toBe(true)
  await s.questions.respondWithAttachments(info.id, {}, { design: [file.id] })
  const answer = await pending
  expect(answer?.design).toEqual([
    `Attached file ${JSON.stringify(file.name)}: "/private/attachments/design.txt"`,
  ])
  expect(receipt.mock.calls[0][1].attachments).toEqual([file])
  await expect(
    s.questions.respondWithAttachments(info.id, {}, { design: [file.id] }),
  ).resolves.toBeUndefined()
  expect(s.materialize).toHaveBeenCalledTimes(1)
  await expect(
    s.questions.respondWithAttachments(info.id, { design: ['changed'] }, { design: [file.id] }),
  ).rejects.toThrow('differently')
})
it('rejects secret, fixed choice, unknown, duplicate, cross-task and declined attachments before resolving', async () => {
  const s = setup(),
    controller = new AbortController()
  const pending = s.questions.request('owner', prompt, controller.signal)
  const id = s.questions.list()[0].id
  const invalid: QuestionAttachmentIds[] = [
    { secret: [file.id] },
    { choice: [file.id] },
    { unknown: [file.id] },
    { design: [file.id], secret: [file.id] },
  ]
  for (const ids of invalid) {
    await expect(
      s.questions.respondWithAttachments(id, { design: ['answer'] }, ids),
    ).rejects.toThrow(/Files can only|Unknown question|distinct/)
  }
  await expect(s.questions.respondWithAttachments(id, null, { design: [file.id] })).rejects.toThrow(
    'Declined',
  )
  await expect(
    s.questions.respondWithAttachments(id, {}, { design: [randomUUID()] }),
  ).rejects.toThrow('another task')
  expect(s.materialize).not.toHaveBeenCalled()
  expect(s.questions.list()).toHaveLength(1)
  controller.abort()
  expect(await pending).toBeNull()
})
it('does not deliver an answer cancelled during asynchronous materialization', async () => {
  const s = setup(),
    controller = new AbortController(),
    received = vi.fn<NonNullable<Parameters<Questions['request']>[4]>>()
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  s.materialize.mockImplementationOnce(async () => {
    await held
    return { ...file, path: '/private/reference', data: 'YWJj' }
  })
  const pending = s.questions.request('owner', prompt, controller.signal, undefined, received)
  const response = s.questions.respondWithAttachments(
    s.questions.list()[0].id,
    {},
    { design: [file.id] },
  )
  controller.abort()
  release()
  expect(await pending).toBeNull()
  await expect(response).rejects.toThrow('cancelled')
  expect(received).not.toHaveBeenCalled()
})
it('keeps failed attachment admission retryable and persists attachment retention and replay across restart', async () => {
  const f = await fixture()
  cleanup.push(f.cleanup)
  const runtime = await startRuntime({
    databasePath: ':memory:',
    ownerToken: 'question-files-test-owner-token-at-least-32',
    port: 0,
  })
  cleanup.push(runtime.close)
  const s = runtime.services
  s.store.update(() => f.workspace)
  const task = s.tasks.create({
    title: 'Question files',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: '',
  })
  const uploaded = await s.attachments.uploadRecoverable('phone', {
    id: file.id,
    taskId: task.id,
    detached: true,
    name: file.name,
    data: 'YWJj',
  })
  const pending = s.questions.request(
    task.id,
    prompt,
    new AbortController().signal,
    undefined,
    (_answers, receipt) => {
      s.store.acceptQuestionResponse(task.id, receipt, {
        id: `answer:${receipt.id}`,
        taskId: task.id,
        attemptId: 'run',
        kind: 'answer',
        state: 'dispatched',
      })
    },
  )
  const id = s.questions.list()[0].id
  s.db.exec(
    "CREATE TRIGGER fail_file_answer BEFORE INSERT ON question_responses BEGIN SELECT RAISE(ABORT,'receipt failed'); END",
  )
  await expect(s.questions.respondWithAttachments(id, {}, { design: [file.id] })).rejects.toThrow(
    'receipt failed',
  )
  expect(s.questions.status(id)).toBe('pending')
  s.db.exec('DROP TRIGGER fail_file_answer')
  const accepted = await fetch(`http://127.0.0.1:${runtime.port}/api/tasks/answer`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer question-files-test-owner-token-at-least-32',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ id, answers: {}, attachmentIdsByQuestion: { design: [file.id] } }),
  })
  expect(accepted.status).toBe(200)
  await pending
  expect(s.store.questionAttachmentIds(task.id)).toEqual([file.id])
  s.attachments.acknowledgeUpload('phone', file.id)
  s.db.prepare('UPDATE queued_attachment_uploads SET created_at=0 WHERE id=?').run(file.id)
  await s.attachments.prune()
  expect(s.attachments.metadata(task.id, [file.id])).toEqual([uploaded.attachment])
  const reopened = new Questions(s.activity, new WorkspaceStore(s.db))
  // A durable retry must work without loading files or recreating the pending prompt.
  await expect(
    reopened.respondWithAttachments(id, {}, { design: [file.id] }),
  ).resolves.toBeUndefined()
  await expect(
    reopened.respondWithAttachments(id, { design: ['changed'] }, { design: [file.id] }),
  ).rejects.toThrow('differently')
})
it('migrates legacy answer receipts without changing their fingerprint or losing retries', async () => {
  const { default: Database } = await import('better-sqlite3')
  const { openDatabase } = await import('../../storage/database')
  const { join } = await import('node:path')
  const f = await fixture()
  cleanup.push(f.cleanup)
  const path = join(f.directory, 'legacy.sqlite'),
    legacy = new Database(path)
  legacy.exec(
    "CREATE TABLE question_responses (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, fingerprint TEXT NOT NULL); INSERT INTO question_responses VALUES ('old','task','fingerprint')",
  )
  legacy.close()
  const migrated = openDatabase(path)
  try {
    expect(
      migrated
        .prepare('SELECT fingerprint,attachments FROM question_responses WHERE id=?')
        .get('old'),
    ).toEqual({ fingerprint: 'fingerprint', attachments: null })
  } finally {
    migrated.close()
  }
})

it('coalesces concurrent identical replies without rematerializing files or delivering twice', async () => {
  const s = setup(),
    receipt = vi.fn<NonNullable<Parameters<Questions['request']>[4]>>()
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  s.materialize.mockImplementationOnce(async () => {
    await gate
    return { ...file, path: '/private/reference', data: 'YWJj' }
  })
  const pending = s.questions.request(
    'owner',
    prompt,
    new AbortController().signal,
    undefined,
    receipt,
  )
  const id = s.questions.list()[0].id
  const first = s.questions.respondWithAttachments(id, {}, { design: [file.id] })
  const duplicate = s.questions.respondWithAttachments(id, {}, { design: [file.id] })
  await expect(
    s.questions.respondWithAttachments(id, { design: ['changed'] }, { design: [file.id] }),
  ).rejects.toThrow('differently')
  expect(() => s.questions.respond(id, { design: ['other'] })).toThrow('being answered')
  release()
  await Promise.all([first, duplicate, pending])
  expect(s.materialize).toHaveBeenCalledTimes(1)
  expect(receipt).toHaveBeenCalledTimes(1)
})
it('finishes a pending provider answer after an admission callback failed after committing its receipt', async () => {
  const receipts = new Map<string, string>(),
    storage = setup()
  const questions = new Questions(
    { add: () => undefined },
    { questionResponse: (id) => receipts.get(id) },
  )
  questions.setAttachments({ metadata: storage.metadata, materialize: storage.materialize })
  let failed = false
  const pending = questions.request(
    'owner',
    prompt,
    new AbortController().signal,
    undefined,
    (_answers, receipt) => {
      receipts.set(receipt.id, receipt.fingerprint)
      if (!failed) {
        failed = true
        throw new Error('Delivery interrupted after commit')
      }
    },
  )
  const id = questions.list()[0].id
  await expect(questions.respondWithAttachments(id, {}, { design: [file.id] })).rejects.toThrow(
    'after commit',
  )
  expect(questions.status(id)).toBe('pending')
  await questions.respondWithAttachments(id, {}, { design: [file.id] })
  expect((await pending)?.design[0]).toContain('Attached file')
  expect(questions.status(id)).toBe('answered')
})
it('preserves multiple selected answers when adding a file reference', async () => {
  const s = setup()
  const pending = s.questions.request(
    'owner',
    { ...prompt, questions: [{ ...prompt.questions[0], multiple: true }] },
    new AbortController().signal,
  )
  await s.questions.respondWithAttachments(
    s.questions.list()[0].id,
    { design: ['first', 'second'] },
    { design: [file.id] },
  )
  expect((await pending)?.design).toEqual([
    'first',
    'second',
    expect.stringContaining('Attached file'),
  ])
})
