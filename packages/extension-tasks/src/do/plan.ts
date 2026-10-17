import {
  DO_LIMITS,
  decodeResult,
  doPlanIssues,
  doSaveRequestSchema,
  randomUUID,
  type DoPlanItem,
  type DoRun,
  type DoSaveRequest,
} from '@dovo/protocol'

export function newPlan(): DoSaveRequest {
  return {
    id: randomUUID(),
    title: '',
    goal: '',
    maxConcurrency: DO_LIMITS.defaultConcurrency,
    items: [newItem([])],
  }
}
export function newItem(items: readonly DoPlanItem[]): DoPlanItem {
  let index = items.length + 1
  while (items.some((item) => item.id === `item-${index}`)) index++
  return {
    id: `item-${index}`,
    title: '',
    instructions: '',
    dependsOn: [],
    target: { runtimeId: 'local', repositoryId: '', execution: 'worktree' },
  }
}
export function editablePlan(run: DoRun): DoSaveRequest {
  return {
    id: run.id,
    expectedRevision: run.revision,
    title: run.title,
    goal: run.goal,
    maxConcurrency: run.maxConcurrency,
    items: run.items.map(({ state: _state, ...item }) => item),
  }
}
export function planErrors(plan: DoSaveRequest): string[] {
  const issues: string[] = []
  if (!plan.title.trim()) issues.push('Give the plan a title.')
  if (!plan.goal.trim()) issues.push('Describe the goal.')
  if (!plan.items.length) issues.push('Add at least one work item.')
  for (const [index, item] of plan.items.entries()) {
    const label = `Work item ${index + 1}`
    if (!item.title.trim()) issues.push(`${label}: add a title.`)
    if (!item.instructions.trim()) issues.push(`${label}: add instructions.`)
    if (!item.target.repositoryId) issues.push(`${label}: select a project.`)
  }
  issues.push(...doPlanIssues(plan.items).map((issue) => issue.message))
  if (!issues.length && !decodeResult(doSaveRequestSchema, plan).success)
    issues.push('Check field lengths, work item IDs, and concurrency limits.')
  return issues
}
