import type { Task } from '../../workspace.js'

export type ContextMeter = {
  /** 0–100 when the window size is known. */
  percent?: number
  level: 'ok' | 'warn' | 'full'
  /** Short text for the meter itself. */
  short: string
  /** A sentence for tooltips and screen readers. */
  label: string
}
const tokens = (value: number) =>
  value >= 1_000_000
    ? `${(value / 1_000_000).toFixed(1)}M`
    : value >= 1000
      ? `${Math.round(value / 1000)}k`
      : String(value)

/** How full the agent's context is, for the composer meter; undefined until reported. */
export function contextMeter(task: Pick<Task, 'contextUsage'>): ContextMeter | undefined {
  const usage = task.contextUsage
  if (usage?.used === undefined) return undefined
  if (!usage.limit)
    return {
      level: 'ok',
      short: tokens(usage.used),
      label: `${tokens(usage.used)} tokens in the agent’s context.`,
    }
  const percent = Math.min(100, Math.round((usage.used / usage.limit) * 100))
  const level = percent >= 95 ? 'full' : percent >= 80 ? 'warn' : 'ok'
  return {
    percent,
    level,
    short: `${percent}%`,
    label: `${percent}% of the agent’s context is used (${tokens(usage.used)} of ${tokens(usage.limit)} tokens).${
      level === 'ok'
        ? ''
        : ' Context is getting full. Compact the session to keep working with a summary of earlier details.'
    }`,
  }
}
