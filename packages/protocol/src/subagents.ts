import { mutableStruct } from './schema.js'
import { Schema } from 'effect'
export const subagentSchema = mutableStruct({
  id: Schema.String,
  provider: Schema.String,
  name: Schema.String,
  status: Schema.Literal('working', 'completed', 'failed', 'stopped', 'unknown'),
  activity: Schema.optional(Schema.String),
  prompt: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  reasoning: Schema.optional(Schema.String),
  tokens: Schema.optional(Schema.Number.pipe(Schema.finite()).pipe(Schema.nonNegative())),
  durationMs: Schema.optional(Schema.Number.pipe(Schema.finite()).pipe(Schema.nonNegative())),
  parentId: Schema.optional(Schema.String),
  startedAt: Schema.String,
  updatedAt: Schema.String,
  finishedAt: Schema.optional(Schema.String),
})
export type Subagent = Schema.Schema.Type<typeof subagentSchema>
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
export function subagentMetadata(agent: Subagent) {
  return [
    agent.model,
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
