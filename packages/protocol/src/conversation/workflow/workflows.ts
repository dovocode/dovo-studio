import { Schema } from 'effect'
import { mutableArray, mutableStruct, minValue, maxValue } from '../../shared/schema.js'
import type { Subagent } from './subagents.js'
import type { TaskMetadata } from '../../tasks/task-summary.js'

const id = maxValue(minValue(Schema.String, 1), 200)
export const workflowPhaseSchema = mutableStruct({
  id,
  title: maxValue(minValue(Schema.String, 1), 200),
})
export const workflowMemberSchema = mutableStruct({
  id,
  phaseId: id,
  /** Dovo child task, or a native subagent ID when taskId is absent. */
  taskId: Schema.optional(id),
  /** A delegated child on another checkout or computer. */
  runtimeId: Schema.optional(id),
})
export const workflowSchema = mutableStruct({
  id,
  name: maxValue(minValue(Schema.String, 1), 200),
  description: Schema.optional(maxValue(Schema.String, 2000)),
  phases: maxValue(mutableArray(workflowPhaseSchema), 50),
  members: maxValue(mutableArray(workflowMemberSchema), 200),
})
export type Workflow = typeof workflowSchema.Type
export type WorkflowState = 'queued' | 'working' | 'completed' | 'failed' | 'stopped' | 'unknown'
export type WorkflowMemberView = {
  id: string
  name: string
  provider?: string
  state: WorkflowState
  activity?: string
  result?: string
  agent?: Subagent
  taskId?: string
  runtimeId?: string
}
export function workflowState(states: readonly WorkflowState[]): WorkflowState {
  if (!states.length) return 'queued'
  if (states.includes('working')) return 'working'
  if (states.includes('failed')) return 'failed'
  if (states.includes('stopped')) return 'stopped'
  if (states.includes('unknown')) return 'unknown'
  if (states.every((state) => state === 'completed')) return 'completed'
  return 'queued'
}
export const workflowStateLabel: Record<WorkflowState, string> = {
  queued: 'Queued',
  working: 'Working',
  completed: 'Done',
  failed: 'Failed',
  stopped: 'Stopped',
  unknown: 'Status unavailable',
}

/** Resolve current child facts. Workflow records never copy child outcomes or conversations. */
export function taskWorkflows(task: TaskMetadata, tasks: readonly TaskMetadata[]) {
  const owners = new Map(tasks.map((item) => [item.id, item]))
  const workflows = [
    ...(task.workflows ?? []),
    ...(task.subagents ?? []).flatMap((agent) => (agent.workflow ? [agent.workflow] : [])),
  ]
  return workflows.map((workflow) => {
    const members = new Map(
      workflow.members.map((member) => {
        let view: WorkflowMemberView
        if (member.runtimeId && member.taskId) {
          const watch = task.threadWatches?.find(
            (watch) =>
              watch.delegated &&
              watch.runtimeId === member.runtimeId &&
              watch.threadId === member.taskId,
          )
          const snapshot = watch?.snapshot
          const state: WorkflowState =
            !watch || watch.offline || watch.paused
              ? 'unknown'
              : watch.stopRequested
                ? 'stopped'
                : snapshot?.status === 'failed'
                  ? 'failed'
                  : snapshot?.status === 'cancelled'
                    ? 'stopped'
                    : snapshot?.phase === 'completed'
                      ? 'completed'
                      : watch.status === 'stopped'
                        ? 'unknown'
                        : snapshot?.phase === 'draft'
                          ? 'queued'
                          : snapshot
                            ? 'working'
                            : 'unknown'
          view = {
            id: member.id,
            name: snapshot?.title ?? member.id,
            state,
            result: snapshot?.result,
            taskId: member.taskId,
            runtimeId: member.runtimeId,
          }
        } else if (member.taskId) {
          const child = owners.get(member.taskId)
          const agent = task.subagents?.find(
            (agent) => agent.source === 'dovo' && (agent.taskId ?? agent.id) === member.taskId,
          )
          view = {
            id: member.id,
            name: child?.title ?? member.id,
            provider: agent?.provider ?? child?.harness?.provider,
            state: !child
              ? 'unknown'
              : child.status === 'draft'
                ? 'queued'
                : (agent?.status ??
                  (child.status === 'running'
                    ? 'working'
                    : child.status === 'failed'
                      ? 'failed'
                      : child.status === 'cancelled'
                        ? 'stopped'
                        : 'completed')),
            activity: child?.error ?? child?.activity,
            taskId: member.taskId,
            agent,
          }
        } else {
          const agent = task.subagents?.find(
            (agent) =>
              agent.source !== 'dovo' && agent.id === member.id && agent.workflowId === workflow.id,
          )
          view = {
            id: member.id,
            name: agent?.name ?? member.id,
            provider: agent?.provider,
            state: agent?.queued && !agent.finishedAt ? 'queued' : (agent?.status ?? 'unknown'),
            activity: agent?.activity,
            result: agent?.result,
            agent,
          }
        }
        return [member.id, view] as const
      }),
    )
    const phases = workflow.phases.map((phase) => {
      const entries = workflow.members
        .filter((member) => member.phaseId === phase.id)
        .flatMap((member) => {
          const view = members.get(member.id)
          return view ? [view] : []
        })
      return {
        ...phase,
        members: entries,
        state: workflowState(entries.map((entry) => entry.state)),
      }
    })
    const coordinator = task.subagents?.find((agent) => agent.workflow?.id === workflow.id)
    return {
      ...workflow,
      phases,
      state: coordinator?.status ?? workflowState(phases.map((phase) => phase.state)),
    }
  })
}
