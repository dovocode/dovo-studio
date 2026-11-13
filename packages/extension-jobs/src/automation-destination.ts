import type { StudioAutomationTarget } from '@dovo/studio-core'
import type { FleetAutomation } from './fleet'

/** Explicit links never fall back to an automation with the same ID on another computer. */
export function automationDestination(
  rows: readonly FleetAutomation[],
  activeRuntimeId: string | null,
  entityId?: string,
  target?: StudioAutomationTarget,
) {
  if (target) {
    const row = rows.find(
      (row) => row.runtime.profile.id === target.runtimeId && row.flow.id === target.automationId,
    )
    return row ? { row, runId: target.runId } : undefined
  }
  if (!entityId) return undefined
  const ordered = [...rows].sort(
    (a, b) =>
      Number(b.runtime.profile.id === activeRuntimeId) -
      Number(a.runtime.profile.id === activeRuntimeId),
  )
  const run = ordered.find((row) => row.runs.some((run) => run.id === entityId))
  if (run) return { row: run, runId: entityId }
  const row = ordered.find((row) => row.flow.id === entityId)
  return row ? { row, runId: undefined } : undefined
}
