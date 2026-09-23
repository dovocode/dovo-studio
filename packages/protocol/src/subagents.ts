import { z } from 'zod'

export const subagentSchema = z.object({
  id: z.string(),
  provider: z.string(),
  name: z.string(),
  status: z.enum(['working', 'completed', 'failed', 'stopped', 'unknown']),
  activity: z.string().optional(),
  prompt: z.string().optional(),
  model: z.string().optional(),
  reasoning: z.string().optional(),
  tokens: z.number().nonnegative().optional(),
  durationMs: z.number().nonnegative().optional(),
  parentId: z.string().optional(),
  startedAt: z.string(),
  updatedAt: z.string(),
  finishedAt: z.string().optional(),
})
export type Subagent = z.infer<typeof subagentSchema>
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
      : `${new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(agent.tokens)} tok`,
  ]
    .filter(Boolean)
    .join(' · ')
}
