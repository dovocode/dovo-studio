import { randomUUID, createHash } from 'node:crypto'
import {
  questionPromptSchema,
  questionAnswersSchema,
  questionAnswerError,
  type QuestionPrompt,
  type QuestionAnswers,
  type PendingQuestion,
} from '@dovo/protocol'
import type { Activity } from '../storage/activity.js'
import { HttpError } from '../errors.js'
type Pending = {
  info: PendingQuestion
  finish: (answers: QuestionAnswers | null, status: string) => void
  validate?: (answers: QuestionAnswers) => void
}
function answerFingerprint(answers: QuestionAnswers | null) {
  return createHash('sha256')
    .update(
      JSON.stringify(answers && Object.entries(answers).sort(([a], [b]) => a.localeCompare(b))),
    )
    .digest('hex')
}
export class Questions {
  private answered = new Map<string, string>()
  private requests = new Map<string, Pending>()
  constructor(private activity: Pick<Activity, 'add'>) {}
  list() {
    return [...this.requests.values()].map((r) => r.info)
  }
  request(
    taskId: string,
    value: QuestionPrompt,
    signal: AbortSignal,
    validate?: (answers: QuestionAnswers) => void,
    onResponse?: (answers: QuestionAnswers | null) => void,
  ) {
    if (signal.aborted) return Promise.resolve(null)
    const prompt = questionPromptSchema.parse(value),
      id = randomUUID()
    const info = { id, taskId, prompt, createdAt: new Date().toISOString() }
    this.activity.add(
      'question',
      taskId,
      prompt.title,
      { ...info, status: 'requested' },
      `question:${id}`,
    )
    return new Promise<QuestionAnswers | null>((resolve) => {
      const finish = (answers: QuestionAnswers | null, status: string) => {
        if (!this.requests.has(id)) return
        const logged =
          answers &&
          Object.fromEntries(
            prompt.questions.map((q) => [q.id, q.secret ? ['[redacted]'] : (answers[q.id] ?? [])]),
          )
        this.activity.add(
          'question',
          taskId,
          prompt.title,
          { ...info, answers: logged, status, resolvedAt: new Date().toISOString() },
          `question:${id}`,
        )
        if (status !== 'cancelled') {
          this.answered.set(id, answerFingerprint(answers))
          if (this.answered.size > 256) this.answered.delete(this.answered.keys().next().value!)
        }
        this.requests.delete(id)
        signal.removeEventListener('abort', abort)
        resolve(answers)
        if (status !== 'cancelled') onResponse?.(answers)
      }
      const abort = () => finish(null, 'cancelled')
      this.requests.set(id, { info, finish, validate })
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort()
    })
  }
  respond(id: string, value: QuestionAnswers | null) {
    const request = this.requests.get(id)
    const answers = value === null ? null : questionAnswersSchema.parse(value)
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
  cancelTask(taskId: string) {
    for (const request of this.requests.values())
      if (request.info.taskId === taskId) request.finish(null, 'cancelled')
  }
  dispose() {
    for (const request of this.requests.values()) request.finish(null, 'cancelled')
  }
}
