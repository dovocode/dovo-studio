import { automationIssues, type Automation, type Workspace } from '@dovo/protocol'

export function validateAutomation(flow: Automation, workspace: Workspace) {
  const error = automationIssues(flow, workspace)[0]
  if (error) throw new Error(error)
}
