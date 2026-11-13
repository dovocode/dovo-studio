import { automationIssues, type Automation } from '@dovo/protocol'

export function validateAutomation(
  flow: Automation,
  workspace: Parameters<typeof automationIssues>[1],
) {
  const error = automationIssues(flow, workspace)[0]
  if (error) throw new Error(error)
}
