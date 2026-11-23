import { CronExpressionParser } from 'cron-parser'
import { Schema } from 'effect'
import { mutableArray, mutableStruct } from '../shared/schema.js'
import { automationSchema, nodeDataSchema, type Automation } from '../workspace.js'
import { automationOnceTime } from './automations.js'
import { defaultGithubTrigger } from './triggers.js'
import {
  automationDryRunInputSchema,
  automationDryRunStopAtSchema,
  type AutomationDryRunInput,
} from './dry-run-input.js'

export { automationDryRunInputSchema, type AutomationDryRunInput } from './dry-run-input.js'

export const automationDryRunRequestSchema = mutableStruct({
  /** The flow to test. It can be an unsaved draft; the runtime does not save it. */
  flow: automationSchema,
  input: Schema.optional(automationDryRunInputSchema),
  /** Simulate a failed task or a rejected review at this step. Later steps are not reached. */
  stopAt: Schema.optional(automationDryRunStopAtSchema),
})
export type AutomationDryRunRequest = typeof automationDryRunRequestSchema.Type

export const automationDryRunStepStatusSchema = Schema.Literals(['ran', 'simulated', 'not-reached'])
export type AutomationDryRunStepStatus = typeof automationDryRunStepStatusSchema.Type

export const automationDryRunSchema = mutableStruct({
  /**
   * `completed`: every step was reached. `stopped`: a simulated failure or rejection ended it.
   * `filtered`: the trigger filter skipped the sample event. `unchanged`: the monitored source
   * did not change, so an automatic run ends without work. `invalid`: a real run would not start.
   */
  outcome: Schema.Literals(['completed', 'stopped', 'filtered', 'unchanged', 'invalid']),
  trigger: nodeDataSchema.fields.trigger,
  /** The runtime generated the sample input because the request had none. */
  generated: Schema.Boolean,
  input: automationDryRunInputSchema,
  /** Validation issues that make a real run refuse to start. */
  issues: mutableArray(Schema.String),
  /** Current conditions that would make a real run fail, such as a paused Bot. */
  warnings: mutableArray(Schema.String),
  /** Steps in the order a real run would reach them, then the steps it would not reach. */
  steps: mutableArray(
    mutableStruct({
      nodeId: Schema.String,
      label: Schema.String,
      /** A step kind, or `source` for the monitored source check. Kept open for newer runtimes. */
      kind: Schema.String,
      status: automationDryRunStepStatusSchema,
      /** Resolved values the step would receive. */
      inputs: mutableArray(mutableStruct({ name: Schema.String, value: Schema.String })),
      /** Real output for a step that ran, or a simulated marker. */
      output: Schema.optional(Schema.String),
      note: Schema.optional(Schema.String),
    }),
  ),
  /** Paths this dry run did not test. */
  unexercised: mutableArray(Schema.String),
})
export type AutomationDryRun = typeof automationDryRunSchema.Type

/** Sample trigger input for a flow, so a person can start from realistic values. */
export function automationDryRunDefaults(
  flow: Pick<Automation, 'nodes' | 'monitor'>,
  now = Date.now(),
): AutomationDryRunInput {
  const data = flow.nodes.find((node) => node.data.kind === 'trigger')?.data
  const input: AutomationDryRunInput = {}
  if (data?.trigger === 'schedule' || data?.trigger === 'once') {
    try {
      input.scheduledFor = new Date(
        data.trigger === 'once'
          ? automationOnceTime(data.runAt, data.timezone)
          : CronExpressionParser.parse(data.schedule, {
              tz: data.timezone,
              currentDate: new Date(now),
            })
              .next()
              .getTime(),
      ).toISOString()
    } catch {
      // Validation reports the invalid time. Leave the sample time for the person to enter.
    }
  }
  if (data?.trigger === 'webhook')
    input.payload = { event: 'sample', id: 'dry-run', data: { message: 'Sample webhook payload' } }
  if (data?.trigger === 'github') {
    const config = data.github ?? defaultGithubTrigger
    const area = config.event.startsWith('pull_request.')
      ? 'pull'
      : config.event.startsWith('discussion.')
        ? 'discussions'
        : 'issues'
    input.payload = {
      id: 'dry-run',
      event: config.event,
      at: new Date(now).toISOString(),
      actor: config.actor || 'octocat',
      context: {
        repository: `${config.host}/${config.repository}`,
        item: {
          number: 1,
          title: 'Sample item',
          body: 'Sample description',
          url: `https://${config.host}/${config.repository}/${area}/1`,
        },
        detail: {},
      },
    }
  }
  if (flow.monitor) input.sourceText = 'Sample source content'
  if (data?.trigger === 'mcp-event')
    input.payload = {
      source: 'mcp-event',
      server: data.mcpEvent?.server ?? '',
      event: {
        eventId: 'dry-run',
        name: data.mcpEvent?.name ?? '',
        timestamp: new Date(now).toISOString(),
        data: {},
      },
    }
  return input
}

