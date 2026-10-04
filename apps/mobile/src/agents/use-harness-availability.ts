import { useEffect } from 'react'
import {
  harnessAvailabilitySchema,
  modelDiscoveryInput,
  type Agent,
  type HarnessAvailability,
} from '@dovo/protocol'
import { useApplicationState } from '../runtime/state/application-state'
import { useRuntime } from '../runtime/connection/provider'

export function useHarnessAvailability(repositoryId: string, agents: readonly Agent[]) {
  const { profile, connected, readRuntime, snapshot } = useRuntime()
  const key = JSON.stringify([
    profile?.connection,
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
    if (!profile || !connected) return
    let stopped = false
    setState({ key, choices: [], loading: true, error: '' })
    void readRuntime(
      profile,
      '/api/agents/availability',
      { repositoryId },
      harnessAvailabilitySchema,
    )
      .then((choices) => {
        if (!stopped) setState({ key, choices, loading: false, error: '' })
      })
      .catch((error: unknown) => {
        if (!stopped) setState({ key, choices: [], loading: false, error: String(error) })
      })
    return () => {
      stopped = true
    }
  }, [key, connected, readRuntime])
  return {
    available: new Set(
      (state.key === key ? state.choices : [])
        .filter((item) => item.available)
        .map((item) => item.id),
    ),
    loading: connected && (state.key !== key || state.loading),
    error: state.key === key ? state.error : '',
  }
}
