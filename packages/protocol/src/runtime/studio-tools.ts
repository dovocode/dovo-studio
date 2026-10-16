import { Schema } from 'effect'
import { mutableStruct, minValue, maxValue } from '../shared/schema.js'
import {
  automationSchema,
  executionSchema,
  taskHarnessSchema,
  taskModelSchema,
} from '../workspace.js'

export const studioToolSettings = [
  {
    part: 'threads',
    key: 'enableStudioThreads',
    label: 'Threads',
    description: 'Create and manage threads, send prompts and inspect conversations.',
  },
  {
    part: 'automations',
    key: 'enableStudioAutomations',
    label: 'Automations',
    description: 'Create and edit workflows, configure triggers and inspect or control runs.',
  },
  {
    part: 'browsers',
    key: 'enableStudioBrowsers',
    label: 'Browsers',
    description:
      'Manage browser sessions and tabs, interact with pages and inspect browser errors.',
  },
  {
    part: 'ui',
    key: 'enableStudioUI',
    label: 'UI interaction',
    description:
      'Inspect and control desktop/web Studio on this machine through a loopback runtime connection. Native mobile uses Device Hub.',
  },
  {
    part: 'diagnostics',
    key: 'enableStudioDiagnostics',
    label: 'Diagnostics',
    description: 'Inspect runtime health, activity and failures.',
  },
] as const
export type StudioToolPart = (typeof studioToolSettings)[number]['part']
export type StudioTools = Record<StudioToolPart, boolean>
export const studioToolsSchema = mutableStruct({
  threads: Schema.Boolean,
  automations: Schema.Boolean,
  browsers: Schema.Boolean,
  ui: Schema.Boolean,
  diagnostics: Schema.Boolean,
})
export const noStudioTools = (): StudioTools => ({
  threads: false,
  automations: false,
  browsers: false,
  ui: false,
  diagnostics: false,
})
export function enabledStudioTools(
  preferences: Partial<Record<(typeof studioToolSettings)[number]['key'], boolean>>,
): StudioTools {
  return {
    threads: preferences.enableStudioThreads ?? false,
    automations: preferences.enableStudioAutomations ?? false,
    browsers: preferences.enableStudioBrowsers ?? false,
    ui: preferences.enableStudioUI ?? false,
    diagnostics: preferences.enableStudioDiagnostics ?? false,
  }
}
const id = maxValue(minValue(Schema.String, 1), 200)
const text = maxValue(Schema.String, 16000)
const timeout = Schema.optional(
  Schema.Number.pipe(
    Schema.check(Schema.isInt()),
    Schema.check(Schema.isBetween({ minimum: 0, maximum: 20000 })),
  ),
)
const page = Schema.optional(id)
export const studioThreadsCommandSchema = Schema.Union([
  mutableStruct({ action: Schema.Literal('list'), query: Schema.optional(text), before: page }),
  mutableStruct({ action: Schema.Literal('read'), id, before: page }),
  mutableStruct({ action: Schema.Literal('search'), query: text, id: Schema.optional(id) }),
  mutableStruct({
    action: Schema.Literal('create'),
    title: id,
    repositoryId: Schema.String,
    agentId: Schema.optional(Schema.String),
    harness: Schema.optional(taskHarnessSchema),
    agentOverrides: Schema.optional(taskModelSchema),
    execution: Schema.optional(executionSchema),
    prompt: Schema.optional(text),
  }),
  mutableStruct({ action: Schema.Literal('send'), id, text, messageId: id }),
  mutableStruct({ action: Schema.Literals(['stop', 'resume', 'archive', 'unarchive']), id }),
  mutableStruct({ action: Schema.Literal('wait'), id, timeoutMs: timeout }),
])
export const studioAutomationsCommandSchema = Schema.Union([
  mutableStruct({ action: Schema.Literal('list') }),
  mutableStruct({ action: Schema.Literal('read'), id }),
  mutableStruct({
    action: Schema.Literals(['create', 'update', 'validate']),
    automation: automationSchema,
  }),
  mutableStruct({ action: Schema.Literal('enable'), id, enabled: Schema.Boolean }),
  mutableStruct({ action: Schema.Literal('run'), id, requestId: id }),
  mutableStruct({ action: Schema.Literals(['runs', 'cancel', 'retry']), id }),
  mutableStruct({ action: Schema.Literal('wait'), id, timeoutMs: timeout }),
])
const selector = maxValue(minValue(Schema.String, 1), 4096)
export const studioUICommandSchema = Schema.Union([
  mutableStruct({ action: Schema.Literal('list') }),
  mutableStruct({ action: Schema.Literal('snapshot'), sessionId: id }),
  mutableStruct({ action: Schema.Literal('click'), sessionId: id, selector }),
  mutableStruct({ action: Schema.Literal('fill'), sessionId: id, selector, text }),
  mutableStruct({
    action: Schema.Literal('key'),
    sessionId: id,
    key: Schema.Literals([
      'Enter',
      'Escape',
      'Tab',
      'ArrowUp',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
    ]),
  }),
  mutableStruct({
    action: Schema.Literal('scroll'),
    sessionId: id,
    selector: Schema.optional(selector),
    deltaY: Schema.Number.pipe(
      Schema.check(Schema.isFinite()),
      Schema.check(Schema.isBetween({ minimum: -4000, maximum: 4000 })),
    ),
  }),
])
export type StudioUICommand = Schema.Schema.Type<typeof studioUICommandSchema>
export const studioUIJobSchema = mutableStruct({ id, command: studioUICommandSchema })
export const studioUIPollSchema = mutableStruct({
  sessionId: id,
  label: maxValue(Schema.String, 200),
  result: Schema.optional(mutableStruct({ id, value: Schema.Unknown })),
})
export const studioUIPollResultSchema = mutableStruct({ job: Schema.NullOr(studioUIJobSchema) })
export const studioDiagnosticsCommandSchema = Schema.Union([
  mutableStruct({ action: Schema.Literal('health') }),
  mutableStruct({ action: Schema.Literal('activity'), scope: Schema.optional(id), before: page }),
])