/** Editable text for the dry-run form. */
export function automationDryRunFields(
  flow: Pick<Automation, 'nodes' | 'monitor'>,
  now = Date.now(),
) {
  const defaults = automationDryRunDefaults(flow, now)
  return {
    payload: defaults.payload === undefined ? '' : JSON.stringify(defaults.payload, null, 2),
    scheduledFor: defaults.scheduledFor ?? '',
    sourceText: defaults.sourceText ?? '',
    sourceUnchanged: false,
    stopAt: '',
  }
}
export type AutomationDryRunFields = ReturnType<typeof automationDryRunFields>

/** Which sample fields apply to this flow. */
export function automationDryRunFieldUse(flow: Pick<Automation, 'nodes' | 'monitor'>) {
  const trigger = flow.nodes.find((node) => node.data.kind === 'trigger')?.data.trigger
  return {
    payload: trigger === 'webhook' || trigger === 'github' || trigger === 'mcp-event',
    scheduledFor: trigger === 'schedule' || trigger === 'once',
    source: !!flow.monitor,
    /** Steps that can fail or be rejected. */
    stops: flow.nodes
      .filter((node) => node.data.kind !== 'trigger')
      .map((node) => ({ id: node.id, label: node.data.label, kind: node.data.kind })),
  }
}

/** Build a dry-run request from the form. Throws a message for the person on invalid input. */
export function automationDryRunRequest(
  flow: Automation,
  fields: AutomationDryRunFields,
): AutomationDryRunRequest {
  const use = automationDryRunFieldUse(flow)
  const input: AutomationDryRunInput = {}
  if (use.payload) {
    try {
      // An empty webhook body reaches the steps as an empty object.
      input.payload = fields.payload.trim() ? JSON.parse(fields.payload) : {}
    } catch {
      throw new Error('Enter the sample payload as JSON.')
    }
  }
  if (use.scheduledFor && fields.scheduledFor.trim()) {
    const time = Date.parse(fields.scheduledFor.trim())
    if (!Number.isFinite(time))
      throw new Error(
        'Enter the sample time as an ISO date and time, such as 2026-11-16T09:00:00Z.',
      )
    input.scheduledFor = new Date(time).toISOString()
  }
  if (use.source) {
    input.sourceText = fields.sourceText
    input.sourceUnchanged = fields.sourceUnchanged
  }
  const stopAt = use.stops.some((step) => step.id === fields.stopAt) ? fields.stopAt : undefined
  return { flow, input, ...(stopAt ? { stopAt } : {}) }
}

export function automationDryRunCounts(result: Pick<AutomationDryRun, 'steps'>) {
  const count = (status: AutomationDryRunStepStatus) =>
    result.steps.filter((step) => step.status === status).length
  return { ran: count('ran'), simulated: count('simulated'), notReached: count('not-reached') }
}

export const automationDryRunOutcomeText: Record<AutomationDryRun['outcome'], string> = {
  completed: 'Every step was reached.',
  stopped: 'The run stopped at the simulated failure or rejection.',
  filtered: 'The trigger filter skipped this sample event.',
  unchanged: 'The source is unchanged, so an automatic run ends without work.',
  invalid: 'A real run would not start. Fix the issues first.',
}

export const automationDryRunStatusText: Record<AutomationDryRunStepStatus, string> = {
  ran: 'Ran',
  simulated: 'Simulated',
  'not-reached': 'Not reached',
}
