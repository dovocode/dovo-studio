import { modelDisplayName } from '../../tasks/model-display-name.js'
import { mutableStruct } from '../../shared/schema.js'
import { Schema } from 'effect'
export const subagentSchema = mutableStruct({
  kind: Schema.optional(Schema.Literal('background')),
  source: Schema.optional(Schema.Literal('dovo')),
  taskId: Schema.optional(Schema.String),
  /** Native metadata belongs to a live provider session, including between parent turns. */
  sessionLive: Schema.optional(Schema.Boolean),
  background: Schema.optional(Schema.Boolean),
  sessionId: Schema.optional(Schema.String),
  /** Provider transcript identity, when different from its background-task identity. */
  threadId: Schema.optional(Schema.String),
  result: Schema.optional(Schema.String),
  /** Durable delivery of a native result; provider events remain the source of its outcome. */
  completionId: Schema.optional(Schema.String),
  completion: Schema.optional(Schema.Literals(['pending', 'queued', 'read', 'disposed'])),
  id: Schema.String,
  provider: Schema.String,
  name: Schema.String,
  status: Schema.Literals(['working', 'completed', 'failed', 'stopped', 'unknown']),
  activity: Schema.optional(Schema.String),
  prompt: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  reasoning: Schema.optional(Schema.String),
  tokens: Schema.optional(
    Schema.Number.pipe(Schema.check(Schema.isFinite())).pipe(
      Schema.check(Schema.isGreaterThanOrEqualTo(0)),
    ),
  ),
  durationMs: Schema.optional(
    Schema.Number.pipe(Schema.check(Schema.isFinite())).pipe(
      Schema.check(Schema.isGreaterThanOrEqualTo(0)),
    ),
  ),
  parentId: Schema.optional(Schema.String),
  startedAt: Schema.String,
  updatedAt: Schema.String,
  finishedAt: Schema.optional(Schema.String),
})
export type Subagent = Schema.Schema.Type<typeof subagentSchema>
/** Sidebar pills never retain or compare an agent's potentially large prompt/result. */
export type SubagentListItem = Pick<
  Subagent,
  | 'id'
  | 'taskId'
  | 'source'
  | 'name'
  | 'provider'
  | 'model'
  | 'reasoning'
  | 'tokens'
  | 'activity'
  | 'status'
>
const listFields = [
  'id',
  'taskId',
  'source',
  'name',
  'provider',
  'model',
  'reasoning',
  'tokens',
  'activity',
  'status',
] as const
export function projectSubagentList(
  agents: readonly SubagentListItem[],
  previous: readonly SubagentListItem[] = [],
): readonly SubagentListItem[] {
  if (
    previous.length === agents.length &&
    agents.every((agent, index) =>
      listFields.every((key) => Object.is(agent[key], previous[index]![key])),
    )
  )
    return previous
  return agents.map(
    ({ id, taskId, source, name, provider, model, reasoning, tokens, activity, status }) => ({
      id,
      taskId,
      source,
      name,
      provider,
      model,
      reasoning,
      tokens,
      activity,
      status,
    }),
  )
}
export function nativeAgentWorking(agent: Subagent) {
  return (
    agent.source !== 'dovo' &&
    agent.sessionLive === true &&
    !agent.finishedAt &&
    (agent.status === 'working' || agent.status === 'unknown')
  )
}
export function subagentElapsed(agent: Subagent, now: number) {
  const ms =
    agent.durationMs ??
    Math.max(
      0,
      (agent.finishedAt
        ? Date.parse(agent.finishedAt)
        : agent.status === 'working'
          ? now
          : Date.parse(agent.updatedAt)) - Date.parse(agent.startedAt),
    )
  const seconds = Math.floor(ms / 1000)
  return seconds < 60
    ? `${seconds}s`
    : seconds < 3600
      ? `${Math.floor(seconds / 60)}m`
      : `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
}
export function subagentMetadata(agent: Pick<Subagent, 'model' | 'reasoning' | 'tokens'>) {
  return [
    agent.model ? modelDisplayName(agent.model) : undefined,
    agent.reasoning,
    agent.tokens === undefined
      ? undefined
      : `${new Intl.NumberFormat('en', {
          notation: 'compact',
          maximumFractionDigits: 1,
        }).format(agent.tokens)} tok`,
  ]
    .filter(Boolean)
    .join(' · ')
}

export function subagentListStatus(agent: SubagentListItem, online: boolean) {
  if (agent.status === 'unknown') return 'Status unavailable'
  if (agent.status === 'working') return online ? 'Working' : 'Last seen working'
  return { completed: 'Done', failed: 'Failed', stopped: 'Stopped' }[agent.status]
}
