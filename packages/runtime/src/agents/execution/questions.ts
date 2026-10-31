import { decode } from '@dovo/protocol'
import { randomUUID, createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import {
  questionPromptSchema,
  questionAnswersSchema,
  questionAnswerError,
  questionAllowsAttachments,
  questionAttachmentIdsSchema,
  type QuestionAttachmentIds,
  type Attachment,
  type QuestionPrompt,
  type QuestionAnswers,
  type PendingQuestion,
  notificationQuestion,
  type NotificationAnswer,
} from '@dovo/protocol'
import type { Activity } from '../../storage/activity.js'
import type { Attachments } from '../../storage/attachments.js'
import { HttpError } from '../../errors.js'
type ResponseReceipt = { id: string; fingerprint: string; attachments?: Attachment[] }
type Pending = {
  info: PendingQuestion
  finish: (answers: QuestionAnswers | null, status: string, receipt?: ResponseReceipt) => void
  validate?: (answers: QuestionAnswers) => void
}
function answerFingerprint(
  answers: QuestionAnswers | null,
  attachments: QuestionAttachmentIds = {},
) {
  const files = Object.entries(attachments)
    .filter(([, ids]) => ids.length)
    .sort(([a], [b]) => a.localeCompare(b))
  const sorted = answers && Object.entries(answers).sort(([a], [b]) => a.localeCompare(b))
  return createHash('sha256')
    .update(JSON.stringify(files.length ? { answers: sorted, attachments: files } : sorted))
    .digest('hex')
}
export class Questions {
  private answered = new Map<string, string>()
  private requests = new Map<string, Pending>()
  private responding = new Map<string, { fingerprint: string; promise: Promise<void> }>()
  constructor(
    private activity: Pick<Activity, 'add'>,
    private receipts?: { questionResponse: (id: string) => string | undefined },
  ) {}
  private attachments?: Pick<Attachments, 'metadata' | 'materialize'>
  setAttachments(attachments: Pick<Attachments, 'metadata' | 'materialize'>) {
    this.attachments = attachments
  }
  private route?: (taskId: string) => boolean
  private notificationOwner?: (taskId: string) => string
  private routed?: (question: PendingQuestion) => void
  setRouting(
    route: (taskId: string) => boolean,
    routed: (question: PendingQuestion) => void,
    notificationOwner?: (taskId: string) => string,
  ) {
    this.notificationOwner = notificationOwner
    this.route = route
    this.routed = routed
  }
  /** Only ordinary questions may be answered by a coordinating agent. */
  answerByParent(taskId: string, id: string, answers?: QuestionAnswers) {
    const request = this.requests.get(id)
    if (!request && answers) {
      this.respond(id, answers)
      return
    }
    if (!request || request.info.taskId !== taskId)
      throw new HttpError(409, 'This child question is no longer pending')
    if (!answers && request.info.routing === 'human') return
    if (request.info.routing !== 'parent' || request.info.prompt.questions.some((q) => q.secret))
      throw new HttpError(403, 'This question requires a human response')
    if (answers) this.respond(id, answers)
    else {
      request.info = { ...request.info, routing: 'human' }
      this.activity.add(
        'question',
        taskId,
        request.info.prompt.title,
        { ...request.info, status: 'requested' },
        `question:${id}`,
      )
    }
  }
  list() {
    return [...this.requests.values()].map((r) => r.info)
  }
  status(id: string) {
    return this.requests.has(id)
      ? 'pending'
      : this.answered.has(id) || this.receipts?.questionResponse(id)
        ? 'answered'
        : undefined
  }
  request(
    taskId: string,
    value: QuestionPrompt,
    signal: AbortSignal,
    validate?: (answers: QuestionAnswers) => void,
    onResponse?: (answers: QuestionAnswers | null, receipt: ResponseReceipt) => void,
    requestId?: string,
  ) {
    if (signal.aborted) return Promise.resolve(null)
    const prompt = decode(questionPromptSchema, value),
      id = requestId ?? randomUUID()
    // Stable IDs are used by fire-and-forget task-tool forms. Retrying registration
    // never opens a second card or delivers a second follow-up.
    if (requestId) {
      const existing = this.requests.get(id)
      if (existing) {
        if (existing.info.taskId !== taskId || !isDeepStrictEqual(existing.info.prompt, prompt))
          throw new HttpError(409, 'This question key is already in use. Use a new key.')
        return Promise.resolve(null)
      }
      if (this.status(id) === 'answered') return Promise.resolve(null)
    }
    const info: PendingQuestion = {
      id,
      taskId,
      prompt,
      createdAt: new Date().toISOString(),
      ...(this.attachments && prompt.questions.some(questionAllowsAttachments)
        ? { attachments: true }
        : {}),
      ...(this.route?.(taskId)
        ? {
            routing: prompt.questions.some((q) => q.secret)
              ? ('human' as const)
              : ('parent' as const),
          }
        : {}),
    }
    this.activity.add(
      'question',
      taskId,
      prompt.title,
      {
        ...info,
        status: 'requested',
      },
      `question:${id}`,
    )
    return new Promise<QuestionAnswers | null>((resolve) => {
      const finish = (
        answers: QuestionAnswers | null,
        status: string,
        receipt?: ResponseReceipt,
      ) => {
        if (!this.requests.has(id)) return
        // Admission must succeed before resolving or remembering the response.
        const accepted = receipt ?? { id, fingerprint: answerFingerprint(answers) }
        if (status !== 'cancelled') onResponse?.(answers, accepted)
        const logged =
          answers &&
          Object.fromEntries(
            prompt.questions.map((q) => [q.id, q.secret ? ['[redacted]'] : (answers[q.id] ?? [])]),
          )
        // The agent waits on this promise: a failed audit write must not leave it waiting.
        try {
          this.activity.add(
            'question',
            taskId,
            prompt.title,
            {
              ...info,
              answers: logged,
              status,
              resolvedAt: new Date().toISOString(),
            },
            `question:${id}`,
          )
        } catch (error) {
          console.error('Could not record question response', error)
        }
        if (status !== 'cancelled') {
          this.answered.set(id, accepted.fingerprint)
          if (this.answered.size > 256) this.answered.delete(this.answered.keys().next().value!)
        }
        this.requests.delete(id)
        signal.removeEventListener('abort', abort)
        resolve(answers)
      }
      // Abort listeners have no caller to report to; a throw there is fatal.
      const abort = () => {
        try {
          finish(null, 'cancelled')
        } catch (error) {
          console.error('Question cleanup failed', error)
        }
      }
      this.requests.set(id, {
        info,
        finish,
        validate,
      })
      signal.addEventListener('abort', abort, {
        once: true,
      })
      if (signal.aborted) abort()
      else if (info.routing === 'parent') {
        try {
          this.routed?.(info)
        } catch (error) {
          // A full/stopped coordinator must never strand a question hidden from the human.
          this.requests.get(id)!.info = { ...info, routing: 'human' }
          console.error('Could not route child question to parent', error)
        }
      }
    })
  }
  respond(id: string, value: QuestionAnswers | null) {
    if (this.responding.has(id)) throw new HttpError(409, 'This question is already being answered')
    const request = this.requests.get(id)
    const answers = value === null ? null : decode(questionAnswersSchema, value)
    const receipt = this.receipts?.questionResponse(id)
    if (receipt) {
      if (receipt !== answerFingerprint(answers))
        throw new HttpError(409, 'This question was already answered differently')
      if (request) request.finish(answers, answers ? 'answered' : 'declined')
      return
    }
    if (!request) {
      if (this.answered.get(id) === answerFingerprint(answers)) return
      throw new HttpError(409, 'This question was already answered or cancelled')
    }
    if (answers) {
      const error = questionAnswerError(request.info.prompt.questions, answers)
      if (error) throw new HttpError(400, error)
      request.validate?.(answers)
    }
    request.finish(answers, answers ? 'answered' : 'declined')
  }
  async respondWithAttachments(
    id: string,
    value: QuestionAnswers | null,
    files: QuestionAttachmentIds = {},
  ) {
    const ids = decode(questionAttachmentIdsSchema, files)
    if (!Object.values(ids).some((values) => values.length)) return this.respond(id, value)
    if (value === null) throw new HttpError(400, 'Declined answers cannot contain files')
    const answers = decode(questionAnswersSchema, value)
    const fingerprint = answerFingerprint(answers, ids)
    const previous = this.responding.get(id)
    if (previous) {
      if (previous.fingerprint !== fingerprint)
        throw new HttpError(409, 'This question is already being answered differently')
      return previous.promise
    }
    const promise = this.respondFiles(id, answers, ids, fingerprint)
    this.responding.set(id, { fingerprint, promise })
    try {
      await promise
    } finally {
      if (this.responding.get(id)?.promise === promise) this.responding.delete(id)
    }
  }
  private async respondFiles(
    id: string,
    answers: QuestionAnswers,
    ids: QuestionAttachmentIds,
    fingerprint: string,
  ) {
    const replay = () => {
      const previous = this.receipts?.questionResponse(id) ?? this.answered.get(id)
      if (!previous) return false
      if (previous !== fingerprint)
        throw new HttpError(409, 'This question was already answered differently')
      return true
    }
    const accepted = replay()
    const request = this.requests.get(id)
    if (!request) {
      if (accepted) return
      throw new HttpError(409, 'This question was already answered or cancelled')
    }
    const invalid = questionAnswerError(request.info.prompt.questions, answers, ids)
    if (invalid) throw new HttpError(400, invalid)
    const storage = this.attachments
    if (!storage) throw new HttpError(409, 'Question attachments are not supported')
    const attached = Object.entries(ids).map(([questionId, fileIds]) => ({
      questionId,
      files: storage.metadata(request.info.taskId, fileIds),
    }))
    const result = new Map(Object.entries(answers))
    // Resolve paths on the owning runtime; callers never supply filesystem paths.
    for (const group of attached) {
      const references: string[] = []
      for (const file of group.files) {
        const materialized = await storage.materialize(request.info.taskId, file)
        references.push(
          `Attached file ${JSON.stringify(file.name)}: ${JSON.stringify(materialized.path)}`,
        )
      }
      if (references.length) {
        const values = Object.hasOwn(answers, group.questionId) ? answers[group.questionId] : []
        const question = request.info.prompt.questions.find((q) => q.id === group.questionId)!
        result.set(
          group.questionId,
          question.multiple
            ? [...values, references.join('\n')]
            : [[...values, ...references].join('\n')],
        )
      }
    }
    if (replay() && this.requests.get(id) !== request) return
    if (this.requests.get(id) !== request)
      throw new HttpError(409, 'This question was already answered or cancelled')
    const resolved = Object.fromEntries(result)
    request.validate?.(resolved)
    request.finish(resolved, 'answered', {
      id,
      fingerprint,
      attachments: attached.flatMap((group) => group.files),
    })
  }
  respondNotification(input: NotificationAnswer) {
    const request = this.requests.get(input.id)
    if (request) {
      const question = notificationQuestion(request.info.prompt)
      if (
        (request.info.taskId !== input.taskId &&
          this.notificationOwner?.(request.info.taskId) !== input.taskId) ||
        !question ||
        question.fieldId !== input.fieldId
      )
        throw new HttpError(409, 'Open this question in Dovo to answer')
      if (question.mode === 'choice' && !question.choices.some((o) => o.value === input.value))
        throw new HttpError(400, 'Choose an available option')
    }
    // The existing fingerprint receipt also makes a repeated native submission safe.
    this.respond(input.id, { [input.fieldId]: [input.value] })
  }
  cancelTask(taskId: string) {
    for (const request of this.requests.values())
      if (request.info.taskId === taskId) request.finish(null, 'cancelled')
  }
  dispose() {
    for (const request of this.requests.values()) request.finish(null, 'cancelled')
  }
}
