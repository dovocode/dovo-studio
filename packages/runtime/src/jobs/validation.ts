import { automationIssues, type Automation, type Workspace } from '@dovo/protocol'

export function validateAutomation(
  flow: Automation,
  workspace: Pick<Workspace, 'agents' | 'repositories'>,
) {
  const error = automationIssues(flow, workspace)[0]
  if (error) throw new Error(error)
}
