import { Schema } from 'effect'
import { maxValue, minValue, mutableArray, mutableStruct, refine } from '../shared/schema.js'
import { taskSchema, type Task } from '../workspace.js'
import type { RuntimeOverview } from './connection/runtime-fleet.js'
import { recentClientActions } from '../shared/client-diagnostics.js'

/** The public repository a triage agent reads for the running commit. */
export const PROBLEM_REPORT_REPOSITORY = 'dovocode/dovo-studio'
export const PROBLEM_REPORT_ATTACHMENT_NAME = 'dovo-diagnostics.md'
/** The runtime keeps the attached bundle within this size, so an agent receives it inline. */
export const MAX_PROBLEM_REPORT_BYTES = 64 * 1024
export const MAX_PROBLEM_REPORT_CLIENT_ERRORS = 20
export const MAX_PROBLEM_REPORT_TEXT = 4000

const bounded = (max: number) => maxValue(Schema.String, max)
export const problemReportIncludeSchema = mutableStruct({
  /** App and runtime versions, operating system and the source commit. */
  versions: Schema.Boolean,
  /** Runtime health summary and the newest lines of its log files. */
  diagnostics: Schema.Boolean,
  /** Recent errors recorded by this client app. */
  clientErrors: Schema.Boolean,
  clientTimeline: Schema.optional(Schema.Boolean),
})
export const problemReportClientSchema = mutableStruct({
  surface: Schema.Literals(['desktop', 'web', 'mobile']),
  appVersion: Schema.optional(bounded(64)),
  build: Schema.optional(bounded(64)),
  channel: Schema.optional(bounded(32)),
  platform: Schema.optional(bounded(128)),
  commit: Schema.optional(bounded(64)),
})
export const problemReportClientErrorSchema = mutableStruct({
  at: bounded(64),
  message: bounded(2000),
  source: Schema.optional(bounded(64)),
  name: Schema.optional(bounded(64)),
  stack: Schema.optional(bounded(2000)),
})
export const problemReportClientActionSchema = mutableStruct({
  at: bounded(64),
  action: Schema.Literals([
    'navigation',
    'request-start',
    'request-complete',
    'request-failed',
    'connecting',
    'connected',
    'reconnecting',
    'offline',
    'unauthorized',
    'unsupported',
  ]),
  category: Schema.Literals([
    'app',
    'threads',
    'files',
    'scm',
    'automations',
    'settings',
    'connection',
    'other',
  ]),
  durationMs: Schema.optional(
    Schema.Number.pipe(
      Schema.check(Schema.isFinite()),
      Schema.check(Schema.isBetween({ minimum: 0, maximum: 3600000 })),
    ),
  ),
  status: Schema.optional(
    Schema.Number.pipe(
      Schema.check(Schema.isInt()),
      Schema.check(Schema.isBetween({ minimum: 100, maximum: 599 })),
    ),
  ),
})
const problemReportFields = {
  description: maxValue(minValue(Schema.String, 1), MAX_PROBLEM_REPORT_TEXT),
  expected: Schema.optional(bounded(MAX_PROBLEM_REPORT_TEXT)),
  include: problemReportIncludeSchema,
  client: problemReportClientSchema,
  clientErrors: maxValue(
    mutableArray(problemReportClientErrorSchema),
    MAX_PROBLEM_REPORT_CLIENT_ERRORS,
  ),
  clientTimeline: Schema.optional(maxValue(mutableArray(problemReportClientActionSchema), 100)),
}
const described = (input: { description: string }) => !!input.description.trim()
/** `POST /api/problem-reports/preview` on runtimes with `problemReportsSupported`. */
export const problemReportRequestSchema = refine(
  mutableStruct(problemReportFields),
  described,
  'Describe what happened',
)
/** The redacted first message and attachment, exactly as a start sends them. */
export const problemReportPreviewSchema = mutableStruct({
  message: Schema.String,
  /** Absent when no diagnostics section is included. */
  attachment: Schema.optional(
    mutableStruct({ name: Schema.String, text: Schema.String, bytes: Schema.Number }),
  ),
  /** Values the runtime replaced with a placeholder. */
  redactions: Schema.Number,
})
/** `POST /api/problem-reports/start`. The attachment text comes from the preview; the
 * runtime redacts it again and starts the draft without a project. */
export const problemReportStartSchema = refine(
  mutableStruct({
    ...problemReportFields,
    messageId: maxValue(minValue(Schema.String, 1), 200),
    attachmentText: Schema.optional(bounded(MAX_PROBLEM_REPORT_BYTES)),
    createTask: taskSchema,
  }),
  described,
  'Describe what happened',
)
export type ProblemReportInclude = typeof problemReportIncludeSchema.Type
export type ProblemReportClient = typeof problemReportClientSchema.Type
export type ProblemReportClientError = typeof problemReportClientErrorSchema.Type
export type ProblemReportRequest = typeof problemReportRequestSchema.Type
export type ProblemReportPreview = typeof problemReportPreviewSchema.Type
export type ProblemReportStart = typeof problemReportStartSchema.Type

export const defaultProblemReportInclude: ProblemReportInclude = {
  versions: true,
  diagnostics: true,
  clientErrors: true,
  clientTimeline: true,
}
export type ProblemReportForm = {
  description: string
  expected: string
  include: ProblemReportInclude
}

/** The preview request for a form. Client errors are sent only when the user includes them. */
export function problemReportRequest(
  form: ProblemReportForm,
  client: ProblemReportClient,
  clientErrors: readonly ProblemReportClientError[],
): ProblemReportRequest {
  const expected = form.expected.trim()
  return {
    description: form.description.trim().slice(0, MAX_PROBLEM_REPORT_TEXT),
    ...(expected ? { expected: expected.slice(0, MAX_PROBLEM_REPORT_TEXT) } : {}),
    include: { ...form.include },
    client,
    clientErrors: form.include.clientErrors
      ? clientErrors.slice(-MAX_PROBLEM_REPORT_CLIENT_ERRORS)
      : [],
    ...(form.include.clientTimeline ? { clientTimeline: recentClientActions() } : {}),
  }
}

export function problemReportTitle(description: string) {
  const line = description.trim().split('\n')[0]?.trim() ?? ''
  const title = `Problem: ${line}`
  return title.length > 80 ? `${title.slice(0, 79)}…` : title
}

/** The start request for a reviewed preview and a draft created with `createLauncherTask`. */
export function problemReportStart(
  request: ProblemReportRequest,
  preview: ProblemReportPreview,
  createTask: Task,
  messageId: string,
): ProblemReportStart {
  return {
    ...request,
    messageId,
    ...(preview.attachment ? { attachmentText: preview.attachment.text } : {}),
    createTask,
  }
}

/** Computers a problem report can start on: connected runtimes that advertise the routes and
 * have a place for threads without a project. Older runtimes are listed as unsupported. */
export function problemReportTargets(overviews: readonly RuntimeOverview[]) {
  return overviews.map((overview) => {
    const scratch = overview.snapshot?.workspace.repositories.find(
      (repository) => repository.kind === 'scratch',
    )
    const supported = overview.snapshot?.problemReportsSupported === true
    return {
      profile: overview.profile,
      snapshot: overview.snapshot,
      scratch,
      supported,
      available: supported && overview.connected && !!scratch,
    }
  })
}
export type ProblemReportTarget = ReturnType<typeof problemReportTargets>[number]
