import { createHash } from 'node:crypto'
import { Effect } from 'effect'
import {
  MAX_PROBLEM_REPORT_BYTES,
  PROBLEM_REPORT_ATTACHMENT_NAME,
  SCRATCH_PROJECT_ID,
  decode,
  problemReportRequestSchema,
  problemReportStartSchema,
  problemReportTitle,
  startsCleanDraft,
} from '@dovo/protocol'
import type { Services } from '../../services.js'
import { HttpError, runtimeOperation } from '../../errors.js'
import { serviceResult } from '../support/effect.js'
import { startThreadEffect, threadStartAcknowledgement } from './thread-start.js'
import {
  problemReportMessage,
  problemReportPreview,
  problemReportSecrets,
} from '../../diagnostics/problem-report.js'
import { redactReportText } from '../../diagnostics/report-redaction.js'

/** A stable attachment ID per message, so a retried start reuses the same upload. */
function attachmentId(messageId: string) {
  const hex = createHash('sha256').update(`problem-report:${messageId}`).digest('hex')
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

/** `POST /api/problem-reports/preview` and `/start` for paired human clients. */
export function problemReportRoute(s: Services, path: string, value: unknown) {
  return Effect.gen(function* () {
    if (path === '/api/problem-reports/preview')
      return yield* serviceResult(
        problemReportPreview(s, decode(problemReportRequestSchema, value)),
      )
    if (path !== '/api/problem-reports/start')
      return yield* Effect.fail(new HttpError(404, 'Not found'))
    const input = decode(problemReportStartSchema, value)
    if (!startsCleanDraft(input.createTask) || input.createTask.draft)
      throw new HttpError(400, 'A problem report starts a new, empty thread.')
    // The agent fetches the Dovo source itself, so no local project is involved.
    if (input.createTask.repositoryId !== SCRATCH_PROJECT_ID)
      throw new HttpError(400, 'A problem report starts a thread without a project.')
    const secrets = problemReportSecrets(s)
    // The title syncs to every device, so the runtime makes it from the redacted description
    // and ignores the client's title. The same input gives the same title, so a retried start
    // still matches the thread it created.
    const task = {
      ...input.createTask,
      title: problemReportTitle(redactReportText(input.description, secrets)),
    }
    // The preview was redacted already. Redacting again is a no-op for it and protects
    // against text a client changed after the preview.
    const text =
      input.attachmentText === undefined
        ? undefined
        : redactReportText(input.attachmentText, secrets)
    if (text !== undefined && Buffer.byteLength(text, 'utf8') > MAX_PROBLEM_REPORT_BYTES)
      throw new HttpError(413, 'The diagnostics file is larger than the problem report limit.')
    const message = problemReportMessage(input, text !== undefined, secrets)
    yield* startThreadEffect(s, { messageId: input.messageId, createTask: task })
    const ids: string[] = []
    if (text !== undefined) {
      const upload = yield* serviceResult(
        s.attachments.upload({
          taskId: task.id,
          id: attachmentId(input.messageId),
          name: PROBLEM_REPORT_ATTACHMENT_NAME,
          data: Buffer.from(text, 'utf8').toString('base64'),
          detached: true,
        }),
      )
      ids.push(upload.attachment.id)
    }
    const result = yield* s.tasks.sendEffect(
      task.id,
      input.messageId,
      message,
      ids,
      false,
      true,
      undefined,
      undefined,
      false,
      false,
      false,
      false,
      undefined,
      'accepted',
      s.runtimeId,
    )
    return yield* runtimeOperation(() => threadStartAcknowledgement(s, result))
  })
}
