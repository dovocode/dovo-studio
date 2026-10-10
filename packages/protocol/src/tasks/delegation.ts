import { Schema } from 'effect'
import { mutableStruct, maxValue, minValue } from '../shared/schema.js'
import { agentSchema, providerSchema, type Task } from '../workspace.js'
import { nativeAgentWorking, type Subagent } from '../conversation/workflow/subagents.js'
const id = maxValue(minValue(Schema.String, 1), 200)
export const subagentScopeSchema = mutableStruct({ taskId: id, parentRunId: Schema.optional(id) })
export const subagentSpawnSchema = mutableStruct({
  ...subagentScopeSchema.fields,
  checkoutId: Schema.optional(id),
  key: maxValue(minValue(Schema.String, 1), 100),
  name: maxValue(minValue(Schema.String, 1), 100),
  prompt: maxValue(minValue(Schema.String, 1), 20000),
  agentId: Schema.optional(id),
  provider: Schema.optional(providerSchema),
  model: Schema.optional(maxValue(Schema.String, 500)),
  reasoning: Schema.optional(maxValue(Schema.String, 100)),
  permission: Schema.optional(agentSchema.fields.permission),
})
export type SubagentSpawn = Schema.Schema.Type<typeof subagentSpawnSchema>
export const subagentReadSchema = mutableStruct({
  ...subagentScopeSchema.fields,
  id,
  timeoutMs: Schema.optional(
    Schema.Number.pipe(
      Schema.check(Schema.isInt()),
      Schema.check(Schema.isBetween({ minimum: 0, maximum: 20000 })),
    ),
  ),
})
/** Never grant a child wider access than its parent, even when selecting a saved preset. */
export function delegatedAccess(
  parent: (typeof agentSchema.Type)['permission'],
  requested: (typeof agentSchema.Type)['permission'],
) {
  const allowed = {
    'read-only': ['read-only'],
    ask: ['read-only', 'ask'],
    'workspace-write': ['read-only', 'ask', 'workspace-write'],
    auto: ['read-only', 'ask', 'workspace-write', 'auto'],
    'full-access': ['read-only', 'ask', 'workspace-write', 'auto', 'full-access'],
  }
  return allowed[parent].includes(requested) ? requested : parent
}

/** A thread owns the lifecycle of every delegated descendant, regardless of attempt. */
export function taskFamilyIds(tasks: readonly Pick<Task, 'id' | 'delegation'>[], id: string) {
  return familyIds(childIds(tasks), id)
}

/** Includes descendants whose saved results still need a parent turn. */
export function taskFamilyWorking(tasks: readonly Task[], id: string) {
  return indexTaskFamilyWorking(tasks)(id)
}

/** Project once per workspace update; progress events must not rescan every family. */
export function indexTaskFamilyWorking(tasks: readonly Task[]) {
  const owners = new Map(tasks.map((task) => [task.id, task]))
  const working = new Set<string>()
  const mark = (task: Task | undefined) => {
    while (task && !working.has(task.id)) {
      working.add(task.id)
      task = task.delegation ? owners.get(task.delegation.parentTaskId) : undefined
    }
  }
  for (const task of tasks) {
    if (
      task.activeRunId ||
      task.status === 'running' ||
      task.status === 'draft' ||
      task.subagents?.some(
        (agent) => nativeAgentWorking(agent) || agent.completion === 'pending',
      ) ||
      task.queue?.some((message) => message.subagentResultId)
    )
      mark(task)
    if (task.delegation?.completion === 'pending') mark(owners.get(task.delegation.parentTaskId))
  }
  return (id: string) => working.has(id)
}

/** Compare the whole family before stopping: a stale panel must not stop a newer run. */
export function taskFamilyRunToken(tasks: readonly Task[], id: string) {
  const ids = taskFamilyIds(tasks, id)
  return JSON.stringify(
    tasks
      .filter((task) => ids.has(task.id))
      .map((task) => [
        task.id,
        task.activeRunId ?? null,
        task.status,
        task.subagents
          ?.filter((agent) => agent.source !== 'dovo')
          .map((agent) => [
            agent.provider,
            agent.sessionId,
            agent.id,
            agent.startedAt,
            agent.status,
            agent.sessionLive,
            agent.completionId,
          ]),
      ])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  )
}

function childIds(tasks: readonly Pick<Task, 'id' | 'delegation'>[]) {
  const children = new Map<string, string[]>()
  for (const task of tasks) {
    if (!task.delegation) continue
    const parent = task.delegation.parentTaskId
    const group = children.get(parent) ?? []
    group.push(task.id)
    children.set(parent, group)
  }
  return children
}

function familyIds(children: ReadonlyMap<string, readonly string[]>, id: string) {
  const ids = new Set<string>()
  const pending = [id]
  while (pending.length) {
    const current = pending.pop()!
    if (ids.has(current)) continue
    ids.add(current)
    pending.push(...(children.get(current) ?? []))
  }
  return ids
}

/** Include nested agents in the main thread's overview without hiding their saved results. */
export function taskSubagents(task: Task, tasks: readonly Task[], workingOnly = false): Subagent[] {
  return indexTaskSubagents(tasks)(task, workingOnly)
}

/** Build once for a workspace snapshot when rendering many main-thread rows. */
export function indexTaskSubagents(tasks: readonly Task[]) {
  const children = childIds(tasks)
  const owners = new Map(tasks.map((task) => [task.id, task]))
  return (task: Task, workingOnly = false): Subagent[] => {
    const ids = familyIds(children, task.id)
    const records = new Map<string, Subagent>()
    for (const id of ids) {
      const owner = id === task.id ? task : owners.get(id)
      for (const record of owner?.subagents ?? []) {
        if (
          workingOnly &&
          !(
            nativeAgentWorking(record) ||
            (record.status === 'working' &&
              !record.finishedAt &&
              (record.source === 'dovo' || owner?.status === 'running'))
          )
        )
          continue
        const child = record.source === 'dovo' ? (record.taskId ?? record.id) : undefined
        if (child && (!owners.has(child) || !ids.has(child))) continue
        records.set(child ? `dovo:${child}` : `${id}:${record.provider}:${record.id}`, record)
      }
    }
    return [...records.values()]
  }
}

/** Hidden children surface approvals and questions on each visible ancestor. */
export function taskFamilyInputIds(tasks: readonly Task[], inputIds: Iterable<string>) {
  const owners = new Map(tasks.map((task) => [task.id, task]))
  const input = new Set<string>()
  for (const id of inputIds) {
    let current: string | undefined = id
    while (current && !input.has(current)) {
      input.add(current)
      current = owners.get(current)?.delegation?.parentTaskId
    }
  }
  return input
}
