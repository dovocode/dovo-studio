import { Schema } from 'effect'
import { maxValue, minValue, mutableArray, mutableStruct } from '../shared/schema.js'
import {
  automationDryRunSchema,
  automationDryRunStepStatusSchema,
  type AutomationDryRun,
  type AutomationDryRunRequest,
} from './dry-run.js'
import { automationDryRunInputSchema, automationDryRunStopAtSchema } from './dry-run-input.js'

const id = maxValue(minValue(Schema.String, 1), 200)
export const dryRunScenarioSchema = mutableStruct({
  id,
  name: maxValue(minValue(Schema.String, 1), 100),
  input: automationDryRunInputSchema,
  stopAt: Schema.optional(automationDryRunStopAtSchema),
  outcome: automationDryRunSchema.fields.outcome,
  steps: maxValue(
    mutableArray(mutableStruct({ nodeId: id, status: automationDryRunStepStatusSchema })),
    120,
  ),
})
export type DryRunScenario = typeof dryRunScenarioSchema.Type
export const dryRunScenariosSchema = maxValue(mutableArray(dryRunScenarioSchema), 12)
export const dryRunScenariosCommandSchema = Schema.Union([
  mutableStruct({ action: Schema.Literal('list'), automationId: id }),
  mutableStruct({
    action: Schema.Literal('save'),
    automationId: id,
    scenario: dryRunScenarioSchema,
    expected: Schema.optional(dryRunScenarioSchema),
  }),
  mutableStruct({
    action: Schema.Literal('delete'),
    automationId: id,
    expected: dryRunScenarioSchema,
  }),
])
export type DryRunScenariosCommand = typeof dryRunScenariosCommandSchema.Type

export function dryRunScenario(
  id: string,
  name: string,
  input: AutomationDryRunRequest,
  result: AutomationDryRun,
): DryRunScenario {
  return {
    id,
    name: name.trim(),
    input: result.input,
    stopAt: input.stopAt,
    outcome: result.outcome,
    steps: result.steps.map(({ nodeId, status }) => ({ nodeId, status })),
  }
}

export function dryRunScenarioDifferences(scenario: DryRunScenario, result: AutomationDryRun) {
  const issues: string[] = []
  if (scenario.outcome !== result.outcome)
    issues.push(`Expected ${scenario.outcome}, got ${result.outcome}.`)
  const expected = new Map(scenario.steps.map((step) => [step.nodeId, step.status]))
  for (const step of result.steps) {
    const status = expected.get(step.nodeId)
    if (status !== step.status)
      issues.push(
        status
          ? `${step.label}: expected ${status}, got ${step.status}.`
          : `${step.label}: new step (${step.status}).`,
      )
    expected.delete(step.nodeId)
  }
  for (const nodeId of expected.keys()) issues.push(`Step ${nodeId} is missing.`)
  return issues
}

export function dryRunScenarioFields({ input, stopAt }: DryRunScenario) {
  return {
    payload: input.payload === undefined ? '' : JSON.stringify(input.payload, null, 2),
    scheduledFor: input.scheduledFor ?? '',
    sourceText: input.sourceText ?? '',
    sourceUnchanged: input.sourceUnchanged ?? false,
    stepResults: input.stepResults ?? '',
    stopAt: stopAt ?? '',
  }
}
