import { automationIssues, type Automation } from '@dovo/protocol'
import { compileStepResult } from './step-result.js'

export function automationResultSchemaIssues(flow: Automation) {
  const issues: string[] = []
  for (const { data } of flow.nodes) {
    if (data.resultSchema === undefined) continue
    if (data.kind !== 'task') {
      issues.push(`Only task steps can have a result schema. Check ${data.label}.`)
      continue
    }
    try {
      compileStepResult(data.resultSchema)
    } catch {
      issues.push(`Enter a valid JSON Schema for ${data.label}.`)
    }
  }
  return issues
}
export function runtimeAutomationIssues(
  flow: Automation,
  workspace: Parameters<typeof automationIssues>[1],
) {
  const issues = automationIssues(flow, workspace)
  return issues.length ? issues : automationResultSchemaIssues(flow)
}
export function validateAutomation(
  flow: Automation,
  workspace: Parameters<typeof automationIssues>[1],
) {
  const error = runtimeAutomationIssues(flow, workspace)[0]
  if (error) throw new Error(error)
}
