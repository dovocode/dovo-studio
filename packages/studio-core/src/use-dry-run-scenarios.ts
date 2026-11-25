import {
  automationDryRunSchema,
  dryRunScenariosSchema,
  dryRunScenarioDifferences,
  type Automation,
  type DryRunScenario,
  type DryRunScenariosCommand,
  type RuntimeConnection,
} from '@dovo/protocol'
import { clientScopeKey } from '@dovo/client-runtime'
import { useEffect, useRef, useState } from 'react'
import type { WorkspaceRequest } from './workspace/context'

export function useDryRunScenarios(
  flow: Automation,
  request: WorkspaceRequest,
  connection: RuntimeConnection | null | undefined,
  enabled: boolean,
) {
  const scope = JSON.stringify([clientScopeKey(connection), flow.id])
  const [state, setState] = useState<{
    scope: string
    cases?: DryRunScenario[]
    checks?: { id: string; issues: string[] }[]
    error?: string
  }>()
  const [busy, setBusy] = useState(false)
  const version = useRef(0)
  const pending = useRef(false)
  const current = state?.scope === scope ? state : undefined
  const cases = current?.cases
  const update = (value: Partial<NonNullable<typeof state>>) =>
    setState((state) => ({ ...(state?.scope === scope ? state : undefined), ...value, scope }))
  const failure = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))
  useEffect(() => {
    if (!enabled) return
    const generation = ++version.current
    pending.current = false
    setBusy(false)
    void request(
      '/api/jobs/scenarios',
      { action: 'list', automationId: flow.id },
      dryRunScenariosSchema,
    ).then(
      (cases) => {
        if (version.current === generation) setState({ scope, cases })
      },
      (cause: unknown) => {
        if (version.current === generation) setState({ scope, error: failure(cause) })
      },
    )
    return () => {
      version.current++
    }
  }, [enabled, flow.id, request, scope])
  const act = async (
    work: (isCurrent: () => boolean) => Promise<Partial<NonNullable<typeof state>>>,
  ) => {
    if (pending.current || !enabled) return false
    pending.current = true
    const generation = ++version.current
    const isCurrent = () => generation === version.current
    setBusy(true)
    update({ error: undefined, checks: undefined })
    try {
      const result = await work(isCurrent)
      if (!isCurrent()) return false
      update(result)
      return true
    } catch (cause) {
      if (generation === version.current) update({ error: failure(cause) })
      return false
    } finally {
      if (isCurrent()) {
        pending.current = false
        setBusy(false)
      }
    }
  }
  const commit = (command: DryRunScenariosCommand) =>
    act(async () => ({
      cases: await request('/api/jobs/scenarios', command, dryRunScenariosSchema),
    }))
  return {
    cases: cases ?? [],
    checks: current?.checks,
    error: current?.error,
    busy,
    save: (scenario: DryRunScenario, expected?: DryRunScenario) =>
      commit({ action: 'save', automationId: flow.id, scenario, expected }),
    remove: (expected: DryRunScenario) =>
      commit({ action: 'delete', automationId: flow.id, expected }),
    run: () =>
      act(async (isCurrent) => {
        const checks: { id: string; issues: string[] }[] = []
        for (const scenario of cases ?? []) {
          if (!isCurrent()) break
          try {
            const result = await request(
              '/api/jobs/dry-run',
              { flow, input: scenario.input, stopAt: scenario.stopAt },
              automationDryRunSchema,
            )
            checks.push({ id: scenario.id, issues: dryRunScenarioDifferences(scenario, result) })
          } catch (cause) {
            checks.push({ id: scenario.id, issues: [failure(cause)] })
          }
        }
        return { checks }
      }),
  }
}
