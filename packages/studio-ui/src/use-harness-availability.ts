import { useEffect } from 'react'
import { useApplicationState } from '@dovo/studio-core/state'
import { useWorkspace } from '@dovo/studio-core'
import {
  harnessAvailabilitySchema,
  modelDiscoveryInput,
  type Agent,
  type HarnessAvailability,
} from '@dovo/protocol'

export function useHarnessAvailability(
  repositoryId: string | undefined,
  active: boolean,
  agents: readonly Agent[],
) {
  const { connection, connected, request, snapshot } = useWorkspace()
  const key = JSON.stringify([
    connection?.address,
    connection?.token,
    snapshot?.runtimeInstanceId,
    repositoryId,
    agents.map(modelDiscoveryInput),
    snapshot?.acpInstallations,
  ])
  const [state, setState] = useApplicationState<{
    key: string
    choices: HarnessAvailability
    loading: boolean
    error: string
  }>({ key: '', choices: [], loading: false, error: '' })
  useEffect(() => {
    if (!active || !connected) return
    let stopped = false
    setState((previous) => ({
      key,
      choices: previous.key === key ? previous.choices : [],
      loading: true,
      error: '',
    }))
    void request('/api/agents/availability', { repositoryId }, harnessAvailabilitySchema)
      .then((choices) => {
        if (!stopped) setState({ key, choices, loading: false, error: '' })
      })
      .catch((error: unknown) => {
        if (!stopped) setState({ key, choices: [], loading: false, error: String(error) })
      })
    return () => {
      stopped = true
    }
  }, [key, active, connected, request])
  return {
    available: new Set(
      (state.key === key ? state.choices : [])
        .filter((item) => item.available)
        .map((item) => item.id),
    ),
    loading: active && connected && (state.key !== key || state.loading),
    error: state.key === key ? state.error : '',
  }
}
