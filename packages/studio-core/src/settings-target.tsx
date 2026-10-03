import { createContext, useContext, type ReactNode } from 'react'
import { resolveSettingsTarget, type SettingsTarget } from '@dovo/protocol'
import { useApplicationState } from './runtime/application-state'
import { useWorkspace } from './workspace/provider'
import { useRuntimeSources } from './workspace/runtime-sources'

const Context = createContext<{
  target: SettingsTarget
  setTarget: (target: SettingsTarget) => void
} | null>(null)
export function SettingsTargetProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useApplicationState<SettingsTarget>({
    environmentId: '',
    projectId: '',
  })
  return <Context.Provider value={{ target, setTarget }}>{children}</Context.Provider>
}
export function useSettingsTarget() {
  const context = useContext(Context)
  if (!context) throw new Error('SettingsTargetProvider is required')
  const sources = useRuntimeSources()
  const { activeRuntimeId } = useWorkspace()
  return { ...context, sources, ...resolveSettingsTarget(sources, context.target, activeRuntimeId) }
}
